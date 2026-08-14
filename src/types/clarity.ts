export type NodeType =
  | 'GOAL'
  | 'KNOWN'
  | 'CONSTRAINT'
  | 'ASSUMPTION'
  | 'DECISION'
  | 'UNKNOWN'
  | 'EVIDENCE'
  | 'EXPERIMENT'
  | 'RISK'
  | 'NEXT_ACTION'
  | 'PREFERENCE';

export type EdgeType =
  | 'supports'
  | 'contradicts'
  | 'depends_on'
  | 'blocks'
  | 'informs'
  | 'resolves'
  | 'derived_from'
  | 'supersedes'
  | 'affects';

export interface SourceRef {
  id: string;
  filename: string;
  snippet?: string;
}

export interface ClarityNode {
  id: string;
  type: NodeType;
  text: string;
  status: 'OPEN' | 'RESOLVED' | 'DEFERRED' | 'DEPRECATED';
  confidence: number;
  impact: number;
  priority?: number;
  source_refs: string[];
  why_it_matters?: string[];
  created_by: 'user' | 'agent' | 'rag';
  created_at: string;
  updated_at: string;
  x?: number;
  y?: number;
}

export interface ClarityEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  confidence?: number;
}

export interface ContextSource {
  id: string;
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

export interface UserMemoryProfile {
  answer_density: 'concise' | 'balanced' | 'detailed';
  question_frequency: 'low' | 'moderate' | 'high';
  challenge_level: 'low' | 'moderate' | 'high';
  evidence_preference: 'research_first' | 'intuition_allowed' | 'strict_data';
  brainstorm_style: 'diverge_then_converge' | 'direct_to_solution';
  uncertainty_style: 'explicit' | 'implicit';
  durable_notes?: string[];
}

export type { DurableMemory, MemoryCategory } from '@/types/contextPack';

export interface CandidateGap {
  node_id: string;
  question: string;
  uncertainty: number;
  downstream_impact: number;
  dependency_count: number;
  urgency: number;
  answerability: number;
  user_relevance: number;
  interruption_cost: number;
  priority: number;
  reasons: string[];
  blocked_decision_ids: string[];
}

export interface QuestionFeedback {
  id: string;
  question_id: string;
  node_id: string;
  rating: 'helpful' | 'irrelevant' | 'already_answered' | 'too_detailed' | 'wrong_framing';
  timestamp: string;
}

export interface Project {
  id: string;
  title: string;
  goal: string;
  status?: 'active' | 'archived';
  deadline?: string;
  one_sentence_context?: string;
  clarity_score: number;
  nodes: ClarityNode[];
  edges: ClarityEdge[];
  sources: ContextSource[];
  active_question?: CandidateGap | null;
  history: {
    question: string;
    answer: string;
    timestamp: string;
    graph_diff_summary: string;
  }[];
  created_at: string;
  updated_at: string;
}

export type WorldDomainType =
  | 'work'
  | 'personal'
  | 'learning'
  | 'finance'
  | 'health'
  | 'relationships'
  | 'operations'
  | 'unknown';

export type WorldNodeType = 'DOMAIN' | 'PROJECT' | 'GOAL' | 'SOURCE' | 'GAP' | 'PREFERENCE' | 'RISK';

export interface WorldNode {
  id: string;
  type: WorldNodeType;
  label: string;
  domain: WorldDomainType;
  summary: string;
  priority: number;
  source_refs: string[];
  linked_node_ids: string[];
  status: 'active' | 'resolved' | 'watch';
}

export interface WorldEdge {
  id: string;
  source: string;
  target: string;
  type: 'contains' | 'influences' | 'blocks' | 'supports' | 'derived_from';
  strength: number;
}

export interface WorldDomainSummary {
  domain: WorldDomainType;
  label: string;
  project_count: number;
  source_count: number;
  open_gap_count: number;
  risk_count: number;
  priority: number;
}

export interface MyWorldGraph {
  userId: string;
  generated_at: string;
  nodes: WorldNode[];
  edges: WorldEdge[];
  domains: WorldDomainSummary[];
}
