import { z } from 'zod';
import { GoogleAuth } from 'google-auth-library';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';
import { humanizeSourceTitle } from '@/lib/context/sourceTitle';
import { logAskDebug } from '@/lib/ask/debug';
import type {
  AskExecution,
  AskContextProposal,
  AskGraphReasoningTrace,
  AskOpenQuestion,
  AskRetrievedEvidence,
  AskResponse,
  AskResponseOutcome,
  AskRoute,
  AskSearchSuggestions,
  AskSource,
} from '@/types/ask';
import { normalizeAskContextProposals } from '@/types/ask';
import { focusAssessmentPromptSection, type FocusAssessment } from '@/lib/focus/focusAssessment';
import type { ProjectReasoningMode } from '@/lib/retrieval/projectReasoningContext';
import type { UserMemoryProfile } from '@/types/clarity';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadUserMemoryProfile } from '@/lib/memory/serverStore';
import { buildPromptProfile } from '@/lib/personalization/promptProfile';

export type { AskSource } from '@/types/ask';

export interface AskResult {
  answer: string;
  outcome?: AskResponseOutcome;
  resolvesQuestionId?: string;
  conclusion?: string;
  contextProposals?: AskContextProposal[];
  /** Compatibility alias for callers and records from the first proposal implementation. */
  proposals?: AskContextProposal[];
  sessionId?: string;
  sources: AskSource[];
  execution?: AskExecution;
  promptUsed?: string;
  contextUsed?: {
    projectTitle: string;
    items: string[];
  };
  assistantMessageId?: string;
  openQuestionIds?: string[];
  openQuestions?: AskOpenQuestion[];
  searchSuggestions?: AskSearchSuggestions;
  retrievedEvidence?: AskRetrievedEvidence[];
  /** Development-only routing diagnostics; removed from the public API response. */
  graphReasoning?: AskGraphReasoningTrace;
}

export type AskFailureStage = 'agent-auth' | 'agent-unavailable' | 'context-pack' | 'gemini' | 'routing';

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
  status: z.string().optional(),
  source_refs: z.array(z.string()).default([]),
  why_it_matters: z.array(z.string()).optional(),
});

const askGraphContextSchema = z.object({
  projectGoal: z.string(),
  nodes: z.array(z.object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    text: z.string(),
    confidence: z.number(),
    impact: z.number(),
  })).default([]),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: z.string(),
    confidence: z.number().optional(),
  })).default([]),
  startingNodeIds: z.array(z.string()).default([]),
});

const evidenceSchema = z.object({
  source_id: z.string(),
  filename: z.string(),
  excerpt: z.string(),
  score: z.number().optional(),
  supports: z.array(z.string()).optional(),
  selectionReason: z.enum(['query_match', 'seed_provenance', 'expanded_node_provenance']).optional(),
});

const projectReasoningContextSchema = z.object({
  mode: z.enum(['factual', 'reasoning', 'impact', 'decision', 'focus']),
  seedNodes: z.array(graphNodeSchema).default([]),
  expandedNodes: z.array(graphNodeSchema).default([]),
  relationships: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: z.string(),
    confidence: z.number().optional(),
  })).default([]),
  evidence: z.array(evidenceSchema).default([]),
  paths: z.array(z.object({
    nodeIds: z.array(z.string()),
    edgeIds: z.array(z.string()),
  })).default([]),
  diagnostics: z.object({
    seedMethod: z.enum(['lexical', 'fallback']),
    truncated: z.boolean(),
  }),
});

const askSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(),
  score: z.number().optional(),
  kind: z.enum(['source', 'graph', 'memory', 'calendar', 'web']),
  supports: z.array(z.string()).optional(),
  reason: z.string().optional(),
  url: z.string().url().optional(),
  retrievedAt: z.string().optional(),
  groundingMetadata: z.record(z.string(), z.unknown()).optional(),
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
    recentImportantEvents: z.array(z.string()).default([]),
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
    relevantConversationExcerpts: z.array(z.object({
      chatId: z.string(),
      messageId: z.string(),
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      scopeType: z.enum(['general', 'project']),
      projectId: z.string().optional(),
      timestamp: z.string(),
    })).default([]),
    researchEvidence: z.array(z.object({
      id: z.string(),
      text: z.string(),
      retrievedAt: z.string(),
      sources: z.array(askSourceSchema),
      provenance: z.enum(['assistant_web_research_confirmed_by_user', 'user_confirmed_ai_response']).optional(),
      action: z.enum(['save', 'use_as_answer', 'use_as_decision', 'save_as_context']).optional(),
      targetQuestionId: z.string().optional(),
      targetDecisionId: z.string().optional(),
      answerFingerprint: z.string().optional(),
      status: z.enum(['pending', 'confirmed']).optional(),
    })).default([]),
    graphContext: askGraphContextSchema.optional(),
    projectReasoningContext: projectReasoningContextSchema.optional(),
  }),
});
type AskContextPack = z.infer<typeof contextPackResponseSchema>['contextPack'];

const askRouteResponseSchema = z.object({
  route: z.enum(['web_research', 'internal_context', 'graph_reasoning', 'ask_clarification']),
  reason: z.string().default(''),
  reasoningMode: z.enum(['factual', 'reasoning', 'impact', 'decision', 'focus']).optional(),
});

const askProposalTypeSchema = z.enum([
  'GOAL', 'KNOWN', 'CONSTRAINT', 'ASSUMPTION', 'DECISION', 'UNKNOWN',
  'EVIDENCE', 'EXPERIMENT', 'RISK', 'NEXT_ACTION', 'PREFERENCE',
]);
const normalizedAskProposalTypeSchema = z.preprocess(
  (value) => typeof value === 'string' ? value.trim().toUpperCase() : value,
  askProposalTypeSchema,
);
const askProposalStatusSchema = z.enum(['OPEN', 'RESOLVED', 'DEFERRED']);
const askContextProposalSchema = z.object({
  type: normalizedAskProposalTypeSchema,
  text: z.string().trim().min(1).max(1200),
  reasoning: z.string().trim().min(1).max(1200).optional(),
  status: askProposalStatusSchema,
  sourceMessageId: z.string().trim().min(1).optional(),
});
const legacyAskProposalSchema = z.object({
  type: normalizedAskProposalTypeSchema,
  text: z.string().trim().min(1).max(1200),
  reasoning: z.string().trim().min(1).max(1200).optional(),
  suggestedStatus: askProposalStatusSchema.optional(),
  sourceMessageId: z.string().trim().min(1).optional(),
  status: z.enum(['proposed', 'added', 'dismissed']).optional(),
});

