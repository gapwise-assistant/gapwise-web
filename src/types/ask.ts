export type AskScopeType = 'general' | 'project';
export type AskMessageRole = 'user' | 'assistant';

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

export type AskRoute = 'web_research' | 'internal_context' | 'ask_clarification';

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
}

export interface AskChatSession {
  id: string;
  userId: string;
  scopeType: AskScopeType;
  projectId?: string;
  title: string;
  adkSessionId?: string;
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
  sources: AskSource[];
  createdAt: string;
  openQuestionIds?: string[];
  openQuestions?: AskOpenQuestion[];
  searchSuggestions?: AskSearchSuggestions;
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
  action?: 'save' | 'use_as_answer' | 'save_as_context';
  targetQuestionId?: string;
  answerFingerprint?: string;
  /** A use-as-answer record is pending until the graph answer and research write both succeed. */
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
