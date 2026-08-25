import { ClarityNode, ContextSource, Project, UserMemoryProfile } from '@/types/clarity';
import { AppScope } from '@/types/scope';
import { AskChatMessage, AskResearchEvidence, RelevantConversationExcerpt } from '@/types/ask';

export type MemoryCategory = 'career' | 'communication' | 'learning' | 'current_priorities' | 'custom';

export interface DurableMemory {
  id: string;
  userId?: string;
  category: MemoryCategory;
  text: string;
  source: 'explicit' | 'repeated_fact' | 'user_confirmed' | 'seed';
  source_refs: string[];
  confidence: number;
  status?: 'active' | 'forgotten';
  created_at: string;
  updated_at: string;
  createdAt?: string;
  updatedAt?: string;
  last_confirmed_at?: string;
  lastConfirmedAt?: string;
  expires_at?: string;
  forgotten_at?: string;
  why_remembered: string;
  provenance?: string;
}

export interface EvidenceExcerpt {
  source_id: string;
  filename: string;
  excerpt: string;
  score: number;
  derived_node_ids: string[];
  supports?: string[];
}

export interface AskGraphContext {
  projectGoal: string;
  nodes: Array<{
    id: string;
    type: ClarityNode['type'];
    status: ClarityNode['status'];
    text: string;
    confidence: number;
    impact: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    confidence?: number;
  }>;
  startingNodeIds: string[];
}

export interface ContextPack {
  id: string;
  query: string;
  built_at: string;
  activeGoals: ClarityNode[];
  recentImportantEvents: string[];
  unresolvedGaps: ClarityNode[];
  recentlyResolvedGaps: ClarityNode[];
  relevantEvidence: EvidenceExcerpt[];
  provenanceSources: EvidenceExcerpt[];
  userPreferences: DurableMemory[];
  upcomingCommitments: ClarityNode[];
  recentDecisions: ClarityNode[];
  contradictions: ClarityNode[];
  includedContextIds: string[];
  relevantConversationExcerpts?: RelevantConversationExcerpt[];
  researchEvidence?: AskResearchEvidence[];
  graphContext?: AskGraphContext;
}

export interface ContextPackInput {
  userId: string;
  query: string;
  project: Project;
  profile: UserMemoryProfile;
  durableMemories?: DurableMemory[];
  calendarCommitments?: ClarityNode[];
  conversationMessages?: AskChatMessage[];
  researchEvidence?: AskResearchEvidence[];
  /** Include recent scope sources even when a broad exploratory query has no term match. */
  includeBroadContext?: boolean;
  scope?: AppScope;
  excludeMessageId?: string;
  excludeSourceId?: string;
  /** Build the bounded canonical graph slice used only by graph-reasoning Ask. */
  graphReasoning?: boolean;
  limits?: Partial<Record<keyof Omit<ContextPack, 'id' | 'query' | 'built_at' | 'includedContextIds' | 'provenanceSources' | 'graphContext'>, number>>;
}

export type SourceLike = Pick<
  ContextSource,
  | 'id'
  | 'filename'
  | 'type'
  | 'content'
  | 'extracted_at'
  | 'derived_node_ids'
  | 'mime_type'
  | 'storage_url'
  | 'extraction_summary'
  | 'processed_at'
>;
