import { rankGaps } from '@/lib/tools/graphTools';
import type { ContextPack, DurableMemory } from '@/types/contextPack';
import type { ClarityNode, Project } from '@/types/clarity';
import { gapAgentOutputSchema, type GapAgentOutput } from '@/lib/agents/schemas';
import {
  GAP_CONTRACT_VERSION,
  gapAssessmentV1Schema,
  type GapAcquisitionPath,
  type GapAnswerability,
  type GapAssessmentV1,
  type GapCandidateV1,
  type GapDecisionRelationship,
  type GapEscalationReason,
  type GapSuppressionReason,
} from '@/lib/agents/gapContractV1';

export interface GapAssessmentV1Input {
  project: Project;
  contextPack: ContextPack;
  memories: DurableMemory[];
}

interface ScoredCandidate {
  candidate: GapCandidateV1;
  score: number;
}

const GENERIC_QUESTIONS = [
  /^what should i (do|know|clarify)\??$/i,
  /^what is missing\??$/i,
  /^what matters\??$/i,
  /^clarify this\??$/i,
];

function category(value: number): 'low' | 'medium' | 'high' {
  if (value >= 0.8) return 'high';
  if (value >= 0.55) return 'medium';
  return 'low';
}

interface RetrievalScope {
  nodeIds: Set<string>;
  sourceIds: Set<string>;
  hasGapSelection: boolean;
}

function retrievalScope(contextPack: ContextPack): RetrievalScope {
  const selectedGapNodes = [
    ...contextPack.unresolvedGaps,
    ...contextPack.recentlyResolvedGaps,
    ...contextPack.contradictions,
  ];
  const nodeIds = new Set(selectedGapNodes.map((node) => node.id));
  const sourceIds = new Set([
    ...contextPack.relevantEvidence.map((source) => source.source_id),
    ...contextPack.provenanceSources.map((source) => source.source_id),
  ]);

  // An empty pack is possible for a brand-new project or a caller that has
  // not requested a scoped retrieval yet. Keep the graph fallback in that
  // case; once retrieval has selected gaps, do not let unrelated graph nodes
  // leak into the Gap Agent's candidate set.
  return {
    nodeIds,
    sourceIds,
    hasGapSelection: selectedGapNodes.length > 0,
  };
}

function candidateNodes(project: Project, contextPack: ContextPack): ClarityNode[] {
  const scope = retrievalScope(contextPack);
  return project.nodes.filter((node) => {
    const isGap = node.type === 'UNKNOWN' || (node.type === 'ASSUMPTION' && node.confidence < 0.6);
    if (!isGap) return false;
    if (!scope.hasGapSelection) return true;
    return scope.nodeIds.has(node.id)
      || node.source_refs.some((sourceId) => scope.sourceIds.has(sourceId));
  });
}

function findDecisionPaths(project: Project, sourceId: string): string[][] {
  const openDecisionIds = new Set(
    project.nodes
      // A decision can be marked resolved while still representing the
      // product choice this uncertainty informs (for example, a demo scope
      // decision that is being revisited). Only deprecated decisions are out
      // of the reasoning graph entirely.
      .filter((node) => node.type === 'DECISION' && node.status !== 'DEPRECATED')
      .map((node) => node.id),
  );
  const outgoing = new Map<string, string[]>();
  project.edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });

  const paths: string[][] = [];
  const queue: string[][] = [[sourceId]];
  const shortestSeen = new Map<string, number>([[sourceId, 1]]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path.at(-1)!;
    if (path.length > 1 && openDecisionIds.has(current)) {
      paths.push(path);
      continue;
    }
    if (path.length >= 6) continue;
    for (const next of outgoing.get(current) ?? []) {
      if (path.includes(next)) continue;
      const nextLength = path.length + 1;
      if ((shortestSeen.get(next) ?? Number.POSITIVE_INFINITY) < nextLength) continue;
      shortestSeen.set(next, nextLength);
      queue.push([...path, next]);
    }
  }
  return paths.sort((left, right) => left.length - right.length);
}

function relationshipFor(node: ClarityNode): GapDecisionRelationship {
  const text = node.text.toLowerCase();
  if (/timeline|how quickly|when /.test(text)) return 'could_change_sequence';
  if (/compensation|equity|vesting|salary|office days|on-call|after-hours/.test(text)) return 'could_change_risk';
  if (/success|criteria|confirm|verify/.test(text)) return 'could_confirm';
  if (/percentage|how much|which/.test(text)) return 'could_narrow';
  return 'could_flip';
}

