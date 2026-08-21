import { z } from 'zod';
import { GoogleAuth } from 'google-auth-library';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';
import { humanizeSourceTitle } from '@/lib/context/sourceTitle';

export interface AskSource {
  id: string;
  title: string;
  excerpt: string;
  score?: number;
  kind: 'source' | 'graph' | 'memory' | 'calendar';
  supports?: string[];
  reason?: string;
}

export interface AskResult {
  answer: string;
  sessionId: string;
  sources: AskSource[];
  promptUsed?: string;
  contextUsed?: {
    projectTitle: string;
    items: string[];
  };
}

export type AskFailureStage = 'agent-auth' | 'agent-unavailable' | 'context-pack' | 'gemini';

export class AskAgentError extends Error {
  readonly stage: AskFailureStage;
  readonly status?: number;

  constructor(message: string, options?: { stage?: AskFailureStage; status?: number }) {
    super(message);
    this.name = 'AskAgentError';
    this.stage = options?.stage ?? 'agent-unavailable';
    this.status = options?.status;
  }
}

const graphNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string(),
  source_refs: z.array(z.string()).default([]),
  why_it_matters: z.array(z.string()).optional(),
});

const evidenceSchema = z.object({
  source_id: z.string(),
  filename: z.string(),
  excerpt: z.string(),
  score: z.number().optional(),
  supports: z.array(z.string()).optional(),
});

const contextPackResponseSchema = z.object({
  contextPack: z.object({
    relevantEvidence: z.array(evidenceSchema).default([]),
    provenanceSources: z.array(evidenceSchema).default([]),
    activeGoals: z.array(graphNodeSchema).default([]),
    unresolvedGaps: z.array(graphNodeSchema).default([]),
    recentlyResolvedGaps: z.array(graphNodeSchema).default([]),
    recentDecisions: z.array(graphNodeSchema).default([]),
    contradictions: z.array(graphNodeSchema).default([]),
    userPreferences: z.array(z.object({
      id: z.string(),
      category: z.string(),
      text: z.string(),
      why_remembered: z.string(),
    })).default([]),
    upcomingCommitments: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        why_it_matters: z.array(z.string()).optional(),
      })
    ).default([]),
  }),
});
type AskContextPack = z.infer<typeof contextPackResponseSchema>['contextPack'];

