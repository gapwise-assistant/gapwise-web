import type { NodeType } from '@/types/clarity';

export type AskScopeType = 'general' | 'project';
export type AskMessageRole = 'user' | 'assistant';
export type AskTargetType = 'question' | 'decision';

export interface AskTarget {
  type: AskTargetType;
  id: string;
  text: string;
}

/**
 * A user action that moves from a project/general-context surface into a
 * fresh, targeted Ask conversation.
 */
export interface PendingAskHandoff {
  id: string;
  scopeType: AskScopeType;
  projectId?: string;
  prompt: string;
  target: AskTarget;
}

export type AskSourceKind = 'source' | 'graph' | 'memory' | 'calendar' | 'web';

export interface AskSource {
  id: string;
  title: string;
  excerpt: string;
  score?: number;
  kind: AskSourceKind;
  supports?: string[];
  reason?: string;
  url?: string;
  retrievedAt?: string;
  groundingMetadata?: Record<string, unknown>;
}

export interface AskSearchSuggestions {
  renderedContent?: string;
  webSearchQueries?: string[];
}

export type AskOutcome = 'exploration' | 'recommendation' | 'conclusion';
export type AskResponseOutcome = AskOutcome;

export type AskContextProposalStatus = 'OPEN' | 'RESOLVED' | 'DEFERRED';
export type AskProposalConfirmationStatus = 'pending' | 'added' | 'dismissed' | 'proposed';
/** @deprecated Use AskProposalConfirmationStatus for UI confirmation state. */
export type AskProposalStatus = AskProposalConfirmationStatus;

export interface AskContextProposal {
  id?: string;
  type: NodeType;
  text: string;
  reasoning?: string;
  /** The lifecycle status that will be used if the user selects Add. */
  status: AskContextProposalStatus;
  sourceMessageId?: string;
  /** The proposal remains separate from project state until this is added. */
  confirmationStatus?: AskProposalConfirmationStatus;
  /** Compatibility for proposal records written by the first implementation. */
  suggestedStatus?: AskContextProposalStatus;
}

const askContextProposalStatuses = new Set<AskContextProposalStatus>([
  'OPEN',
  'RESOLVED',
  'DEFERRED',
]);
const askProposalConfirmationStatuses = new Set<AskProposalConfirmationStatus>([
  'proposed',
  'added',
  'dismissed',
]);

/**
 * Normalizes proposal records from the current and pre-confirmation formats.
 * Older records used `suggestedStatus` for graph state and `status` for the
 * Add/Dismiss lifecycle; new records keep those meanings separate.
 */
export function normalizeAskContextProposal(value: unknown): AskContextProposal | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string' || typeof record.text !== 'string' || !record.text.trim()) return null;

  const rawStatus = typeof record.status === 'string' ? record.status : undefined;
  const legacyGraphStatus = typeof record.suggestedStatus === 'string' && askContextProposalStatuses.has(record.suggestedStatus as AskContextProposalStatus)
    ? record.suggestedStatus as AskContextProposalStatus
    : undefined;
  const rawConfirmationStatus = typeof record.confirmationStatus === 'string' && askProposalConfirmationStatuses.has(record.confirmationStatus as AskProposalConfirmationStatus)
    ? record.confirmationStatus as AskProposalConfirmationStatus
    : undefined;
  const confirmationStatus: AskProposalConfirmationStatus = rawConfirmationStatus === 'added' || rawStatus === 'added'
    ? 'added'
    : rawConfirmationStatus === 'dismissed' || rawStatus === 'dismissed'
      ? 'dismissed'
      : 'pending';
  const graphStatus = legacyGraphStatus
    ?? (rawStatus && askContextProposalStatuses.has(rawStatus as AskContextProposalStatus)
      ? rawStatus as AskContextProposalStatus
      : 'OPEN');

  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    type: record.type as NodeType,
    text: record.text.trim(),
    reasoning: typeof record.reasoning === 'string' ? record.reasoning.trim() : undefined,
    status: graphStatus,
    sourceMessageId: typeof record.sourceMessageId === 'string' ? record.sourceMessageId : undefined,
    confirmationStatus,
    ...(legacyGraphStatus ? { suggestedStatus: legacyGraphStatus } : {}),
  };
}

