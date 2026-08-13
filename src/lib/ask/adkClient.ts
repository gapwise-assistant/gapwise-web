import { z } from 'zod';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

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
}

export class AskAgentError extends Error {}

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

function agentBaseUrl(): string {
  return (process.env.GAPSWISE_AGENT_URL ?? process.env.AGENT_SERVICE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
}

function gapswiseAppUrl(): string {
  return (process.env.GAPSWISE_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

async function createSession(userId: string, projectId?: string): Promise<string> {
  const response = await fetch(`${agentBaseUrl()}/apps/app/users/${encodeURIComponent(userId)}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { product: 'Gapswise', ...(projectId ? { gapswise_project_id: projectId } : {}) } }),
  });
  if (!response.ok) {
    throw new AskAgentError(`ADK session creation failed with status ${response.status}.`);
  }
  const body = await response.json() as { id?: string };
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
  const response = await fetch(`${agentBaseUrl()}/run_sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_name: 'app',
      user_id: userId,
      session_id: sessionId,
      new_message: { role: 'user', parts: [{ text: message }] },
      streaming: true,
    }),
  });
  if (!response.ok) {
    throw new AskAgentError(`ADK run failed with status ${response.status}.`);
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
  if (!answer) throw new AskAgentError('ADK returned no user-visible answer.');
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
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length < 2) return removeRepeatedSentenceRun(text);

  const seen = new Set<string>();
  const unique = paragraphs.filter((paragraph) => {
    const signature = paragraph.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
  return removeRepeatedSentenceRun(unique.join('\n\n').trim());
}

function removeRepeatedSentenceRun(text: string): string {
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
  if (last.length > 8 && previous.includes(last)) {
    return lines.slice(0, -1).join('\n').trim();
  }
  return text;
}

async function loadSafeSources(userId: string, query: string, projectId?: string): Promise<AskSource[]> {
  try {
    const response = await fetch(`${gapswiseAppUrl()}/api/internal/context-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, query, ...(projectId ? { projectId } : {}) }),
    });
    if (!response.ok) return [];
    const parsed = contextPackResponseSchema.safeParse(await response.json());
    if (!parsed.success) return [];

    const evidence = [
      ...parsed.data.contextPack.provenanceSources,
      ...parsed.data.contextPack.relevantEvidence,
    ];
    const mergedEvidence = new Map<string, (typeof evidence)[number]>();
    evidence.forEach((item) => {
      const existing = mergedEvidence.get(item.source_id);
      mergedEvidence.set(item.source_id, {
        ...existing,
        ...item,
        supports: item.supports ?? existing?.supports,
      });
    });
    const evidenceSources: AskSource[] = Array.from(mergedEvidence.values()).map((item) => ({
      id: item.source_id,
      title: item.filename,
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
      ...parsed.data.contextPack.recentDecisions,
      ...parsed.data.contextPack.contradictions,
    ];
    const graphSources: AskSource[] = selectedNodes
      .filter((node) => !node.source_refs.length)
      .map((node) => ({
        id: node.id,
        title: `${node.type.replaceAll('_', ' ')} in Gapswise`,
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

    return Array.from(
      new Map(
        [...evidenceSources, ...graphSources, ...memorySources, ...calendarSources]
          .map((source) => [source.id, source])
      ).values()
    ).slice(0, 8);
  } catch {
    return [];
  }
}

function isRefusal(answer: string): boolean {
  return /\b(?:cannot|can't|can not|unable to|do not have access|don't have access|do not have a|don't have a|limited to|not able to|as an ai|i am an ai|i'm an ai|only help with)\b/i.test(answer);
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
  const sessionId = params.sessionId?.trim() || await createSession(params.userId, params.projectId);
  const [answer, sources] = await Promise.all([
    runAdkTurn(params.userId, sessionId, params.message),
    loadSafeSources(params.userId, params.message, params.projectId),
  ]);
  return {
    answer: directEvidenceAnswer(params.message, answer, sources) ?? answer,
    sessionId,
    sources,
  };
}
