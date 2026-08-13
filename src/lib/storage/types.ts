import { CandidateGap, NodeType, EdgeType, Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AppScope } from '@/types/scope';

export interface BaseEntity {
  id: string;
  userId: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  sourceIds?: string[];
}

export interface FirestoreNode extends BaseEntity {
  createdBy?: 'user' | 'agent' | 'rag';
  type: NodeType;
  text: string;
  scope: string; // e.g. "project", "session", "global"
  confidence: number; // 0..1
  importance: number; // 0..1
  priority?: number;
  lastVerifiedAt?: string;
  supersededBy?: string;
  why_it_matters?: string[];
  x?: number;
  y?: number;
}

export interface FirestoreEdge extends BaseEntity {
  source: string;
  target: string;
  type: EdgeType;
  confidence?: number;
}

export interface FirestoreSource extends BaseEntity {
  scope?: 'project' | 'global';
  filename: string;
  type: 'text' | 'pdf' | 'image' | 'note' | 'voice';
  content: string;
  extracted_at: string;
  derived_node_ids: string[];
  processing_status?: 'pending' | 'processing' | 'completed' | 'failed';
  storage_url?: string;
  mime_type?: string;
  size_bytes?: number;
  hash?: string;
  origin?: 'user' | 'connector';
  extraction_summary?: string;
  error_message?: string;
  processed_at?: string;
  model_used?: string;
  extraction_hash?: string;
  relevance?: 'relevant' | 'possibly_not_relevant';
  discarded_at?: string;
}

export interface FirestoreContext extends BaseEntity {
  title: string;
  goal: string;
  deadline?: string;
  one_sentence_context?: string;
  clarity_score: number;
  active_question?: CandidateGap | null;
}

export interface FirestoreConversation extends BaseEntity {
  question: string;
  answer: string;
  graph_diff_summary: string;
}

export interface FirestoreRecommendation extends BaseEntity {
  question: string;
  priority: number;
  blocked_decision_ids: string[];
  reasons: string[];
}

export interface FirestoreFeedback extends BaseEntity {
  question_id: string;
  node_id: string;
  rating: 'helpful' | 'irrelevant' | 'already_answered' | 'too_detailed' | 'wrong_framing';
}

export interface FirestoreEvent extends BaseEntity {
  eventType: string;
  payload: Record<string, any>;
}

export interface StorageProvider {
  listProjects(userId: string): Promise<Project[]>;
  getProject(userId: string, projectId?: string): Promise<Project | null>;
  saveProject(userId: string, project: Project): Promise<void>;
  getActiveProjectId(userId: string): Promise<string | null>;
  setActiveProjectId(userId: string, projectId: string): Promise<void>;
  getAppScope(userId: string): Promise<AppScope>;
  setAppScope(userId: string, scope: AppScope): Promise<void>;

  getContexts(userId: string): Promise<FirestoreContext[]>;
  saveContext(userId: string, context: FirestoreContext): Promise<void>;

  getNodes(userId: string): Promise<FirestoreNode[]>;
  saveNode(userId: string, node: FirestoreNode): Promise<void>;
  deleteNode(userId: string, nodeId: string): Promise<void>;

  getEdges(userId: string): Promise<FirestoreEdge[]>;
  saveEdge(userId: string, edge: FirestoreEdge): Promise<void>;

  getSources(userId: string): Promise<FirestoreSource[]>;
  saveSource(userId: string, source: FirestoreSource): Promise<void>;
  deleteSource(userId: string, sourceId: string): Promise<void>;

  getConversations(userId: string): Promise<FirestoreConversation[]>;
  saveConversation(userId: string, conversation: FirestoreConversation): Promise<void>;

  getFeedback(userId: string): Promise<FirestoreFeedback[]>;
  saveFeedback(userId: string, feedback: FirestoreFeedback): Promise<void>;

  getMemories(userId: string): Promise<DurableMemory[]>;
  saveMemory(userId: string, memory: DurableMemory): Promise<void>;
  replaceMemories(userId: string, memories: DurableMemory[]): Promise<void>;

  logEvent(userId: string, event: FirestoreEvent): Promise<void>;

  resetDemoData(userId: string): Promise<void>;
}

export type StorageMode = 'mock' | 'firestore';

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'UNAUTHENTICATED'
      | 'PERMISSION_DENIED'
      | 'UNAVAILABLE'
      | 'VALIDATION_ERROR'
      | 'CONFIGURATION_ERROR'
  ) {
    super(message);
  }
}
