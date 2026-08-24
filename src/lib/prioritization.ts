import type { CandidateGap, ClarityNode, Project, UserMemoryProfile } from '@/types/clarity';
import { calculateDecisionValue, type DecisionValueOptions } from '@/lib/decisionValue';
import { createDeterministicGapGuidance } from '@/lib/agents/gapGuidance';
import { projectForReasoning } from '@/lib/context/sourceState';

/**
 * Ranks one unresolved gap by the expected downstream value of resolving it.
 * The single decisionValue assessment is also retained for developer inspection.
 */
export function calculateGapPriority(
  node: ClarityNode,
  project: Project,
  profile: UserMemoryProfile,
  options: DecisionValueOptions = {},
): CandidateGap {
  const uncertainty = Math.max(0, Math.min(1, 1 - node.confidence));
  const decisionValue = calculateDecisionValue(node, project, profile, options);
  const guidance = createDeterministicGapGuidance({ node, project, decisionValue });
  const blockedDecisionIds = decisionValue.affected_targets
    .filter((target) => target.node_type === 'DECISION')
    .map((target) => target.node_id);
  const userRelevance = profile.challenge_level === 'high' ? 0.9 : 0.75;
  const interruptionCost = profile.question_frequency === 'low' ? 0.25 : 0.05;

  const reasons = [decisionValue.reason];
  if (decisionValue.evidence_strength === 'conflicting') {
    reasons.push('Existing evidence conflicts, so the current direction is not dependable yet.');
  } else if (decisionValue.evidence_strength === 'none') {
    reasons.push('No supporting evidence is attached yet.');
  }

  const question = node.text;

  return {
    node_id: node.id,
    question,
    uncertainty,
    downstream_impact: decisionValue.structural_leverage,
    dependency_count: decisionValue.meaningful_effect_count,
    urgency: decisionValue.urgency_contribution,
    answerability: decisionValue.answerability_contribution,
    user_relevance: userRelevance,
    interruption_cost: interruptionCost,
    priority: decisionValue.score,
    reasons: reasons.slice(0, 3),
    blocked_decision_ids: blockedDecisionIds,
    decision_value: decisionValue,
    guidance,
  };
}

/** Ranks all open UNKNOWN / ASSUMPTION nodes and returns the top meaningful gap. */
export function selectTopGap(project: Project, profile: UserMemoryProfile): CandidateGap | null {
  const reasoningProject = projectForReasoning(project);
  const candidateNodes = reasoningProject.nodes.filter(
    (node) =>
      (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') &&
      node.status === 'OPEN',
  );
  if (candidateNodes.length === 0) return null;
  return candidateNodes
    .map((node) => calculateGapPriority(node, reasoningProject, profile))
    .sort((left, right) => right.priority - left.priority || left.node_id.localeCompare(right.node_id))[0];
}

/** Selects the highest-impact open uncertainty or decision for Today. */
export function selectTopAttentionItem(
  project: Project,
  _profile?: UserMemoryProfile,
): ClarityNode | null {
  const candidates = project.nodes.filter((node) =>
    node.status === 'OPEN' &&
    (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION' || node.type === 'DECISION')
  );

  if (candidates.length === 0) return null;

  return candidates
    .slice()
    .sort((left, right) => {
      const leftScore = left.impact * left.confidence;
      const rightScore = right.impact * right.confidence;

      return rightScore - leftScore || left.id.localeCompare(right.id);
    })[0] ?? null;
}

/** Overall project Clarity Score 0–100 */
export function calculateClarityScore(project: Project): number {
  const reasoningProject = projectForReasoning(project);
  if (reasoningProject.nodes.length === 0) return 0;
  const totalNodes = reasoningProject.nodes.length;
  const resolvedNodes = reasoningProject.nodes.filter(
    (node) =>
      node.status === 'RESOLVED' ||
      (node.type === 'DECISION' && node.status !== 'OPEN' && node.status !== 'DEFERRED') ||
      node.type === 'KNOWN',
  ).length;
  const highConfAssumptions = reasoningProject.nodes.filter(
    (node) => node.type === 'ASSUMPTION' && node.confidence >= 0.7,
  ).length;
  const evidenceCount = reasoningProject.nodes.filter((node) => node.type === 'EVIDENCE').length;
  const score =
    (resolvedNodes / totalNodes) * 50 +
    (highConfAssumptions / Math.max(1, totalNodes)) * 25 +
    Math.min(25, evidenceCount * 5);
  return Math.min(100, Math.round(score));
}