function evidenceFor(project: Project, node: ClarityNode, contextPack: ContextPack): string[] {
  const scope = retrievalScope(contextPack);
  const retrievedSourceIds = new Set(scope.sourceIds);
  const retrievedEvidence = [
    ...contextPack.relevantEvidence,
    ...contextPack.provenanceSources,
  ];
  // The candidate's own source links are part of the selected graph context,
  // even when the excerpt ranker did not include every linked document. This
  // preserves provenance for guidance validation and prevents a relevant
  // source from becoming invisible merely because another excerpt ranked
  // higher.
  const ids = new Set(node.source_refs);

  // A source can be retrieved because it derives the node even when the
  // graph's source_refs have not been backfilled yet. Prefer that scoped
  // provenance over unrelated source links.
  retrievedEvidence
    .filter((source) => source.derived_node_ids.includes(node.id))
    .forEach((source) => ids.add(source.source_id));

  const adjacentNodeIds = project.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => edge.source === node.id ? edge.target : edge.source);
  project.nodes
    .filter((candidate) => adjacentNodeIds.includes(candidate.id) && candidate.type !== 'DECISION')
    .forEach((candidate) => {
      const hasContradiction = project.edges.some((edge) =>
        edge.type === 'contradicts'
        && ((edge.source === node.id && edge.target === candidate.id)
          || (edge.target === node.id && edge.source === candidate.id)),
      );
      candidate.source_refs
        .filter((sourceId) => retrievedSourceIds.has(sourceId) || hasContradiction)
        .forEach((id) => ids.add(id));
    });

  // Preserve graph provenance when a Context Pack was built without source
  // excerpts. This keeps the assessment useful for older projects while a
  // scoped pack remains the primary evidence boundary.
  if (ids.size === 0 && retrievedEvidence.length === 0) {
    node.source_refs.forEach((id) => ids.add(id));
  }
  return [...ids].filter((id) => project.sources.some((source) => source.id === id));
}

