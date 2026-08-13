import { AttentionCandidate, AttentionScoreFactors } from '@/types/attention';

export function normalize(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

export function calculateAttentionScore(factors: AttentionScoreFactors): number {
  return normalize(
    0.25 * factors.goal_alignment +
      0.2 * factors.impact +
      0.15 * factors.urgency +
      0.15 * factors.actionability +
      0.1 * factors.evidence_confidence +
      0.1 * factors.unresolved_risk +
      0.05 * factors.momentum -
      0.1 * factors.estimated_effort
  );
}

export function withAttentionScore(candidate: Omit<AttentionCandidate, 'score'>): AttentionCandidate {
  return {
    ...candidate,
    score: calculateAttentionScore(candidate.factors),
  };
}