const askResponseSchema = z.object({
  answer: z.string().trim().min(1),
  outcome: z.enum(['exploration', 'recommendation', 'conclusion']),
  resolvesQuestionId: z.string().trim().min(1).optional(),
  conclusion: z.string().trim().min(1).max(5000).optional(),
  contextProposals: z.array(askContextProposalSchema).max(3).default([]),
  /** Accept responses from an agent instance running the original contract. */
  proposals: z.array(legacyAskProposalSchema).max(3).default([]),
}).superRefine((value, context) => {
  if (value.outcome === 'conclusion' && (!value.resolvesQuestionId || !value.conclusion)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A conclusion must identify its open question and concise conclusion.',
      path: ['outcome'],
    });
  }
  if (value.outcome !== 'conclusion' && (value.resolvesQuestionId || value.conclusion)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only conclusions may include resolution metadata.',
      path: ['outcome'],
    });
  }
});

const webResearchResponseSchema = z.object({
  sessionId: z.string(),
  events: z.array(z.unknown()).default([]),
});

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

async function agentServiceHeaders(): Promise<Record<string, string>> {
  return { ...await agentRequestHeaders(), ...internalApiHeaders() };
}

async function createSession(userId: string, projectId?: string, chatId?: string): Promise<string> {
  const identityHeaders = await agentServiceHeaders();
  logAskDebug('session-request', {
    endpoint: `${agentBaseUrl()}/apps/app/users/${encodeURIComponent(userId)}/sessions`,
    user_id: userId,
    project_id: projectId,
    chat_id: chatId,
    app_name: 'app',
  });
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
          ...(chatId ? { gapswise_chat_id: chatId } : {}),
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
  logAskDebug('session-response', { status: response.status, session_id: body.id });
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

interface AdkTurnResult {
  answer: string;
  sources: AskSource[];
  searchSuggestions?: AskSearchSuggestions;
  response?: AskResponse;
}

function objectValue(value: unknown, ...keys: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    if (key in value) return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function structuredAskJsonCandidates(text: string): string[] {
  const candidates = [text.trim()];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    const fenced = match[1]?.trim();
    if (fenced) candidates.push(fenced);
  }
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));
  return Array.from(new Set(candidates.filter(Boolean))).reverse();
}

function structuredAskResponseFromText(text: string): AskResponse | undefined {
  for (const candidate of structuredAskJsonCandidates(text)) {
    try {
      const parsed = askResponseSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        const contextProposals = normalizeAskContextProposals(
          parsed.data.contextProposals.length > 0
            ? parsed.data.contextProposals
            : parsed.data.proposals,
        ).slice(0, 3);
        return {
          answer: parsed.data.answer,
          outcome: parsed.data.outcome,
          ...(parsed.data.resolvesQuestionId ? { resolvesQuestionId: parsed.data.resolvesQuestionId } : {}),
          ...(parsed.data.conclusion ? { conclusion: parsed.data.conclusion } : {}),
          contextProposals,
        };
      }
    } catch {
      // Older or non-conversational responses may still be plain text.
    }
  }
  return undefined;
}

function answerFromStructuredAskText(text: string): string | undefined {
  for (const candidate of structuredAskJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const answer = (parsed as Record<string, unknown>).answer;
      if (typeof answer === 'string' && answer.trim()) return answer.trim();
    } catch {
      // Try the next streamed candidate.
    }
  }
  return undefined;
}

