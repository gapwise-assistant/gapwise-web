export interface TraceAgentConfig {
  agentName: string;
  model: string;
  thinkingLevel: string;
  maxOutputTokens: number;
  execution: 'used' | 'would_use' | 'not_used';
}

export type TraceValidationStatus = 'passed' | 'failed' | 'not_run';

export interface TraceAgentRun {
  runId: string;
  agent: string;
  model: string;
  thinkingLevel: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCost: number | null;
  /** Explains whether cost came from provider usage, configured rates, or is unavailable. */
  costSource?: 'provider_usage' | 'configured_rates' | 'unavailable' | 'zero_cost_simulation' | 'zero_cost_deterministic';
  validationStatus: TraceValidationStatus;
  confidence: number | null;
  escalated: boolean;
  escalationReason?: string;
  execution: 'used' | 'would_use' | 'not_used' | 'deterministic';
  inputSummary: string;
  outputSummary: string;
}

export interface TraceGapCandidate {
  id: string;
  rank: number;
  priority: number;
  confidence: number;
  summary: string;
  decisionValue?: {
    score: number;
    level: 'none' | 'low' | 'medium' | 'high';
    expectedActionChange: string;
    affectedTargets: Array<{ id: string; type: string }>;
    strongestPathNodeIds: string[];
    strongestRelationship: string | null;
    structuralLeverage: number;
    urgencyContribution: number;
    answerabilityContribution: number;
    acquisitionDifficulty: 'low' | 'medium' | 'high';
    evidenceStrength: 'none' | 'partial' | 'strong' | 'conflicting';
    downstreamReversibility: 'unknown' | 'reversible' | 'partly_reversible' | 'hard_to_reverse';
    reason: string;
  };
}

export interface TraceGapAnalysis {
  candidates: TraceGapCandidate[];
  selectedGapId: string | null;
  /** True when scoped evidence answered every candidate, so no new question was selected. */
  retrievalAnswered?: boolean;
  selectionReason: string;
  confidence: number | null;
  evidenceIds: string[];
  escalated: boolean;
  escalationReason?: string;
  escalationModel?: string;
  escalationThinkingLevel?: string;
  escalationMaxOutputTokens?: number;
}

export interface TraceGapComparison {
  mode: 'deterministic' | 'shadow' | 'live';
  deterministicGapId: string | null;
  agentGapId: string | null;
  effectiveGapId: string | null;
  agreement: boolean | null;
  fallbackUsed: boolean;
  runId?: string;
  validationStatus: TraceValidationStatus;
  failureReason?: 'transport' | 'timeout' | 'contract' | 'graph_reference' | 'unavailable';
}

export interface TraceHandoff {
  id: string;
  from: string;
  to: string;
  inputCount: number;
  outputCount: number;
  selectedIds: string[];
  summary: string;
}

export interface TraceContextSummary {
  scope?: string;
  includedContextCount: number;
  goalCount: number;
  unresolvedGapCount: number;
  evidenceCount: number;
  preferenceCount: number;
  decisionCount: number;
  commitmentCount: number;
}

export interface TracePipelineStep {
  name: string;
  agentName?: string;
  summary: string;
  execution: 'used' | 'would_use' | 'not_used' | 'deterministic';
  contextCount?: number;
}

export type CalendarSyncStepStatus = 'started' | 'completed' | 'failed';

export interface CalendarSyncTraceStep {
  name: string;
  status: CalendarSyncStepStatus;
  startedAt: string;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
}

export interface CalendarSyncTrace {
  runId: string;
  projectId: string | null;
  status: 'running' | 'completed' | 'failed';
  steps: CalendarSyncTraceStep[];
}

export interface CalendarContextPackTrace {
  projectId: string;
  projectSemanticVersion: string;
  assessmentId: string | null;
  cacheStatus: 'hit' | 'miss';
  stale: boolean;
  relevantEventIds: string[];
  commitmentIds: string[];
  refreshScheduled: boolean;
}

export interface TraceDecisionAnchoring {
  decisionId: string | null;
  decisionTitle: string;
  questionNodeIds: string[];
  linkCount: number;
  source: 'context_agent' | 'deterministic_fallback' | 'user_confirmation';
}

export interface TraceEvent {
  id: string;
  userId: string;
  route: string;
  label: string;
  started_at: string;
  duration_ms: number;
  agentNames: string[];
  contextIds: string[];
  scores: Array<{ id: string; score: number }>;
  toolCalls: string[];
  /** Sanitized provider/model identifier only; never prompts or context. */
  model?: string;
  agentConfigs?: TraceAgentConfig[];
  agentRuns?: TraceAgentRun[];
  gapAnalysis?: TraceGapAnalysis;
  gapComparison?: TraceGapComparison;
  handoffs?: TraceHandoff[];
  contextSummary?: TraceContextSummary;
  pipelineSteps?: TracePipelineStep[];
  decisionAnchoring?: TraceDecisionAnchoring;
  /** Client-rendered, deterministic Decision Map instrumentation. */
  decisionMapDebug?: DecisionMapDebugTrace;
  /** Semantic event metadata used by the compact Decision Map Activity feed. */
  decisionMapActivity?: import('@/lib/graph/decisionMapActivity').PersistedDecisionMapActivity;
  /** Whether this Ask turn used the graph-reasoning capability. */
  askGraphReasoning?: boolean;
  /** Sanitized development-only graph context used by a graph-reasoning Ask turn. */
  askGraphReasoningContext?: import('@/types/ask').AskGraphReasoningTrace;
  /** True when the event describes a deterministic demo simulation, not an AI call. */
  simulation?: boolean;
  /** Correlated explicit Calendar sync diagnostics, available in Developer Trace only. */
  calendarSync?: CalendarSyncTrace;
  /** Cache-only Calendar Context Pack diagnostics. */
  calendarContextPack?: CalendarContextPackTrace;
  error?: string;
}
import type { DecisionMapDebugTrace } from '@/lib/graph/decisionMapDebug';
