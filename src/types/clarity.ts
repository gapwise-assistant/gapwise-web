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
  /**
   * Optional semantic identity metadata for extracted questions. The raw node
   * remains in the persisted graph for provenance, while reasoning/UI
   * projections can collapse aliases and subordinate questions onto the
   * canonical node.
   */
  question_role?: 'canonical' | 'alias' | 'subquestion' | 'assumption' | 'related';
  canonical_question_id?: string;
  question_aliases?: string[];
  reconciliation_confidence?: number;
  reconciliation_reason?: string;
  reconciliation_status?: 'reconciled' | 'fallback' | 'pending';
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
  reconciliation_summary?: QuestionReconciliationSummary;
}

export interface QuestionReconciliationSummary {
  candidate_count: number;
  canonical_merge_count: number;
  subquestion_count: number;
  assumption_count: number;
  new_question_count: number;
  fallback_count: number;
  validation_status: 'passed' | 'fallback' | 'unavailable';
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

export type DecisionValueLevel = 'none' | 'low' | 'medium' | 'high';

export type ExpectedActionChange =
  | 'same_action'
  | 'could_confirm'
  | 'could_change_scope'
  | 'could_change_sequence'
  | 'could_change_risk'
  | 'could_flip_decision';

export interface DecisionValueTarget {
  node_id: string;
  node_type: Extract<NodeType, 'GOAL' | 'DECISION' | 'NEXT_ACTION' | 'RISK' | 'CONSTRAINT'>;
  label: string;
  importance: number;
  relationship: EdgeType;
  path_node_ids: string[];
  path_edge_ids: string[];
}

/**
 * Inspectable structural value of resolving one gap. Scores remain internal;
 * normal product surfaces use `level` and `reason` only.
 */
export interface DecisionValueAssessment {
  score: number;
  level: DecisionValueLevel;
  expected_action_change: ExpectedActionChange;
  structural_leverage: number;
  affected_targets: DecisionValueTarget[];
  strongest_path: DecisionValueTarget | null;
  urgency_contribution: number;
  answerability_contribution: number;
  acquisition_cost: number;
  acquisition_difficulty: 'low' | 'medium' | 'high';
  evidence_strength: 'none' | 'partial' | 'strong' | 'conflicting';
  downstream_reversibility: 'unknown' | 'reversible' | 'partly_reversible' | 'hard_to_reverse';
  meaningful_effect_count: number;
  reason: string;
}

export interface GapGuidance {
  focus: string;
  whyNow: string;
  nextStep: string;
  whatCouldChange: string;
  supportingIds: string[];
  generatedBy: 'gap-agent' | 'deterministic';
}

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
  decision_value?: DecisionValueAssessment;
  guidance?: GapGuidance;
}

export interface QuestionFeedback {
  id: string;
  question_id: string;
  node_id: string;
  rating: 'helpful' | 'irrelevant' | 'already_answered' | 'too_detailed' | 'wrong_framing';
  timestamp: string;
  answer?: string;
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