function answerabilityFor(
  project: Project,
  node: ClarityNode,
  evidenceIds: string[],
  retrievedEvidence: Array<{ sourceId: string; text: string }> = [],
): { answerability: GapAnswerability; conflictingEvidenceIds: string[] } {
  const resolutionEdges = project.edges.filter((edge) =>
    edge.target === node.id && ['resolves', 'supersedes'].includes(edge.type),
  );
  if (node.status === 'RESOLVED' || resolutionEdges.length > 0) {
    return { answerability: 'answered', conflictingEvidenceIds: [] };
  }

  const conflictEdges = project.edges.filter((edge) =>
    (edge.source === node.id || edge.target === node.id) && edge.type === 'contradicts',
  );
  const conflictSourceIds = new Set<string>();
  for (const edge of conflictEdges) {
    const adjacentId = edge.source === node.id ? edge.target : edge.source;
    project.nodes.find((candidate) => candidate.id === adjacentId)?.source_refs
      .forEach((sourceId) => conflictSourceIds.add(sourceId));
  }
  const explicitConflictSources = evidenceIds.filter((sourceId) =>
    /explicit conflict marker/i.test(project.sources.find((source) => source.id === sourceId)?.content ?? ''),
  );
  [...explicitConflictSources].forEach((id) => conflictSourceIds.add(id));
  if (conflictSourceIds.size >= 2) {
    const conflicts = [...conflictSourceIds];
    return {
      answerability: 'conflicting',
      conflictingEvidenceIds: conflicts,
    };
  }

  // A retrieved source can close a gap without a user answer when it states a
  // clear, affirmative result. Do not treat mentions or pending/negative
  // statuses as answers: “legal has not approved” is useful evidence, but the
  // approval gap remains open.
  const questionTerms = node.text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((term) => term.length >= 5);
  const hasDirectAnswer = retrievedEvidence.some(({ text }) => {
    const lower = text.toLowerCase();
    const overlap = questionTerms.filter((term) => lower.includes(term)).length;
    if (overlap < Math.min(3, Math.max(2, Math.ceil(questionTerms.length * 0.35)))) return false;
    if (/\b(has not|have not|not yet|pending|unresolved|unknown|not approved|not demonstrated|cannot|can't|failed|stop condition)\b/i.test(lower)) {
      return false;
    }
    return /\b(approved|confirmed|demonstrated|verified|passed|successful|completed|accepted|authorized|available|yes)\b/i.test(lower);
  });
  if (hasDirectAnswer) {
    return { answerability: 'answered', conflictingEvidenceIds: [] };
  }

  return {
    answerability: evidenceIds.length > 0 ? 'partially_answered' : 'unanswered',
    conflictingEvidenceIds: [],
  };
}

function acquisitionPathFor(node: ClarityNode): GapAcquisitionPath {
  const text = node.text.toLowerCase();
  if (/acceptable|preference|willing|priority/.test(text)) return 'ask_user';
  if (/percentage|backend|applied ai|compensation|equity|office|on-call|interview|success/.test(text)) {
    return 'ask_other_person';
  }
  if (/measure|test|experiment/.test(text)) return 'run_experiment';
  if (/when will|wait for/.test(text)) return 'wait_for_event';
  return 'retrieve_existing_context';
}

function suppressionFor(
  node: ClarityNode,
  answerability: GapAnswerability,
  hasDecision: boolean,
  duplicate: boolean,
): GapSuppressionReason | null {
  if (node.status === 'DEPRECATED') return 'obsolete';
  if (answerability === 'answered') return 'already_answered';
  if (duplicate) return 'duplicate';
  if (GENERIC_QUESTIONS.some((pattern) => pattern.test(node.text.trim()))) return 'too_generic';
  if (node.text.length > 260 || /everything|all (the )?(things|questions|information)/i.test(node.text)) return 'too_broad';
  if (!hasDecision) return 'not_decision_relevant';
  return null;
}

function normalizedQuestion(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function structuralFallbackScore(node: ClarityNode, pathCount: number): number {
  return Number((0.45 * (1 - node.confidence) + 0.45 * node.impact + 0.1 * Math.min(1, pathCount / 2)).toFixed(3));
}

function decisionChangeCategory(
  value: NonNullable<ReturnType<typeof rankGaps>[number]['decision_value']>,
): 'low' | 'medium' | 'high' {
  if (value.expected_action_change === 'could_flip_decision' && value.structural_leverage >= 0.55) return 'high';
  if (value.expected_action_change !== 'same_action' && value.structural_leverage >= 0.35) return 'medium';
  return 'low';
}

/**
 * Deterministic V1 adapter used by local runtime, shadow comparison, and the
 * candidate scaffold sent to the live ADK Gap Agent.
 */
export function assessGapsV1Deterministically(input: GapAssessmentV1Input): GapAssessmentV1 {
  const rankedGaps = rankGaps(input.project);
  const currentGaps = new Map(rankedGaps.map((gap) => [gap.node_id, gap]));
  const seenQuestions = new Set<string>();
  const scored: ScoredCandidate[] = candidateNodes(input.project, input.contextPack).map((node) => {
    const paths = findDecisionPaths(input.project, node.id);
    const evidenceIds = evidenceFor(input.project, node, input.contextPack);
    const retrievedEvidence = [
      ...input.contextPack.relevantEvidence,
      ...input.contextPack.provenanceSources,
    ]
      .filter((source) => evidenceIds.includes(source.source_id))
      .map((source) => ({ sourceId: source.source_id, text: `${source.filename} ${source.excerpt}` }));
    const evidenceReview = answerabilityFor(input.project, node, evidenceIds, retrievedEvidence);
    const normalized = normalizedQuestion(node.text);
    const duplicate = seenQuestions.has(normalized);
    seenQuestions.add(normalized);
    const suppressionReason = suppressionFor(
      node,
      evidenceReview.answerability,
      paths.length > 0,
      duplicate,
    );
    const affectedDecisions = paths.map((path) => ({
      decisionId: path.at(-1)!,
      relationship: relationshipFor(node),
      pathNodeIds: path,
    }));
    const rankedGap = currentGaps.get(node.id);
    const decisionValue = rankedGap?.decision_value;
    const candidate: GapCandidateV1 = {
      schemaVersion: GAP_CONTRACT_VERSION,
      gapId: `gap:${node.id}`,
      sourceUnknownNodeIds: [node.id],
      question: node.text,
      targetUnknown: node.text,
      affectedDecisions,
      evidenceReview: { evidenceIds, ...evidenceReview },
      decisionChangeLikelihood: decisionValue
        ? decisionChangeCategory(decisionValue)
        : category((1 - node.confidence) * node.impact),
      decisionImpact: category(decisionValue?.strongest_path?.importance ?? node.impact),
      assessmentConfidence: evidenceReview.answerability === 'conflicting'
        ? 'low'
        : evidenceReview.answerability === 'unanswered'
          ? 'low'
          : evidenceReview.answerability === 'answered'
            ? 'high'
            : 'medium',
      acquisitionPath: suppressionReason ? null : acquisitionPathFor(node),
      whyItMatters: decisionValue?.reason
        ?? node.why_it_matters?.[0]
        ?? `Resolving this could change ${affectedDecisions.length === 1 ? 'a live decision' : 'live decisions'}.`,
      suppressionReason,
    };
    return {
      candidate,
      // This preserves the current ranker as the comparison baseline. The V1
      // contract itself keeps urgency/interruption outside Gap Agent ownership.
      score: rankedGap?.priority ?? structuralFallbackScore(node, paths.length),
    };
  });

  const actionable = scored
    .filter(({ candidate }) => candidate.suppressionReason === null)
    .sort((left, right) => right.score - left.score || left.candidate.gapId.localeCompare(right.candidate.gapId));
  const selected = actionable[0] ?? null;
  const escalationReasons = new Set<GapEscalationReason>();
  const second = actionable[1];
  if (selected && second && selected.score - second.score <= 0.04) escalationReasons.add('close_candidates');
  if (selected?.candidate.evidenceReview.answerability === 'conflicting') escalationReasons.add('conflicting_evidence');
  if (selected?.candidate.assessmentConfidence === 'low') escalationReasons.add('low_confidence');
  if (selected?.candidate.decisionImpact === 'high') escalationReasons.add('high_impact');
  if (selected?.candidate.affectedDecisions.some((decision) => decision.pathNodeIds.length >= 4)) {
    escalationReasons.add('complex_path');
  }

  return gapAssessmentV1Schema.parse({
    schemaVersion: GAP_CONTRACT_VERSION,
    candidates: scored.map(({ candidate }) => candidate),
    selectedGapId: selected?.candidate.gapId ?? null,
    suppressedGapIds: scored
      .filter(({ candidate }) => candidate.suppressionReason !== null)
      .map(({ candidate }) => candidate.gapId),
    selectionRationale: selected
      ? `Selected the highest-ranked unsuppressed gap affecting a live decision: ${selected.candidate.targetUnknown}`
      : 'No unresolved decision-relevant gap remains after evidence review and suppression.',
    escalationEligible: escalationReasons.size > 0,
    escalationReasons: [...escalationReasons],
  });
}

/**
 * The runtime and the four-agent orchestrator consume the same validated
 * assessment. Keeping this adapter here prevents the deterministic fallback,
 * shadow comparison, and live route from quietly selecting different gaps.
 */
export function gapAgentOutputFromAssessment(
  project: Project,
  assessment: GapAssessmentV1,
): GapAgentOutput {
  const selected = assessment.candidates.find((candidate) => candidate.gapId === assessment.selectedGapId);
  const selectedNodeId = selected?.sourceUnknownNodeIds[0] ?? null;
  const ranked = selectedNodeId
    ? rankGaps(project).find((candidate) => candidate.node_id === selectedNodeId)
    : null;
  const retrievalAnswered = assessment.candidates.length > 0
    && assessment.selectedGapId === null
    && assessment.candidates.every((candidate) => candidate.evidenceReview.answerability === 'answered');

  return gapAgentOutputSchema.parse({
    selectedGapNodeId: selectedNodeId,
    question: selected?.question ?? null,
    priority: ranked?.priority ?? null,
    retrievalAnswered,
    reasons: [assessment.selectionRationale],
  });
}

/**
 * Older projects can contain a lone UNKNOWN before a DECISION node exists.
 * The V1 contract correctly suppresses that node as not decision-relevant;
 * callers may use this compatibility fallback to keep the existing question
 * surface usable until the graph has a decision target.
 */
export function hasLiveDecision(project: Project): boolean {
  return project.nodes.some((node) => node.type === 'DECISION' && node.status !== 'DEPRECATED');
}