function agentBaseUrl(): string {
  return (process.env.GAPSWISE_AGENT_URL ?? process.env.AGENT_SERVICE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
}

function gapswiseAppUrl(): string {
  return (process.env.GAPSWISE_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function internalApiHeaders(): Record<string, string> {
  const secret = process.env.GAPSWISE_INTERNAL_API_SECRET?.trim();
  return secret ? { 'x-gapswise-internal-secret': secret } : {};
}

let agentIdentityHeadersPromise: Promise<Record<string, string>> | null = null;

async function agentRequestHeaders(): Promise<Record<string, string>> {
  if (process.env.GAPSWISE_AGENT_AUTH !== 'true') return {};
  const audience = agentBaseUrl();
  if (!audience.startsWith('https://')) {
    throw new AskAgentError('Authenticated ADK calls require an HTTPS Cloud Run URL.', { stage: 'agent-auth' });
  }
  if (!agentIdentityHeadersPromise) {
    agentIdentityHeadersPromise = (async () => {
      try {
        const auth = new GoogleAuth();
        const client = await auth.getIdTokenClient(audience);
        return client.getRequestHeaders(audience);
      } catch (error) {
        throw new AskAgentError('Cloud Run identity-token creation failed for the ADK agent.', {
          stage: 'agent-auth',
        });
      }
    })();
  }
  return agentIdentityHeadersPromise;
}

async function createSession(userId: string, projectId?: string): Promise<string> {
  const identityHeaders = await agentRequestHeaders();
  let response: Response;
  try {
    response = await fetch(`${agentBaseUrl()}/apps/app/users/${encodeURIComponent(userId)}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identityHeaders },
      body: JSON.stringify({
        state: {
          product: 'Gapwise',
          gapswise_user_id: userId,
          ...(projectId ? { gapswise_project_id: projectId } : {}),
        },
      }),
    });
  } catch (error) {
    throw new AskAgentError('The deployed ADK agent could not be reached while creating a session.', {
      stage: 'agent-unavailable',
    });
  }
  if (!response.ok) {
    throw new AskAgentError(`ADK session creation failed with status ${response.status}.`, {
      stage: 'agent-unavailable',
      status: response.status,
    });
  }
  let body: { id?: string };
  try {
    body = await response.json() as { id?: string };
  } catch {
    throw new AskAgentError('ADK session creation returned an invalid response.', { stage: 'agent-unavailable' });
  }
  if (!body.id) throw new AskAgentError('ADK session creation returned no session id.');
  return body.id;
}

function textFromAdkEvent(event: unknown): string[] {
  if (!event || typeof event !== 'object') return [];
  const content = 'content' in event ? (event as { content?: unknown }).content : undefined;
  if (!content || typeof content !== 'object' || !('parts' in content) || !Array.isArray((content as { parts?: unknown }).parts)) {
    return [];
  }
  return ((content as { parts: unknown[] }).parts)
    .map((part) => {
      if (!part || typeof part !== 'object' || !('text' in part)) return '';
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean);
}

async function runAdkTurn(userId: string, sessionId: string, message: string): Promise<string> {
  const identityHeaders = await agentRequestHeaders();
  let response: Response;
  try {
    response = await fetch(`${agentBaseUrl()}/run_sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identityHeaders },
      body: JSON.stringify({
        app_name: 'app',
        user_id: userId,
        session_id: sessionId,
        new_message: { role: 'user', parts: [{ text: message }] },
        streaming: true,
      }),
    });
  } catch (error) {
    throw new AskAgentError('The deployed ADK agent could not be reached while running Ask.', {
      stage: 'agent-unavailable',
    });
  }
  if (!response.ok) {
    throw new AskAgentError(`ADK run failed with status ${response.status}.`, {
      stage: 'agent-unavailable',
      status: response.status,
    });
  }

  const raw = await response.text();
  const textChunks = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .flatMap((line) => {
      try {
        return textFromAdkEvent(JSON.parse(line.slice(6)));
      } catch {
        return [];
      }
    });
  const answer = compactAdkTextChunks(textChunks);
  if (!answer) throw new AskAgentError('Gemini returned no user-visible answer through the ADK agent.', { stage: 'gemini' });
  return answer;
}

function compactAdkTextChunks(chunks: string[]): string {
  const compacted: string[] = [];
  chunks.forEach((chunk) => {
    const text = chunk.trim();
    if (!text) return;
    const normalized = text.replace(/\s+/g, ' ').trim();
    const signature = normalized.split(':')[0].split(/[.!?]\s/)[0].replace(/[*_`#-]/g, '').trim();
    const duplicateIndex = compacted.findIndex((existing) => {
      const existingNormalized = existing.replace(/\s+/g, ' ').trim();
      const existingSignature = existingNormalized.split(':')[0].split(/[.!?]\s/)[0].replace(/[*_`#-]/g, '').trim();
      return existingNormalized === normalized || (signature.length > 12 && existingSignature === signature);
    });
    if (duplicateIndex >= 0) {
      compacted[duplicateIndex] = text.length >= compacted[duplicateIndex].length ? text : compacted[duplicateIndex];
      return;
    }
    compacted.push(text);
  });
  return removeRepeatedContent(removeRepeatedTrailingLine(compacted.join('\n').trim()));
}

function removeRepeatedContent(text: string): string {
  const withoutCumulativeDraft = keepLastRepeatedOpening(text);
  const withoutRepeatedBlocks = removeRepeatedMarkdownBlocks(withoutCumulativeDraft);
  const paragraphs = withoutRepeatedBlocks
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length < 2) return removeRepeatedSentenceRun(withoutRepeatedBlocks);

  const seen = new Set<string>();
  const unique = paragraphs.filter((paragraph) => {
    const signature = paragraph.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
  return removeRepeatedSentenceRun(unique.join('\n\n').trim());
}

function keepLastRepeatedOpening(text: string): string {
  if (text.length < 160) return text;
  const openingWords = text.match(/[a-zA-Z0-9'-]+/g)?.slice(0, 8) ?? [];
  if (openingWords.length < 8) return text;
  const openingPattern = openingWords
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^a-zA-Z0-9]+');
  const matches = Array.from(text.matchAll(new RegExp(openingPattern, 'gi')));
  const last = matches[matches.length - 1];
  if (matches.length < 2 || last.index === undefined || last.index < 80) return text;
  const repeatedBlockStart = text.lastIndexOf('\n', last.index - 1) + 1;
  return text.slice(repeatedBlockStart).trim();
}

function removeRepeatedMarkdownBlocks(text: string): string {
  const lines = text.split('\n');
  if (lines.length < 4) return text;
  const normalizeLine = (line: string) => line.replace(/\s+/g, ' ').trim().toLowerCase();

  for (let run = Math.floor(lines.length / 2); run >= 2; run -= 1) {
    for (let start = 0; start + run * 2 <= lines.length; start += 1) {
      const first = lines.slice(start, start + run).map(normalizeLine);
      const second = lines.slice(start + run, start + run * 2).map(normalizeLine);
      if (first.every((line, index) => line && line === second[index])) {
        return [
          ...lines.slice(0, start + run),
          ...lines.slice(start + run * 2),
        ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
      }
    }
  }
  return text;
}

function removeRepeatedSentenceRun(text: string): string {
  // Line-oriented Markdown has already been handled above. Avoid flattening
  // lists/tables/code blocks while removing prose-only repeated fragments.
  if (text.includes('\n') || text.includes('```')) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return text;

  const normalized = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  for (let start = 0; start < sentences.length - 1; start += 1) {
    const maxRun = Math.floor((sentences.length - start) / 2);
    for (let run = maxRun; run >= 1; run -= 1) {
      const first = sentences.slice(start, start + run).map(normalized).join(' ');
      const second = sentences.slice(start + run, start + run * 2).map(normalized).join(' ');
      if (first === second) {
        return [
          ...sentences.slice(0, start + run),
          ...sentences.slice(start + run * 2),
        ].join(' ').trim();
      }
    }
  }
  return text;
}

function removeRepeatedTrailingLine(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return text;
  const last = lines[lines.length - 1];
  const previous = lines.slice(0, -1).join('\n');
  if (last.length > 8 && !lines.slice(0, -1).includes(last) && previous.includes(last)) {
    return lines.slice(0, -1).join('\n').trim();
  }
  return text;
}

function compactContextText(value: string, maxLength = 500): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function mergedContextEvidence(contextPack: AskContextPack): Array<z.infer<typeof evidenceSchema>> {
  const merged = new Map<string, z.infer<typeof evidenceSchema>>();
  [...contextPack.relevantEvidence, ...contextPack.provenanceSources].forEach((item) => {
    const existing = merged.get(item.source_id);
    if (!existing) {
      merged.set(item.source_id, item);
      return;
    }
    merged.set(item.source_id, {
      ...item,
      excerpt: existing.excerpt,
      score: Math.max(existing.score ?? 0, item.score ?? 0),
      supports: Array.from(new Set([...(existing.supports ?? []), ...(item.supports ?? [])])),
    });
  });
  return Array.from(merged.values());
}

function contextPromptForAgent(message: string, contextPack: AskContextPack | null, projectId?: string): string {
  if (!contextPack) return message;
  const sections: string[] = [];
  const addSection = (label: string, values: string[]) => {
    const items = values.filter(Boolean).slice(0, 8);
    if (items.length) sections.push(`${label}:\n${items.map((item) => `- ${item}`).join('\n')}`);
  };
  addSection('Active goals', contextPack.activeGoals.map((node) => compactContextText(node.text)));
  addSection('User preferences', contextPack.userPreferences.map((memory) => compactContextText(memory.text)));
  addSection('Unresolved questions', contextPack.unresolvedGaps.map((node) => compactContextText(node.text)));
  addSection('Recently answered questions', contextPack.recentlyResolvedGaps.map((node) => compactContextText(
    `${node.text}${node.why_it_matters?.length ? ` — ${node.why_it_matters.join(' ')}` : ''}`
  )));
  addSection('Recent decisions', contextPack.recentDecisions.map((node) => compactContextText(node.text)));
  addSection('Relevant project documents and evidence', mergedContextEvidence(contextPack).map((source) => `${source.filename}: ${compactContextText(source.excerpt)}`));
  addSection('Upcoming commitments', contextPack.upcomingCommitments.map((commitment) => compactContextText(commitment.text)));
  if (!sections.length) return message;
  return [
    'PRELOADED GAPWISE CONTEXT PACK',
    'This Context Pack was retrieved for the exact user question below. Use it directly; do not retrieve a second Context Pack for this turn.',
    'Use the selected project context below as the source of truth. Do not invent facts outside it.',
    projectId ? `Project scope: ${projectId}` : 'Scope: all available context',
    sections.join('\n\n'),
    `User question:\n${message}`,
  ].join('\n\n');
}

async function loadSafeSources(userId: string, query: string, projectId?: string): Promise<{ sources: AskSource[]; contextPack: AskContextPack | null }> {
  try {
    const response = await fetch(`${gapswiseAppUrl()}/api/internal/context-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...internalApiHeaders() },
      body: JSON.stringify({ userId, query, ...(projectId ? { projectId } : {}) }),
    });
    if (!response.ok) {
      console.error('[Gapwise Ask]', {
        stage: 'context-pack',
        status: response.status,
        hasProjectScope: Boolean(projectId),
        queryLength: query.length,
      });
      return { sources: [], contextPack: null };
    }
    const parsed = contextPackResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error('[Gapwise Ask]', {
        stage: 'context-pack',
        reason: 'invalid-response-shape',
        hasProjectScope: Boolean(projectId),
        queryLength: query.length,
      });
      return { sources: [], contextPack: null };
    }

    const evidenceSources: AskSource[] = mergedContextEvidence(parsed.data.contextPack).map((item) => ({
      id: item.source_id,
      title: humanizeSourceTitle(item.filename),
      excerpt: item.excerpt,
      score: item.score,
      kind: 'source',
      supports: item.supports,
      reason: item.supports?.length
        ? `Supports: ${item.supports.slice(0, 2).join(' · ')}`
        : 'Matched the question and response context.',
    }));
    const selectedNodes = [
      ...parsed.data.contextPack.activeGoals,
      ...parsed.data.contextPack.unresolvedGaps,
      ...parsed.data.contextPack.recentlyResolvedGaps,
      ...parsed.data.contextPack.recentDecisions,
      ...parsed.data.contextPack.contradictions,
    ];
    const graphSources: AskSource[] = selectedNodes
      .filter((node) => !node.source_refs.length)
      .map((node) => ({
        id: node.id,
        title: `${node.type.replaceAll('_', ' ')} in Gapwise`,
        excerpt: node.text,
        kind: 'graph',
        supports: [node.text],
        reason: node.why_it_matters?.[0] ?? 'Stored in the project understanding graph.',
      }));
    const memorySources: AskSource[] = parsed.data.contextPack.userPreferences.map((memory) => ({
      id: memory.id,
      title: `Remembered ${memory.category.replaceAll('_', ' ')}`,
      excerpt: memory.text,
      kind: 'memory',
      supports: [memory.text],
      reason: memory.why_remembered,
    }));
    const calendarSources: AskSource[] = parsed.data.contextPack.upcomingCommitments
      .filter((commitment) => commitment.why_it_matters?.includes('Source: Google Calendar'))
      .map((commitment) => ({
        id: commitment.id,
        title: 'Google Calendar',
        excerpt: commitment.text,
        kind: 'calendar',
        supports: [commitment.text],
        reason: commitment.why_it_matters?.filter((item) => item !== 'Source: Google Calendar').join(' · '),
      }));

    return {
      sources: Array.from(
      new Map(
        [...evidenceSources, ...graphSources, ...memorySources, ...calendarSources]
          .map((source) => [source.id, source])
      ).values()
      ).slice(0, 8),
      contextPack: parsed.data.contextPack,
    };
  } catch (error) {
    console.error('[Gapwise Ask]', {
      stage: 'context-pack',
      reason: error instanceof Error ? error.name : 'unknown-error',
      hasProjectScope: Boolean(projectId),
      queryLength: query.length,
    });
    return { sources: [], contextPack: null };
  }
}

function isRefusal(answer: string): boolean {
  return /\b(?:i\s+(?:cannot|can't|can not|am unable to|am not able to|do not have access|don't have access|do not have a|don't have a)|as an ai|i am an ai|i'm an ai|i can only help with|i'm limited to|i am limited to)\b/i.test(answer);
}

function directEvidenceAnswer(question: string, answer: string, sources: AskSource[]): string | null {
  if (!isRefusal(answer)) return null;

  const questionTerms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3);
  const directSource = sources
    .filter((source) => source.kind === 'source' || source.kind === 'memory')
    .map((source) => ({
      source,
      overlap: questionTerms.filter((term) => source.excerpt.toLowerCase().includes(term)).length,
    }))
    .filter(({ source, overlap }) => (source.score ?? 0) >= 0.5 || overlap > 0)
    .sort((a, b) => (b.source.score ?? 0) - (a.source.score ?? 0) || b.overlap - a.overlap)[0]?.source;

  if (!directSource?.excerpt.trim()) return null;

  const excerpt = directSource.excerpt.trim();
  if (/\bmy birthday\b/i.test(question) && /\bbirthday\b/i.test(excerpt)) {
    const normalizedExcerpt = excerpt.replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
    const birthdayDate = normalizedExcerpt.match(/\bmy birthday\s+(?:is|will be|falls on)\s+(.+)$/i)?.[1]
      ?? normalizedExcerpt.match(/\b(.+?)\s+is\s+my birthday\b/i)?.[1];
    if (birthdayDate) return `Your birthday is ${birthdayDate.replace(/[.!?]+$/, '')}.`;
    return normalizedExcerpt.replace(/^my\b/i, 'Your');
  }
  return `According to your context, ${excerpt}`;
}

export async function askGapswise(params: {
  userId: string;
  message: string;
  sessionId?: string;
  projectId?: string;
}): Promise<AskResult> {
  assertExternalServicesAllowed('Google ADK / Gemini');
  const [sessionId, { sources, contextPack }] = await Promise.all([
    params.sessionId?.trim() || createSession(params.userId, params.projectId),
    loadSafeSources(params.userId, params.message, params.projectId),
  ]);
  const promptUsed = contextPromptForAgent(params.message, contextPack, params.projectId);
  const contextualAnswer = await runAdkTurn(
    params.userId,
    sessionId,
    promptUsed,
  );
  return {
    answer: directEvidenceAnswer(params.message, contextualAnswer, sources) ?? contextualAnswer,
    sessionId,
    sources,
    promptUsed,
  };
}
