import { CandidateGap, NodeType, EdgeType, Project, QuestionReconciliationSummary, ContextProcessingLog, ProjectHistoryEvent, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AppScope } from '@/types/scope';
import { AskChatMessage, AskChatSession, AskResearchEvidence } from '@/types/ask';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';
import type { ProjectSnapshot, ProjectSnapshotSummary } from '@/types/projectSnapshot';
import type { GoogleIntegrationState } from '@/types/google';

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
  question_role?: 'canonical' | 'alias' | 'subquestion' | 'assumption' | 'related';
  canonical_question_id?: string;
  decision_outcome?: string;
  canonical_node_id?: string;
  reconciliation_classification?: Project['nodes'][number]['reconciliation_classification'];
  question_aliases?: string[];
  reconciliation_confidence?: number;
  reconciliation_reason?: string;
  reconciliation_status?: 'reconciled' | 'fallback' | 'pending';
}

export interface FirestoreEdge extends BaseEntity {
  source: string;
  target: string;
  type: EdgeType;
  confidence?: number;
  scope?: 'project' | 'global';
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
  semantic_contribution?: boolean;
  discarded_at?: string;
  reconciliation_summary?: QuestionReconciliationSummary;
  processing_log?: ContextProcessingLog;
}

export interface FirestoreContext extends BaseEntity {
  title: string;
  goal: string;
  deadline?: string;
  one_sentence_context?: string;
  clarity_score: number;
  active_question?: CandidateGap | null;
  historyEvents?: ProjectHistoryEvent[];
  branch?: Project['branch'];
  semantic_version?: string;
}

export interface FirestoreConversation extends BaseEntity {
  question: string;
  answer: string;
  graph_diff_summary: string;
  nodeId?: string;
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
  answer?: string;
}

export interface FirestoreEvent extends BaseEntity {
  eventType: string;
  payload: Record<string, any>;
}

export interface FocusAssessmentCacheRecord {
  id: string;
  userId: string;
  projectId: string;
  projectStateVersion: string;
  assessment: FocusAssessment | null;
  createdAt: string;
  updatedAt: string;
  provenance?: {
    origin: 'branched_snapshot';
    sourceSnapshotId: string;
  };
}

export interface ProjectOverviewAssessmentCacheRecord {
  id: string;
  userId: string;
  projectId: string;
  projectStateVersion: string;
  assessment: ProjectOverviewAssessment;
  createdAt: string;
  updatedAt: string;
  provenance?: {
    origin: 'branched_snapshot';
    sourceSnapshotId: string;
  };
}

export interface AskSuggestionsCacheRecord {
  id: string;
  userId: string;
  projectId?: string;
  scopeKey: string;
  projectStateVersion: string;
  /** The project-only revision used for cheap read-path staleness checks. */
  semanticProjectVersion?: string;
  topQuestions: string[];
  otherQuestions: string[];
  generatedBy: string;
  createdAt: string;
  updatedAt: string;
  status?: 'ready' | 'stale' | 'failed';
}

export type DeveloperGenerationRunStatus = 'running' | 'completed' | 'failed';

export type DeveloperGenerationStepCategory =
  | 'project'
  | 'source'
  | 'ask'
  | 'proposal'
  | 'resolution'
  | 'storage'
  | 'snapshot'
  | 'assessment'
  | 'validation';

export type DeveloperGenerationStepStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface DeveloperGenerationRun {
  id: string;
  userId: string;
  projectId: string;
  generator: string;
  status: DeveloperGenerationRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  currentStep?: string;
  error?: string;
}

export interface DeveloperGenerationStep {
  id: string;
  runId: string;
  userId: string;
  projectId: string;
  sequence: number;
  name: string;
  category: DeveloperGenerationStepCategory;
  status: DeveloperGenerationStepStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  reloadedProjectId?: string;
  sourceId?: string;
  filename?: string;
  chatId?: string;
  messageId?: string;
  proposalId?: string;
  historyEventId?: string;
  snapshotId?: string;
  nodeCountBefore?: number;
  nodeCountAfter?: number;
  edgeCountBefore?: number;
  edgeCountAfter?: number;
  derivedNodeIds?: string[];
  journeyAnchor?: string;
  candidateNodeIds?: string[];
  processingOutcome?: 'changed' | 'no_change' | 'failed';
  summary?: string;
  error?: string;
}