function looksLikeStructuredAskText(text: string): boolean {
  return /["']answer["']\s*:/.test(text) && /["']outcome["']\s*:/.test(text);
}

function webSourceId(url: string): string {
  let hash = 0;
  for (let index = 0; index < url.length; index += 1) hash = ((hash << 5) - hash + url.charCodeAt(index)) | 0;
  return `web_${Math.abs(hash)}`;
}

function webSourcesFromAdkEvents(events: unknown[]): { sources: AskSource[]; searchSuggestions?: AskSearchSuggestions } {
  const retrievedAt = new Date().toISOString();
  const sourcesByUrl = new Map<string, AskSource>();
  const suggestions: AskSearchSuggestions = { webSearchQueries: [] };

  events.forEach((event) => {
    const grounding = objectRecord(objectValue(event, 'groundingMetadata', 'grounding_metadata'));
    if (!grounding) return;
    const chunks = objectValue(grounding, 'groundingChunks', 'grounding_chunks');
    const chunkUrls: string[] = [];
    if (Array.isArray(chunks)) {
      chunks.forEach((chunk, index) => {
        const web = objectRecord(objectValue(chunk, 'web'));
        const url = stringValue(objectValue(web, 'uri', 'url'));
        if (!url) return;
        chunkUrls[index] = url;
        const title = stringValue(objectValue(web, 'title'))
          ?? stringValue(objectValue(web, 'domain'))
          ?? url;
        const existing = sourcesByUrl.get(url);
        if (!existing) {
          sourcesByUrl.set(url, {
            id: webSourceId(url),
            title,
            excerpt: stringValue(objectValue(web, 'snippet')) ?? `Google Search result from ${title}.`,
            kind: 'web',
            url,
            retrievedAt,
            groundingMetadata: grounding,
            reason: 'Retrieved from Google Search for this answer.',
          });
        } else if (existing.excerpt.startsWith('Google Search result from ') && stringValue(objectValue(web, 'snippet'))) {
          existing.excerpt = stringValue(objectValue(web, 'snippet')) as string;
        }
      });
    }

    const supports = objectValue(grounding, 'groundingSupports', 'grounding_supports');
    if (Array.isArray(supports)) {
      supports.forEach((support) => {
        const supportRecord = objectRecord(support);
        const segment = objectRecord(objectValue(supportRecord, 'segment'));
        const excerpt = stringValue(objectValue(segment, 'text'));
        const indices = objectValue(supportRecord, 'groundingChunkIndices', 'grounding_chunk_indices');
        const scores = objectValue(supportRecord, 'confidenceScores', 'confidence_scores');
        if (!excerpt || !Array.isArray(indices)) return;
        indices.forEach((chunkIndex, index) => {
          if (typeof chunkIndex !== 'number') return;
          const url = chunkUrls[chunkIndex];
          const source = url ? sourcesByUrl.get(url) : undefined;
          if (!source) return;
          source.excerpt = source.excerpt.startsWith('Google Search result from ')
            ? excerpt
            : `${source.excerpt} ${excerpt}`.replace(/\s+/g, ' ').trim().slice(0, 800);
          if (Array.isArray(scores) && typeof scores[index] === 'number') source.score = Math.max(source.score ?? 0, scores[index]);
          source.supports = Array.from(new Set([...(source.supports ?? []), excerpt])).slice(0, 4);
        });
      });
    }

    const searchEntryPoint = objectRecord(objectValue(grounding, 'searchEntryPoint', 'search_entry_point'));
    const renderedContent = stringValue(objectValue(searchEntryPoint, 'renderedContent', 'rendered_content'));
    if (renderedContent) suggestions.renderedContent = suggestions.renderedContent
      ? `${suggestions.renderedContent}\n${renderedContent}`
      : renderedContent;
    const webSearchQueries = objectValue(grounding, 'webSearchQueries', 'web_search_queries');
    if (Array.isArray(webSearchQueries)) {
      suggestions.webSearchQueries = Array.from(new Set([
        ...(suggestions.webSearchQueries ?? []),
        ...webSearchQueries.filter((query): query is string => typeof query === 'string'),
      ]));
    }
  });

  const searchSuggestions = suggestions.renderedContent || suggestions.webSearchQueries?.length
    ? suggestions
    : undefined;
  return { sources: Array.from(sourcesByUrl.values()), searchSuggestions };
}

async function runAdkTurn(
  userId: string,
  sessionId: string,
  message: string,
  structuredResponse = true,
): Promise<AdkTurnResult> {
  const identityHeaders = await agentServiceHeaders();
  logAskDebug('adk-request', {
    endpoint: `${agentBaseUrl()}/run_sse`,
    app_name: 'app',
    user_id: userId,
    session_id: sessionId,
    structuredResponse,
    message,
  });
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
  const events = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .flatMap((line) => {
      try {
        return [JSON.parse(line.slice(6))];
      } catch {
        return [];
      }
    });
  const textChunks = events.flatMap(textFromAdkEvent);
  const rawAnswer = compactAdkTextChunks(textChunks);
  if (!rawAnswer) throw new AskAgentError('Gemini returned no user-visible answer through the ADK agent.', { stage: 'gemini' });
  const responseEnvelopes = structuredResponse
    ? [...textChunks, rawAnswer]
      .map(structuredAskResponseFromText)
      .filter((candidate): candidate is AskResponse => Boolean(candidate))
    : [];
  const responseEnvelope = responseEnvelopes.at(-1);
  const structuredAnswer = responseEnvelope?.answer
    ?? (structuredResponse
      ? [...textChunks, rawAnswer]
        .map(answerFromStructuredAskText)
        .filter((answer): answer is string => Boolean(answer))
        .at(-1)
      : undefined);
  if (structuredResponse && !structuredAnswer && looksLikeStructuredAskText(rawAnswer)) {
    throw new AskAgentError('Gemini returned an invalid structured Ask response.', { stage: 'gemini' });
  }
  logAskDebug('adk-response', {
    status: response.status,
    eventCount: events.length,
    rawAnswer,
    structuredResponse: responseEnvelope,
  });
  return {
    answer: structuredAnswer ?? rawAnswer,
    ...(responseEnvelope ? { response: responseEnvelope } : {}),
    ...webSourcesFromAdkEvents(events),
  };
}

function trustedRoutingContext(contextPack: AskContextPack | null, sources: AskSource[]) {
  const trustedKinds = new Set<AskSource['kind']>(['source', 'graph', 'memory', 'calendar']);
  const graphNodes = contextPack
    ? [
        ...contextPack.activeGoals,
        ...contextPack.unresolvedGaps,
        ...contextPack.recentlyResolvedGaps,
        ...contextPack.recentDecisions,
      ]
    : [];
  const userConfirmedContext = contextPack?.researchEvidence
    .filter((research) => (
      (research.provenance === 'user_confirmed_ai_response' && research.status !== 'pending')
      || ((research.action === 'use_as_answer' || research.action === 'use_as_decision') && research.status === 'confirmed')
    ))
    .map((research) => ({
      id: research.id,
      text: compactContextText(research.text),
      provenance: research.provenance,
      ...(research.targetQuestionId ? { targetQuestionId: research.targetQuestionId } : {}),
      ...(research.targetDecisionId ? { targetDecisionId: research.targetDecisionId } : {}),
      sources: research.sources.map((source) => ({
        title: source.title,
        excerpt: compactContextText(source.excerpt),
        ...(source.url ? { url: source.url } : {}),
      })).slice(0, 6),
    })) ?? [];
  return {
    sources: sources
      .filter((source) => trustedKinds.has(source.kind))
      .map((source) => ({ kind: source.kind, title: source.title, excerpt: compactContextText(source.excerpt) }))
      .slice(0, 12),
    graph: graphNodes.map((node) => ({
      type: node.type,
      text: compactContextText(node.text),
      ...(node.why_it_matters?.length
        ? { details: compactContextText(node.why_it_matters.join(' ')) }
        : {}),
    })).slice(0, 12),
    resolvedAnswers: contextPack?.recentImportantEvents.map((event) => compactContextText(event)).slice(0, 6) ?? [],
    researchEvidence: userConfirmedContext.slice(0, 8),
  };
}

function explicitlyRequestsWebResearch(message: string): boolean {
  return /\b(?:search (?:the )?(?:web|internet)|search online|look (?:it )?up|look this up|browse (?:the )?(?:web|internet)|check online|verify online|google it|research online|latest news)\b/i.test(message);
}

/**
 * The routing agent is authoritative when it identifies web research. For
 * project reasoning, keep a small generic safety net for causal questions the
 * deployed router may conservatively classify as ordinary internal context.
 * These cues describe reasoning shape, not a project domain or vocabulary.
 */
function requiresGraphReasoning(message: string): boolean {
  const normalized = message.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;

  const consequenceCue = /\b(?:what happens|what would happen|downstream|consequence|impact|affect(?:s|ed)?|at risk|blocking|blocked by|depends on|dependency|dependencies|prerequisite|causal chain|trade[- ]?off|conflict)\b/;
  const causalCue = /\b(?:if|when|unless|without|because|due to|as a result)\b/;
  const changeCue = /\bwhat\s+(?:would|needs to|has to|could)\s+change\b|\bwhat changes if\b/;
  const multiConceptCue = /\b(?:constraints?|decisions?|risks?|goals?|assumptions?|requirements?|unknowns?|dependencies?|blockers?)\b/g;
  const projectConcepts = normalized.match(multiConceptCue) ?? [];
  const evaluationCue = /\b(?:matter most|make .* difficult|make .* hard|shape|influence|evaluate|choose|decide)\b/;

  if (changeCue.test(normalized)) return true;
  if (consequenceCue.test(normalized)) return true;
  if (causalCue.test(normalized) && projectConcepts.length >= 1) return true;
  return projectConcepts.length >= 2 && evaluationCue.test(normalized);
}

function applyGraphReasoningOverride(
  message: string,
  decision: { route: AskRoutingDecision; reason: string; reasoningMode?: ProjectReasoningMode },
): { route: AskRoutingDecision; reason: string; reasoningMode?: ProjectReasoningMode } {
  if (
    decision.route === 'web_research'
    || explicitlyRequestsWebResearch(message)
  ) return decision;
  if (decision.route === 'graph_reasoning') {
    return { ...decision, reasoningMode: decision.reasoningMode ?? 'reasoning' };
  }
  if (!requiresGraphReasoning(message)) return decision;

  const promoted = {
    route: 'graph_reasoning' as const,
    reason: `${decision.reason} Generic causal project reasoning requires the canonical graph slice.`,
    reasoningMode: 'reasoning' as const,
  };
  logAskDebug('graph-reasoning-promoted', {
    originalRoute: decision.route,
    ...promoted,
    graphReasoning: true,
  });
  return promoted;
}

function routingFallback(
  message: string,
  error: AskAgentError,
): { route: AskRoutingDecision; reason: string; reasoningMode?: ProjectReasoningMode } {
  // Explicit web requests must never silently fall through to the Partner
  // Agent, because that could present unverified model memory as research.
  if (explicitlyRequestsWebResearch(message)) throw error;

  const fallback = applyGraphReasoningOverride(message, {
    route: 'internal_context',
    reason: 'Routing unavailable; defaulted to project conversation.',
  });
  logAskDebug('routing-fallback', {
    message,
    route: fallback.route,
    graphReasoning: fallback.route === 'graph_reasoning',
    error: error.message,
  });

  console.warn('[Gapwise Ask]', {
    stage: 'routing',
    fallback: 'internal_context',
    reason: error.message,
  });

  return fallback;
}

export async function determineAskRoute(
  userId: string,
  message: string,
  contextPack: AskContextPack | null,
  sources: AskSource[] = [],
): Promise<{ route: AskRoutingDecision; reason: string; reasoningMode?: ProjectReasoningMode }> {
  const routingContext = trustedRoutingContext(contextPack, sources);
  logAskDebug('routing-request', {
    endpoint: `${agentBaseUrl()}/internal/ask-route`,
    user_id: userId,
    message,
    trusted_context: routingContext,
  });
  let headers: Record<string, string>;
  try {
    headers = await agentServiceHeaders();
  } catch {
    return routingFallback(
      message,
      new AskAgentError('The deployed ADK routing agent could not be authenticated.', { stage: 'routing' }),
    );
  }
  let response: Response;
  try {
    response = await fetch(`${agentBaseUrl()}/internal/ask-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        user_id: userId,
        message,
        trusted_context: routingContext,
      }),
    });
  } catch {
    return routingFallback(
      message,
      new AskAgentError('The deployed ADK routing agent could not be reached.', { stage: 'routing' }),
    );
  }
  if (!response.ok) {
    return routingFallback(
      message,
      new AskAgentError(`ADK routing failed with status ${response.status}.`, {
        stage: 'routing',
        status: response.status,
      }),
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return routingFallback(
      message,
      new AskAgentError('ADK routing returned an unreadable decision.', { stage: 'routing' }),
    );
  }
  const parsed = askRouteResponseSchema.safeParse(body);
  if (!parsed.success) {
    console.error('[Gapwise Ask]', {
      stage: 'routing',
      reason: 'invalid-response-shape',
      issues: parsed.error.issues,
      body,
    });
    return routingFallback(
      message,
      new AskAgentError('ADK routing returned an invalid decision.', { stage: 'routing' }),
    );
  }

  // Older deployed routers may still return this route. It is no longer a
  // destination: conversational clarification belongs to the Partner Agent.
  if (parsed.data.route === 'ask_clarification') {
    return applyGraphReasoningOverride(message, {
      route: 'internal_context',
      reason: 'Legacy ask_clarification route normalized to internal_context.',
    });
  }

  const route = applyGraphReasoningOverride(message, {
    route: parsed.data.route as AskRoute,
    reason: parsed.data.reason,
    ...(parsed.data.reasoningMode ? { reasoningMode: parsed.data.reasoningMode } : {}),
  });
  logAskDebug('routing-response', {
    ...parsed.data,
    route: route.route,
    reason: route.reason,
    graphReasoning: route.route === 'graph_reasoning',
  });
  return route;
}

async function runWebResearchTurn(userId: string, message: string): Promise<AdkTurnResult> {
  const headers = await agentServiceHeaders();
  logAskDebug('web-research-request', {
    endpoint: `${agentBaseUrl()}/internal/web-research`,
    user_id: userId,
    message,
  });
  let response: Response;
  try {
    response = await fetch(`${agentBaseUrl()}/internal/web-research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ user_id: userId, message }),
    });
  } catch {
    throw new AskAgentError('The deployed web-research agent could not be reached.', { stage: 'agent-unavailable' });
  }
  if (!response.ok) {
    throw new AskAgentError(`Web research failed with status ${response.status}.`, {
      stage: 'agent-unavailable',
      status: response.status,
    });
  }
  const parsed = webResearchResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new AskAgentError('Web research returned an invalid response.', { stage: 'gemini' });
  const events = parsed.data.events;
  const answer = compactAdkTextChunks(events.flatMap(textFromAdkEvent));
  const result = { answer, ...webSourcesFromAdkEvents(events) };
  logAskDebug('web-research-response', {
    status: response.status,
    eventCount: events.length,
    answer: result.answer,
    sources: result.sources,
    searchSuggestions: result.searchSuggestions,
  });
  return result;
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
  const withoutRepeatedBlocks = removeRepeatedMarkdownBlocks(text);
  const paragraphs = withoutRepeatedBlocks
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length < 2) return removeRepeatedSentenceRun(withoutRepeatedBlocks);

  const seen = new Set<string>();
  const deduped: string[] = [];
  paragraphs.forEach((paragraph) => {
    const key = paragraph.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(paragraph);
  });
  return removeRepeatedSentenceRun(deduped.join('\n\n').trim());
}