export function normalizeAskContextProposals(value: unknown): AskContextProposal[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeAskContextProposal)
    .filter((proposal): proposal is AskContextProposal => Boolean(proposal));
}

export interface AskResponse {
  answer: string;
  outcome: AskOutcome;
  resolvesQuestionId?: string;
  conclusion?: string;
  contextProposals?: AskContextProposal[];
  /** Compatibility alias for older Ask responses and persisted messages. */
  proposals?: AskContextProposal[];
}

export type AskRoute = 'web_research' | 'internal_context' | 'graph_reasoning';

export interface AskGraphReasoningTrace {
  reasoningMode?: 'factual' | 'reasoning' | 'impact' | 'decision' | 'focus';
  startingNodeIds: string[];
  selectedNodeIds: string[];
  selectedEdges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
  }>;
  paths?: Array<{
    nodeIds: string[];
    edgeIds: string[];
  }>;
  retrievedEvidence?: AskRetrievedEvidence[];
  nodeCount: number;
  edgeCount: number;
}

export type AskRetrievedEvidenceSelectionReason =
  | 'query_match'
  | 'seed_provenance'
  | 'expanded_node_provenance';

export interface AskRetrievedEvidence {
  sourceId: string;
  title: string;
  excerpt: string;
  score?: number;
  supports: string[];
  selectionReason?: AskRetrievedEvidenceSelectionReason;
}

export interface AskExecution {
  route: AskRoute;
  agent: string;
  toolCalls: string[];
  /** Identifies deterministic demo output separately from a live agent run. */
  mode?: 'live' | 'simulated';
  fixtureId?: string;
  fixtureVersion?: number;
}

export interface AskOpenQuestion {
  id: string;
  text: string;
}

export interface AskResult {
  answer: string;
  outcome?: AskResponseOutcome;
  resolvesQuestionId?: string;
  conclusion?: string;
  contextProposals?: AskContextProposal[];
  /** Compatibility alias for older Ask responses and persisted messages. */
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
  /** The project evidence actually supplied to the Partner Agent for this turn. */
  retrievedEvidence?: AskRetrievedEvidence[];
  /** Development-only routing diagnostics; removed from the public API response. */
  graphReasoning?: AskGraphReasoningTrace;
}

export interface AskChatSession {
  id: string;
  userId: string;
  scopeType: AskScopeType;
  projectId?: string;
  title: string;
  adkSessionId?: string;
  target?: AskTarget;
  createdAt: string;
  updatedAt: string;
}

export interface AskChatMessage {
  id: string;
  chatId: string;
  userId: string;
  projectId?: string;
  role: AskMessageRole;
  text: string;
  outcome?: AskResponseOutcome;
  resolvesQuestionId?: string;
  conclusion?: string;
  contextProposals?: AskContextProposal[];
  /** Compatibility alias for older persisted Ask messages. */
  proposals?: AskContextProposal[];
  sources: AskSource[];
  createdAt: string;
  openQuestionIds?: string[];
  openQuestions?: AskOpenQuestion[];
  searchSuggestions?: AskSearchSuggestions;
  execution?: AskExecution;
}

export interface AskResearchEvidence {
  id: string;
  userId: string;
  chatId: string;
  assistantMessageId: string;
  projectId?: string;
  text: string;
  sources: AskSource[];
  retrievedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Optional while reading records created before research actions were persisted. */
  action?: 'save' | 'use_as_answer' | 'use_as_decision' | 'save_as_context';
  targetQuestionId?: string;
  targetDecisionId?: string;
  answerFingerprint?: string;
  /** A question/decision confirmation is pending until the graph write and research write both succeed. */
  status?: 'pending' | 'confirmed';
  provenance: 'assistant_web_research_confirmed_by_user' | 'user_confirmed_ai_response';
}

export interface RelevantConversationExcerpt {
  chatId: string;
  messageId: string;
  role: AskMessageRole;
  text: string;
  scopeType: AskScopeType;
  projectId?: string;
  timestamp: string;
}