export interface StorageProvider {
  readonly kind: StorageMode;
  readonly capabilities: {
    durableProjectState: boolean;
    durableSnapshots: boolean;
  };

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
  deleteEdge(userId: string, edgeId: string): Promise<void>;

  getSources(userId: string): Promise<FirestoreSource[]>;
  saveSource(userId: string, source: FirestoreSource): Promise<void>;
  deleteSource(userId: string, sourceId: string): Promise<void>;

  getConversations(userId: string): Promise<FirestoreConversation[]>;
  saveConversation(userId: string, conversation: FirestoreConversation): Promise<void>;

  getAskChats(userId: string): Promise<AskChatSession[]>;
  saveAskChat(userId: string, chat: AskChatSession): Promise<void>;
  deleteAskChat(userId: string, chatId: string): Promise<void>;
  getAskMessages(userId: string): Promise<AskChatMessage[]>;
  saveAskMessage(userId: string, message: AskChatMessage): Promise<void>;
  getAskResearch(userId: string): Promise<AskResearchEvidence[]>;
  saveAskResearch(userId: string, research: AskResearchEvidence): Promise<void>;
  getFocusAssessment(userId: string, cacheId: string): Promise<FocusAssessmentCacheRecord | null>;
  saveFocusAssessment(userId: string, record: FocusAssessmentCacheRecord): Promise<void>;
  getProjectOverviewAssessment(userId: string, cacheId: string): Promise<ProjectOverviewAssessmentCacheRecord | null>;
  saveProjectOverviewAssessment(userId: string, record: ProjectOverviewAssessmentCacheRecord): Promise<void>;
  getAskSuggestionsCache(userId: string, cacheId: string): Promise<AskSuggestionsCacheRecord | null>;
  getLatestAskSuggestionsCache(userId: string, projectId: string): Promise<AskSuggestionsCacheRecord | null>;
  getProjectSemanticVersion(userId: string, projectId: string): Promise<string | null>;
  saveAskSuggestionsCache(userId: string, record: AskSuggestionsCacheRecord): Promise<void>;

  listDeveloperGenerationRuns(userId: string, projectId?: string): Promise<DeveloperGenerationRun[]>;
  getDeveloperGenerationRun(userId: string, runId: string): Promise<DeveloperGenerationRun | null>;
  saveDeveloperGenerationRun(userId: string, run: DeveloperGenerationRun): Promise<void>;
  getDeveloperGenerationSteps(userId: string, runId: string): Promise<DeveloperGenerationStep[]>;
  saveDeveloperGenerationStep(userId: string, step: DeveloperGenerationStep): Promise<void>;

  listProjectSnapshots(userId: string, projectId: string): Promise<ProjectSnapshotSummary[]>;
  getProjectSnapshot(userId: string, snapshotId: string): Promise<ProjectSnapshot | null>;
  saveProjectSnapshot(userId: string, snapshot: ProjectSnapshot): Promise<void>;

  getFeedback(userId: string): Promise<FirestoreFeedback[]>;
  saveFeedback(userId: string, feedback: FirestoreFeedback): Promise<void>;
  deleteFeedback(userId: string, feedbackId: string): Promise<void>;

  getMemories(userId: string): Promise<DurableMemory[]>;
  saveMemory(userId: string, memory: DurableMemory): Promise<void>;
  replaceMemories(userId: string, memories: DurableMemory[]): Promise<void>;
  getUserMemoryProfile(userId: string): Promise<UserMemoryProfile | null>;
  saveUserMemoryProfile(userId: string, profile: UserMemoryProfile): Promise<void>;
  getGoogleIntegrations?(userId: string): Promise<GoogleIntegrationState[]>;
  replaceGoogleIntegrations?(userId: string, integrations: GoogleIntegrationState[]): Promise<void>;

  logEvent(userId: string, event: FirestoreEvent): Promise<void>;

  /** Remove all persisted user data before loading a deterministic demo seed. */
  resetUserData(userId: string): Promise<void>;

  resetDemoData(userId: string): Promise<void>;
}

export type StorageMode = 'mock' | 'firestore';

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'UNAUTHENTICATED'
      | 'PERMISSION_DENIED'
      | 'NOT_FOUND'
      | 'UNAVAILABLE'
      | 'VALIDATION_ERROR'
      | 'CONFIGURATION_ERROR'
  ) {
    super(message);
  }
}
