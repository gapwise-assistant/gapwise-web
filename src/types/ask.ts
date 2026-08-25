export type AskScopeType = 'general' | 'project';
export type AskMessageRole = 'user' | 'assistant';
export type AskTargetType = 'question' | 'decision';

export interface AskTarget {
  type: AskTargetType;
  id: string;
  text: string;
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

export interface AskResponse {
  answer: string;
  outcome: AskOutcome;
  resolvesQuestionId?: string;
  conclusion?: string;
}

export type AskRoute = 'web_research' | 'internal_context' | 'graph_reasoning';

export interface AskGraphReasoningTrace {
  startingNodeIds: string[];
  selectedNodeIds: string[];
  selectedEdges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
  }>;
  nodeCount: number;
  edgeCount: number;
}

export interface AskExecution {
  route: AskRoute;
  agent: string;
  toolCalls: string[];
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
