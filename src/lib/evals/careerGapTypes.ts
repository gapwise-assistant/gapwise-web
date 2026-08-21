import type { GapAnswerability, GapAssessmentV1, GapDecisionChangeLikelihood, GapEscalationReason, GapSuppressionReason } from '@/lib/agents/gapContractV1';
import type { ContextPack, DurableMemory } from '@/types/contextPack';
import type { GapGuidance, Project } from '@/types/clarity';
import type { SafeCalendarEvent } from '@/types/google';

export const CAREER_GAP_FIXTURE_VERSION = 'career-gap-v1' as const;

export type CareerGapConcept =
  | 'role_acceptability'
  | 'transition_credibility'
  | 'steady_state_work_mix'
  | 'total_compensation'
  | 'work_flexibility'
  | 'interview_timeline'
  | 'success_metrics';

export type CareerGapMutation =
  | { type: 'record_conditional_frontend_acceptance' }
  | { type: 'confirm_backend_ai_transition' }
  | { type: 'resolve_total_compensation' }
  | { type: 'resolve_steady_state_work_mix'; frontendPercent?: number }
  | { type: 'reject_permanent_frontend_and_complete_decision' }
  | { type: 'add_conflicting_work_mix_evidence' }
  | { type: 'add_conflicting_transition_evidence' }
  | { type: 'remove_backend_ai_preference' }
  | { type: 'make_financial_stability_dominant' }
  | { type: 'remove_financial_concern' }
  | { type: 'set_recruiter_call_offset'; minutes: number }
  | { type: 'replace_calendar_with_unrelated_event'; minutes: number }
  | { type: 'add_semantic_transition_answer' }
  | { type: 'supersede_frontend_preference' }
  | { type: 'make_transition_and_compensation_close' }
  | { type: 'resolve_lower_value_unknowns' };

export type ExpectedAttentionUrgency = 'critical' | 'normal' | 'low';
export type ExpectedPartnerAction = 'ask_now' | 'surface_without_interrupting' | 'do_not_ask';

export interface CareerGapCandidateExpectation {
  concept: CareerGapConcept;
  answerability?: GapAnswerability;
  suppressionReason?: GapSuppressionReason | null;
}

export interface CareerGapGoldenCase {
  id: string;
  title: string;
  mutations: CareerGapMutation[];
  expectedTopGapConcept: CareerGapConcept | null;
  acceptableAlternativeConcepts: CareerGapConcept[];
  forbiddenGapConcepts: CareerGapConcept[];
  expectedAnswerability?: GapAnswerability;
  expectedDecisionChangeLikelihood?: GapDecisionChangeLikelihood;
  expectedCandidateStates?: CareerGapCandidateExpectation[];
  requiredEvidenceIds: string[];
  expectedAttentionUrgency: ExpectedAttentionUrgency;
  expectedPartnerAction: ExpectedPartnerAction;
  expectedEscalation?: {
    eligible: boolean;
    reasons: GapEscalationReason[];
  };
  goldRationale: string;
}

export interface CareerGapStrategyInput {
  fixtureVersion: typeof CAREER_GAP_FIXTURE_VERSION;
  caseId: string;
  fixedNow: string;
  fixtureHash: string;
  project: Project;
  memories: DurableMemory[];
  calendarEvents: SafeCalendarEvent[];
  contextPack: ContextPack;
}

export interface CareerGapStrategyResult {
  gapAssessment: GapAssessmentV1;
  guidance: GapGuidance | null;
  attention: { urgency: ExpectedAttentionUrgency };
  partner: { action: ExpectedPartnerAction };
  runtime?: {
    model: string;
    thinkingLevel: string;
    maxOutputTokens: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    estimatedCost: number | null;
    escalated: boolean;
  };
}

export interface CareerGapStrategy {
  id: string;
  label: string;
  run(input: CareerGapStrategyInput): Promise<CareerGapStrategyResult> | CareerGapStrategyResult;
}

export const CAREER_GAP_NODE_BY_CONCEPT: Record<CareerGapConcept, string> = {
  role_acceptability: 'unknown_career_role_acceptability',
  transition_credibility: 'unknown_career_backend_path',
  steady_state_work_mix: 'unknown_career_frontend_split',
  total_compensation: 'unknown_career_total_compensation',
  work_flexibility: 'unknown_career_flexibility',
  interview_timeline: 'unknown_career_interview_timeline',
  success_metrics: 'unknown_career_success_metrics',
};

export function careerGapConceptForNodeId(nodeId: string): CareerGapConcept | null {
  const entry = Object.entries(CAREER_GAP_NODE_BY_CONCEPT)
    .find(([, candidateNodeId]) => candidateNodeId === nodeId);
  return (entry?.[0] as CareerGapConcept | undefined) ?? null;
}

export function careerGapConceptForGapId(gapId: string | null): CareerGapConcept | null {
  if (!gapId) return null;
  return careerGapConceptForNodeId(gapId.replace(/^gap:/, ''));
}
