import type { CandidateGap } from '@/types/clarity';
import type { TraceGapCandidate } from '@/types/observability';

export function decisionValueForTrace(gap: CandidateGap): TraceGapCandidate['decisionValue'] {
  const value = gap.decision_value;
  if (!value) return undefined;
  return {
    score: value.score,
    level: value.level,
    expectedActionChange: value.expected_action_change,
    affectedTargets: value.affected_targets.map((target) => ({
      id: target.node_id,
      type: target.node_type,
    })),
    strongestPathNodeIds: value.strongest_path?.path_node_ids ?? [],
    strongestRelationship: value.strongest_path?.relationship ?? null,
    structuralLeverage: value.structural_leverage,
    urgencyContribution: value.urgency_contribution,
    answerabilityContribution: value.answerability_contribution,
    acquisitionDifficulty: value.acquisition_difficulty,
    evidenceStrength: value.evidence_strength,
    downstreamReversibility: value.downstream_reversibility,
    reason: value.strongest_path
      ? `${value.expected_action_change.replaceAll('_', ' ')} through a ${value.strongest_path.path_node_ids.length - 1}-step ${value.strongest_path.relationship} path; ${value.acquisition_difficulty} acquisition difficulty.`
      : 'No represented path to a live decision, action, or goal.',
  };
}
