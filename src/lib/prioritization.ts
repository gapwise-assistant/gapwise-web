import { ClarityNode, ClarityEdge, CandidateGap, UserMemoryProfile, Project } from '@/types/clarity';

/**
 * 7-factor decision impact scoring formula:
 * priority = 0.30*uncertainty + 0.30*downstream_impact + 0.15*dependency_count_norm
 *          + 0.10*urgency + 0.10*answerability + 0.05*user_relevance - 0.10*interruption_cost
 */
export function calculateGapPriority(
  node: ClarityNode,
  project: Project,
  profile: UserMemoryProfile
): CandidateGap {
  const uncertainty = Math.max(0, Math.min(1, 1 - node.confidence));
  const downstreamImpact = Math.max(0, Math.min(1, node.impact || 0.7));

  const dependentEdges = project.edges.filter(
    (e) =>
      (e.source === node.id || e.target === node.id) &&
      (e.type === 'blocks' || e.type === 'depends_on' || e.type === 'informs')
  );

  const dependencyCount = dependentEdges.length;
  const maxDeps = Math.max(1, project.nodes.length - 1);
  const dependencyCountNorm = Math.min(1, dependencyCount / Math.min(5, maxDeps));

  const blockedDecisionNodes = project.nodes.filter(
    (n) =>
      n.type === 'DECISION' &&
      dependentEdges.some((e) => e.source === n.id || e.target === n.id)
  );
  const blockedDecisionIds = blockedDecisionNodes.map((n) => n.id);

  const urgency = project.deadline ? 0.85 : 0.6;

  let answerability = 0.8;
  if (profile.evidence_preference === 'strict_data' && node.source_refs.length === 0) {
    answerability = 0.6;
  }

  const userRelevance = profile.challenge_level === 'high' ? 0.9 : 0.75;
  const interruptionCost = profile.question_frequency === 'low' ? 0.25 : 0.05;

  const rawScore =
    0.3 * uncertainty +
    0.3 * downstreamImpact +
    0.15 * dependencyCountNorm +
    0.1 * urgency +
    0.1 * answerability +
    0.05 * userRelevance -
    0.1 * interruptionCost;

  const priority = Math.max(0, Math.min(1, Number(rawScore.toFixed(3))));

  const reasons: string[] = [];
  if (blockedDecisionNodes.length > 0) {
    reasons.push(`Blocks decision: "${blockedDecisionNodes[0].text.slice(0, 60)}"`);
  } else {
    reasons.push('Blocks primary project goal execution');
  }
  if (downstreamImpact >= 0.8) reasons.push('High downstream impact on feature scope & architecture');
  if (uncertainty > 0.7) reasons.push('Currently unverified — low supporting evidence');
  if (reasons.length < 2) reasons.push('Determines the 4-minute hackathon demo scenario');

  let questionText = node.text;
  if (!questionText.trim().endsWith('?')) {
    questionText = `Clarify: ${questionText}?`;
  }

  return {
    node_id: node.id,
    question: questionText,
    uncertainty,
    downstream_impact: downstreamImpact,
    dependency_count: dependencyCount,
    urgency,
    answerability,
    user_relevance: userRelevance,
    interruption_cost: interruptionCost,
    priority,
    reasons: reasons.slice(0, 3),
    blocked_decision_ids: blockedDecisionIds,
  };
}

/** Ranks all UNKNOWN / weak ASSUMPTION nodes and returns the top priority gap. */
export function selectTopGap(project: Project, profile: UserMemoryProfile): CandidateGap | null {
  const candidateNodes = project.nodes.filter(
    (n) =>
      (n.type === 'UNKNOWN' || (n.type === 'ASSUMPTION' && n.confidence < 0.6)) &&
      n.status === 'OPEN'
  );
  if (candidateNodes.length === 0) return null;
  const candidates = candidateNodes.map((node) => calculateGapPriority(node, project, profile));
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0];
}

/** Overall project Clarity Score 0–100 */
export function calculateClarityScore(project: Project): number {
  if (project.nodes.length === 0) return 0;
  const totalNodes = project.nodes.length;
  const resolvedNodes = project.nodes.filter(
    (n) => n.status === 'RESOLVED' || (n.type === 'DECISION' && n.status !== 'OPEN' && n.status !== 'DEFERRED') || n.type === 'KNOWN'
  ).length;
  const highConfAssumptions = project.nodes.filter(
    (n) => n.type === 'ASSUMPTION' && n.confidence >= 0.7
  ).length;
  const evidenceCount = project.nodes.filter((n) => n.type === 'EVIDENCE').length;
  const score =
    (resolvedNodes / totalNodes) * 50 +
    (highConfAssumptions / Math.max(1, totalNodes)) * 25 +
    Math.min(25, evidenceCount * 5);
  return Math.min(100, Math.round(score));
}