function removeRepeatedSentenceRun(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length < 2) return text;
  const deduped: string[] = [];
  const seen = new Set<string>();
  sentences.forEach((sentence) => {
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key.length > 24 && seen.has(key)) return;
    if (key.length > 24) seen.add(key);
    deduped.push(sentence);
  });
  return deduped.join(' ').trim();
}

function removeRepeatedMarkdownBlocks(text: string): string {
  const headingMatches = Array.from(text.matchAll(/^###\s+What changed\b/gim));
  if (headingMatches.length < 2) return text;
  const lastMatch = headingMatches[headingMatches.length - 1];
  if (lastMatch.index === undefined) return text;
  const preamble = text.slice(0, lastMatch.index).trim();
  const openingLine = preamble.split(/\r?\n/).filter(Boolean).at(-1)?.trim();
  if (openingLine && openingLine.length > 20 && text.slice(lastMatch.index).includes(openingLine)) {
    return text.slice(lastMatch.index).trim();
  }
  return text;
}

function removeRepeatedTrailingLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return text;
  const lastLine = lines[lines.length - 1];
  const body = lines.slice(0, -1).join('\n');
  if (lastLine.length >= 10 && body.endsWith(lastLine)) return body.trim();
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

function askRetrievedEvidence(contextPack: AskContextPack | null): AskRetrievedEvidence[] {
  if (!contextPack) return [];
  const merged = new Map<string, AskRetrievedEvidence>();
  const add = (
    item: z.infer<typeof evidenceSchema>,
    fallbackReason: AskRetrievedEvidence['selectionReason'],
  ) => {
    const evidence: AskRetrievedEvidence = {
      sourceId: item.source_id,
      title: humanizeSourceTitle(item.filename),
      excerpt: item.excerpt,
      ...(item.score !== undefined ? { score: item.score } : {}),
      supports: item.supports ?? [],
      selectionReason: item.selectionReason ?? fallbackReason,
    };
    const existing = merged.get(evidence.sourceId);
    if (!existing) {
      merged.set(evidence.sourceId, evidence);
      return;
    }
    const reasonRank = (reason: AskRetrievedEvidence['selectionReason']): number =>
      reason === 'seed_provenance' ? 3 : reason === 'expanded_node_provenance' ? 2 : 1;
    merged.set(evidence.sourceId, {
      ...existing,
      excerpt: existing.excerpt.length >= evidence.excerpt.length ? existing.excerpt : evidence.excerpt,
      score: Math.max(existing.score ?? 0, evidence.score ?? 0),
      supports: Array.from(new Set([...existing.supports, ...evidence.supports])),
      selectionReason: reasonRank(existing.selectionReason) >= reasonRank(evidence.selectionReason)
        ? existing.selectionReason
        : evidence.selectionReason,
    });
  };
  contextPack.relevantEvidence.forEach((item) => add(item, 'query_match'));
  contextPack.provenanceSources.forEach((item) => add(item, 'seed_provenance'));
  contextPack.projectReasoningContext?.evidence.forEach((item) => add(item, item.selectionReason ?? 'expanded_node_provenance'));
  return Array.from(merged.values());
}

function structuredAskResponseInstructions(openQuestions: AskOpenQuestion[]): string {
  const questionTargets = openQuestions.length
    ? openQuestions.map((question) => `- ${question.id}: ${compactContextText(question.text, 360)}`).join('\n')
    : '- No open question targets are available for this turn.';
  return [
    'NORMAL ASK RESPONSE CONTRACT',
    'Return only valid JSON with this shape:',
    '{"answer":"...","outcome":"exploration|recommendation|conclusion","contextProposals":[]}',
    'Classify your own response. Use exploration when continuing discovery, asking a follow-up, discussing possibilities, or when there is not enough basis for a durable conclusion.',
    'Use recommendation when giving directional advice that should not yet resolve a project question.',
    'Use conclusion only when the conversation supports a clear, durable conclusion that directly answers one existing open project question.',
    'Only for outcome conclusion, include resolvesQuestionId and conclusion. The conclusion must be the concise answer itself, without reasoning, citations, follow-up questions, or the full response.',
    'For exploration and recommendation, omit resolvesQuestionId and conclusion.',
    'Only use one of these open question IDs as resolvesQuestionId:',
    questionTargets,
    'AI-DERIVED CONTEXT PROPOSALS',
    'The user message is first-class conversational context, and clear facts the user states are already handled by Context ingestion. Do not propose those facts again.',
    'Use contextProposals only for valuable project state that you derived through reasoning and that should not become canonical project truth without the user explicitly choosing Add.',
    'A contextProposal may represent an inferred risk, assumption, unresolved external question, decision implication, or other AI-derived project state. Do not turn a hypothetical outcome, possibility, or your own recommendation into canonical truth automatically.',
    'Do not create contextProposals for ordinary explanation, brainstorming, or a follow-up question unless the derived project state itself is materially useful to track. Keep the list empty when there is nothing that needs user confirmation.',
    'Each contextProposal must be one atomic project concept. Include type, concise text, and status OPEN, RESOLVED, or DEFERRED. The application may also use reasoning internally. Proposed state is not persisted unless the user later selects Add.',
    'When contextProposals is non-empty, answer the user normally and explain the reasoning, but do not ask for confirmation in the prose. Never end with or include a question such as "Would you like to track this?", "Should I add this?", or "Do you want to log this?" because the UI provides Add and Dismiss controls.',
    'Keep inferred claims conditional: use if, when, could, or may for outcomes not established by project context. Do not introduce unsupported business facts or state an inferred causal claim as certain.',
    'Return contextProposals as an array in the same JSON object. Use [] when no AI-derived project update is worth proposing.',
    '{"answer":"...","outcome":"exploration|recommendation|conclusion","contextProposals":[]}',
  ].join('\n');
}

function availableOpenQuestions(
  contextPack: AskContextPack | null,
  suppliedQuestions: AskOpenQuestion[],
): AskOpenQuestion[] {
  return Array.from(new Map([
    ...suppliedQuestions,
    ...(contextPack?.unresolvedGaps ?? []).map((question) => ({ id: question.id, text: question.text })),
  ].map((question) => [question.id, question] as const)).values());
}

function reasoningContextPromptSection(contextPack: AskContextPack): string | undefined {
  const reasoning = contextPack.projectReasoningContext;
  if (!reasoning) return undefined;
  const nodes = [...reasoning.seedNodes, ...reasoning.expandedNodes];
  if (nodes.length === 0 && reasoning.relationships.length === 0 && reasoning.evidence.length === 0) return undefined;
  const nodeLines = (items: typeof nodes) => items.map((node) =>
    `- ${node.id} [${node.type}, ${node.status ?? 'UNKNOWN'}] ${compactContextText(node.text, 360)}`
  ).join('\n');
  const relationshipLines = reasoning.relationships.map((edge) =>
    `- ${edge.source} -[${edge.type}]-> ${edge.target}`
  ).join('\n');
  const pathLines = reasoning.paths.map((path) =>
    `- Nodes: ${path.nodeIds.join(' → ')}; edges: ${path.edgeIds.join(', ')}`
  ).join('\n');
  const evidenceLines = reasoning.evidence.map((source) =>
    `- ${source.filename}: ${compactContextText(source.excerpt, 360)}${source.supports?.length ? ` (supports: ${source.supports.slice(0, 3).join(' · ')})` : ''}`
  ).join('\n');
  return [
    'RELEVANT PROJECT STATE',
    'This is a bounded, read-only retrieval of canonical project state for graph reasoning.',
    'Project nodes and persisted relationships are authoritative. Source excerpts are evidence. Inferences not represented by an edge must be described as inferences.',
    'Do not treat OPEN decisions as resolved. Only blocks and depends_on represent blocking/prerequisite sequencing; informs and affects do not by themselves block work.',
    'SEED NODES',
    nodeLines(reasoning.seedNodes) || '- None',
    'RELATED PROJECT STATE',
    nodeLines(reasoning.expandedNodes) || '- None',
    'RECORDED RELATIONSHIPS',
    relationshipLines || '- None',
    'RELEVANT REASONING PATHS',
    pathLines || '- None',
    'SUPPORTING SOURCES',
    evidenceLines || '- None',
  ].join('\n');
}

function contextPromptForAgent(
  message: string,
  contextPack: AskContextPack | null,
  projectId?: string,
  openQuestions: AskOpenQuestion[] = [],
  structuredResponse = true,
  focusAssessment: FocusAssessment | null = null,
  focusIntent = false,
  profile: UserMemoryProfile = DEFAULT_USER_PROFILE,
): string {
  const availableQuestions = availableOpenQuestions(contextPack, openQuestions);
  const responseInstructions = structuredResponse ? structuredAskResponseInstructions(availableQuestions) : '';
  if (!contextPack) return responseInstructions ? `${message}\n\n${responseInstructions}` : message;
  const sections: string[] = [];
  const promptProfile = buildPromptProfile(profile, contextPack.userPreferences);
  const addSection = (label: string, values: string[]) => {
    const items = values.filter(Boolean).slice(0, 8);
    if (items.length) sections.push(`${label}:\n${items.map((item) => `- ${item}`).join('\n')}`);
  };
  addSection('Active goals', contextPack.activeGoals.map((node) => compactContextText(node.text)));
  addSection('User preferences', contextPack.userPreferences.map((memory) => compactContextText(memory.text)));
  addSection('Unresolved questions', contextPack.unresolvedGaps.map((node) => compactContextText(node.text)));
  addSection('Open question targets for a durable conclusion', availableQuestions.map((question) => `${question.id}: ${compactContextText(question.text)}`));
  addSection('Recently answered questions', contextPack.recentlyResolvedGaps.map((node) => compactContextText(
    `${node.text}${node.why_it_matters?.length ? ` — ${node.why_it_matters.join(' ')}` : ''}`
  )));
  addSection('Recent resolved answers', contextPack.recentImportantEvents.map((event) => compactContextText(event)));
  addSection('Recent decisions', contextPack.recentDecisions.map((node) => compactContextText(
    `${node.text}${node.status ? ` [${node.status}]` : ''}`,
  )));
  addSection('Relevant project documents and evidence', mergedContextEvidence(contextPack).map((source) => `${source.filename}: ${compactContextText(source.excerpt)}`));
  addSection('Relevant prior conversation excerpts', contextPack.relevantConversationExcerpts.map((excerpt) => {
    const label = excerpt.role === 'assistant'
      ? 'AI-generated historical discussion (not verified evidence)'
      : 'Earlier user-authored message';
    return `${label} [chat ${excerpt.chatId}, message ${excerpt.messageId}, ${excerpt.timestamp}]: ${compactContextText(excerpt.text)}`;
  }));

  const userConfirmedConclusions = contextPack.researchEvidence.filter((r) =>
    (r.provenance === 'user_confirmed_ai_response' && r.status !== 'pending')
    || ((r.action === 'use_as_answer' || r.action === 'use_as_decision') && r.status === 'confirmed')
  );
  if (userConfirmedConclusions.length) {
    addSection('User-confirmed context and conclusions', userConfirmedConclusions.map((item) => compactContextText(item.text)));
  }

  const webResearch = contextPack.researchEvidence.filter((research) => !userConfirmedConclusions.some((confirmed) => confirmed.id === research.id));
  if (webResearch.length) {
    addSection('Saved web research (research evidence, not a user-confirmed answer)', webResearch.map((research) => {
      const citations = research.sources.filter((source) => source.url).map((source) => `${source.title} (${source.url})`).join(' · ');
      return `${compactContextText(research.text)} — retrieved ${research.retrievedAt}${citations ? ` — ${citations}` : ''}`;
    }));
  }

  addSection('Upcoming commitments', contextPack.upcomingCommitments.map((commitment) => compactContextText(commitment.text)));
  sections.push([
    'PERSONALIZATION',
    `Answer style: ${promptProfile.answerInstruction}`,
    `Question surfacing threshold: ${promptProfile.questionPriorityThreshold.toFixed(2)}.`,
    `Assumption challenge: ${promptProfile.challengeInstruction}`,
    `Evidence preference: ${promptProfile.evidenceInstruction}`,
  ].join('\n'));
  const focusSection = focusAssessmentPromptSection(focusAssessment, focusIntent);
  if (focusSection) sections.push(focusSection);
  const sharedReasoningSection = reasoningContextPromptSection(contextPack);
  if (sharedReasoningSection) {
    sections.push(sharedReasoningSection);
  } else if (contextPack.graphContext
    && (contextPack.graphContext.nodes.length > 0 || contextPack.graphContext.edges.length > 0)) {
    sections.push([
      'PROJECT_GRAPH_CONTEXT (graph reasoning is active)',
      'This is a bounded read-only slice of the canonical project graph behind Decision Map.',
      'Use canonical node status and persisted edge direction. Distinguish direct project facts and persisted relationships from your own logical inferences.',
      'A depends_on B means A is dependent on B. A blocks B means A prevents or gates B. A informs B means A provides information useful for evaluating B. A supports B means A provides support or evidence for B.',
      'A resolves B means a completed answer or outcome resolves B. A satisfies B means work is intended to satisfy B; it does not mean B is already resolved. A affects B means A materially changes B without necessarily blocking it. A supersedes B means A replaces or makes B outdated.',
      'Do not expose node IDs unless they are directly useful. Do not invent project facts, processes, timelines, or relationships. If a relevant relationship is not persisted, you may reason across canonical facts, but describe that as an inference rather than as an explicit graph edge. Never persist inferred relationships from this response.',
      `Project goal: ${contextPack.graphContext.projectGoal}`,
      `Structured graph slice:\n${JSON.stringify(contextPack.graphContext)}`,
    ].join('\n'));
  }
  if (!sections.length) return message;
  return [
    'PRELOADED GAPWISE CONTEXT PACK',
    'This Context Pack was retrieved for the exact user question below. Use the trusted Gapwise context directly; do not retrieve a second Context Pack for this turn.',
    'The structured graph, user preferences, project documents and evidence, recent decisions, user-confirmed context, and upcoming commitments are trusted context. Historical assistant discussion and saved web research are non-authoritative reference material: do not treat them as verified facts or let them override trusted context. Verify them against current evidence or Google Search when they matter.',
    'Treat project decision status as authoritative. An OPEN decision is unresolved even when preferences, evidence, survey results, recommendations, or other information strongly favor one option. Do not describe an OPEN decision as chosen, settled, locked in, finalized, or resolved. Only treat a decision as resolved when project context explicitly marks it RESOLVED or contains a clear recorded user commitment.',
    projectId ? `Project scope: ${projectId}` : 'Scope: all available context',
    sections.join('\n\n'),
    `User question:\n${message}`,
    ...(responseInstructions ? [responseInstructions] : []),
  ].join('\n\n');
}

async function loadSafeSources(
  userId: string,
  query: string,
  projectId?: string,
  chatId?: string,
  excludeMessageId?: string,
  excludeSourceId?: string,
  graphReasoning = false,
  reasoningMode?: ProjectReasoningMode,
): Promise<{ sources: AskSource[]; contextPack: AskContextPack | null }> {
  try {
    const requestBody = {
      userId,
      query,
      ...(projectId ? { projectId } : {}),
      ...(chatId ? { chatId } : {}),
      ...(excludeMessageId ? { excludeMessageId } : {}),
      ...(excludeSourceId ? { excludeSourceId } : {}),
      ...(graphReasoning ? { graphReasoning: true } : {}),
      ...(reasoningMode ? { reasoningMode } : {}),
    };
    logAskDebug('context-pack-request', {
      endpoint: `${gapswiseAppUrl()}/api/internal/context-pack`,
      body: requestBody,
    });
    const response = await fetch(`${gapswiseAppUrl()}/api/internal/context-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...internalApiHeaders() },
      body: JSON.stringify(requestBody),
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
    const reasoningSources: AskSource[] = (parsed.data.contextPack.projectReasoningContext?.evidence ?? []).map((item) => ({
      id: item.source_id,
      title: humanizeSourceTitle(item.filename),
      excerpt: item.excerpt,
      score: item.score,
      kind: 'source',
      supports: item.supports,
      reason: item.supports?.length
        ? `Selected through graph support: ${item.supports.slice(0, 2).join(' · ')}`
        : 'Selected through a related project graph node.',
    }));
    const selectedNodes = [
      ...parsed.data.contextPack.activeGoals,
      ...parsed.data.contextPack.unresolvedGaps,
      ...parsed.data.contextPack.recentlyResolvedGaps,
      ...parsed.data.contextPack.recentDecisions,
      ...parsed.data.contextPack.contradictions,
      ...(parsed.data.contextPack.projectReasoningContext?.seedNodes ?? []),
      ...(parsed.data.contextPack.projectReasoningContext?.expandedNodes ?? []),
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
    const researchSources: AskSource[] = parsed.data.contextPack.researchEvidence.flatMap((research) =>
      research.sources.filter((source) => source.kind === 'web' && source.url).map((source) => ({
        ...source,
        reason: source.reason ?? `Saved research retrieved ${research.retrievedAt}.`,
      }))
    );

    const result = {
      sources: Array.from(
        new Map(
          [...evidenceSources, ...reasoningSources, ...graphSources, ...memorySources, ...calendarSources, ...researchSources]
            .map((source) => [source.id, source])
      ).values()
      ).slice(0, 8),
      contextPack: parsed.data.contextPack,
    };
    logAskDebug('context-pack-response', {
      status: response.status,
      graphReasoning,
      sourceCount: result.sources.length,
      contextPack: result.contextPack,
    });
    return result;
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

async function loadFocusAssessment(userId: string, projectId?: string): Promise<FocusAssessment | null> {
  try {
    const response = await fetch(`${gapswiseAppUrl()}/api/internal/focus-assessment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...internalApiHeaders() },
      body: JSON.stringify({ userId, ...(projectId ? { projectId } : {}) }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { focusAssessment?: FocusAssessment | null };
    return body.focusAssessment ?? null;
  } catch {
    return null;
  }
}

export function isFocusQuestion(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return [
    'what should i focus on',
    'what should i do first',
    'what should i do next',
    'what matters most',
    'what is most important',
    'what should be my priority',
    'what should i prioritize',
    'what deserves attention',
    'what is blocking',
    'what should i address first',
  ].some((phrase) => normalized.includes(phrase));
}

export type AskRoutingDecision = AskRoute;

function isRefusal(answer: string): boolean {
  return /\b(?:i\s+(?:cannot|can't|can not|am unable to|am not able to|do not have access|don't have access|do not have a|don't have a)|as an ai|i am an ai|i'm an ai|i can only help with|i'm limited to|i am limited to)\b/i.test(answer);
}

function directEvidenceAnswer(question: string, answer: string, sources: AskSource[]): string | null {
  if (answer && !isRefusal(answer)) return null;

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

function validatedResponseMetadata(
  response: AskResponse | undefined,
  contextPack: AskContextPack | null,
  openQuestions: AskOpenQuestion[],
): Pick<AskResult, 'outcome' | 'resolvesQuestionId' | 'conclusion' | 'contextProposals' | 'proposals'> {
  const contextProposals = response?.contextProposals?.length
    ? response.contextProposals
    : normalizeAskContextProposals(response?.proposals ?? []);
  if (!response) return { outcome: 'exploration', contextProposals: [], proposals: [] };
  if (response.outcome !== 'conclusion' || !response.resolvesQuestionId || !response.conclusion) {
    return { outcome: response.outcome, contextProposals, proposals: contextProposals };
  }

  const availableQuestionIds = new Set([
    ...openQuestions.map((question) => question.id),
    ...(contextPack?.unresolvedGaps ?? []).map((question) => question.id),
  ]);
  if (!availableQuestionIds.has(response.resolvesQuestionId)) {
    return { outcome: 'recommendation', contextProposals, proposals: contextProposals };
  }
  return {
    outcome: 'conclusion',
    resolvesQuestionId: response.resolvesQuestionId,
    conclusion: response.conclusion,
    contextProposals,
    proposals: contextProposals,
  };
}

export async function askGapswise(params: {
  userId: string;
  message: string;
  sessionId?: string;
  projectId?: string;
  chatId?: string;
  excludeMessageId?: string;
  excludeSourceId?: string;
  openQuestions?: AskOpenQuestion[];
  structuredResponse?: boolean;
}): Promise<AskResult> {
  assertExternalServicesAllowed('Google ADK / Gemini');
  logAskDebug('ask-start', {
    userId: params.userId,
    projectId: params.projectId,
    chatId: params.chatId,
    message: params.message,
    sessionId: params.sessionId,
  });
  const existingSessionId = params.sessionId?.trim() || undefined;
  const initialContext = await loadSafeSources(
    params.userId,
    params.message,
    params.projectId,
    params.chatId,
    params.excludeMessageId,
    params.excludeSourceId,
  );
  let sources = initialContext.sources;
  let contextPack = initialContext.contextPack;
  let profile = await loadUserMemoryProfile(params.userId, DEFAULT_USER_PROFILE);

  const routing = await determineAskRoute(params.userId, params.message, contextPack, sources);
  logAskDebug('route-selected', {
    ...routing,
    graphReasoning: routing.route === 'graph_reasoning',
  });

  // The first Context Pack is intentionally lightweight so routing and
  // ordinary Ask requests do not pay for graph serialization. A graph slice
  // is loaded only after the router selects graph_reasoning.
  if (routing.route === 'graph_reasoning') {
    const graphContext = await loadSafeSources(
      params.userId,
      params.message,
      params.projectId,
      params.chatId,
      params.excludeMessageId,
      params.excludeSourceId,
      true,
      routing.reasoningMode ?? 'reasoning',
    );
    if (graphContext.contextPack) {
      sources = graphContext.sources;
      contextPack = graphContext.contextPack;
    }
    logAskDebug('graph-context-selected', contextPack?.graphContext ?? null);
  }

  const availableQuestions = availableOpenQuestions(contextPack, params.openQuestions ?? []);

  if (routing.route === 'web_research') {
    let webTurn: AdkTurnResult;
    try {
      webTurn = await runWebResearchTurn(params.userId, params.message);
    } catch {
      return {
        answer: 'External verification failed: the web-research agent could not complete the search.',
        ...(existingSessionId ? { sessionId: existingSessionId } : {}),
        sources: [],
        promptUsed: params.message,
        openQuestionIds: availableQuestions.map((question) => question.id),
        openQuestions: availableQuestions,
        outcome: 'exploration',
        contextProposals: [],
        proposals: [],
        execution: { route: routing.route, agent: 'Web Research Agent', toolCalls: [] },
      };
    }
    const groundedWebSources = webTurn.sources.filter((s) => s.kind === 'web' && s.url);
    if (!webTurn.answer || !groundedWebSources.length) {
      return {
        answer: 'External verification failed: no reliable grounded web sources were found for this request.',
        ...(existingSessionId ? { sessionId: existingSessionId } : {}),
        sources: [],
        promptUsed: params.message,
        searchSuggestions: webTurn.searchSuggestions,
        openQuestionIds: availableQuestions.map((question) => question.id),
        openQuestions: availableQuestions,
        outcome: 'exploration',
        contextProposals: [],
        proposals: [],
        execution: { route: routing.route, agent: 'Web Research Agent', toolCalls: ['google_search'] },
      };
    }
    return {
      answer: webTurn.answer,
      ...(existingSessionId ? { sessionId: existingSessionId } : {}),
      sources: groundedWebSources,
      promptUsed: params.message,
      searchSuggestions: webTurn.searchSuggestions,
      openQuestionIds: availableQuestions.map((question) => question.id),
      openQuestions: availableQuestions,
      outcome: 'exploration',
      contextProposals: [],
      proposals: [],
      execution: { route: routing.route, agent: 'Web Research Agent', toolCalls: ['google_search'] },
    };
  }

  // internal_context and graph_reasoning both use the Partner Agent. The
  // latter differs only by the additional bounded graph section in the prompt.
  const focusAssessment = await loadFocusAssessment(params.userId, params.projectId);
  const focusIntent = isFocusQuestion(params.message);
  const sessionId = existingSessionId ?? await createSession(params.userId, params.projectId, params.chatId);
  const promptUsed = contextPromptForAgent(
    params.message,
    contextPack,
    params.projectId,
    availableQuestions,
    params.structuredResponse !== false,
    focusAssessment,
    focusIntent,
    profile,
  );
  const adkTurn = await runAdkTurn(
    params.userId,
    sessionId,
    promptUsed,
  );
  const internalSources = sources.filter((s) => s.kind !== 'web');
  const directAnswer = directEvidenceAnswer(params.message, adkTurn.answer, internalSources);
  const metadata = directAnswer
    ? { outcome: 'exploration' as const, contextProposals: [], proposals: [] }
    : validatedResponseMetadata(adkTurn.response, contextPack, availableQuestions);
  const graph = contextPack?.graphContext;
  const reasoningContext = contextPack?.projectReasoningContext;
  const graphTrace = graph ? {
    reasoningMode: reasoningContext?.mode ?? routing.reasoningMode,
    startingNodeIds: graph.startingNodeIds,
    selectedNodeIds: graph.nodes.map((node) => node.id),
    selectedEdges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
    })),
    paths: reasoningContext?.paths ?? [],
    retrievedEvidence: askRetrievedEvidence(contextPack),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  } : {
    reasoningMode: reasoningContext?.mode ?? routing.reasoningMode,
    startingNodeIds: [],
    selectedNodeIds: [],
    selectedEdges: [],
    paths: [],
    retrievedEvidence: askRetrievedEvidence(contextPack),
    nodeCount: 0,
    edgeCount: 0,
  };
  const result = {
    answer: directAnswer ?? adkTurn.answer,
    ...metadata,
    sessionId,
    sources: internalSources,
    openQuestionIds: availableQuestions.map((question) => question.id),
    openQuestions: availableQuestions,
    promptUsed,
    searchSuggestions: adkTurn.searchSuggestions,
    retrievedEvidence: askRetrievedEvidence(contextPack),
    execution: { route: routing.route, agent: 'Partner Agent', toolCalls: ['ADK /run_sse'] },
    ...(routing.route === 'graph_reasoning' ? { graphReasoning: graphTrace } : {}),
  };
  logAskDebug('ask-complete', result);
  return result;
}
