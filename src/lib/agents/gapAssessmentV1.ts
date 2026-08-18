import { rankGaps } from '@/lib/tools/graphTools';
import type { ContextPack, DurableMemory } from '@/types/contextPack';
import type { ClarityNode, Project } from '@/types/clarity';
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

function candidateNodes(project: Project): ClarityNode[] {
  return project.nodes.filter((node) =>
    node.type === 'UNKNOWN' || (node.type === 'ASSUMPTION' && node.confidence < 0.6),
  );
}

function findDecisionPaths(project: Project, sourceId: string): string[][] {
  const openDecisionIds = new Set(
    project.nodes
      .filter((node) => node.type === 'DECISION' && node.status === 'OPEN')
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

function evidenceFor(project: Project, node: ClarityNode): string[] {
  const ids = new Set(node.source_refs);
  const adjacentNodeIds = project.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => edge.source === node.id ? edge.target : edge.source);
  project.nodes
    .filter((candidate) => adjacentNodeIds.includes(candidate.id) && candidate.type !== 'DECISION')
    .forEach((candidate) => candidate.source_refs.forEach((id) => ids.add(id)));
  return [...ids].filter((id) => project.sources.some((source) => source.id === id));
}

function answerabilityFor(
  project: Project,
  node: ClarityNode,
  evidenceIds: string[],
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

/**
 * Deterministic V1 adapter used for bring-up and comparison. It intentionally
 * does not replace runGapAgent: the current runtime remains stable while the
 * golden set measures where this baseline differs from the new contract.
 */
export function assessGapsV1Deterministically(input: GapAssessmentV1Input): GapAssessmentV1 {
  const currentScores = new Map(rankGaps(input.project).map((gap) => [gap.node_id, gap.priority]));
  const seenQuestions = new Set<string>();
  const scored: ScoredCandidate[] = candidateNodes(input.project).map((node) => {
    const paths = findDecisionPaths(input.project, node.id);
    const evidenceIds = evidenceFor(input.project, node);
    const evidenceReview = answerabilityFor(input.project, node, evidenceIds);
    const normalized = normalizedQuestion(node.text);
    const duplicate = seenQuestions.has(normalized);
    seenQuestions.add(normalized);
    const suppressionReason = suppressionFor(node, evidenceReview.answerability, paths.length > 0, duplicate);
    const affectedDecisions = paths.map((path) => ({
      decisionId: path.at(-1)!,
      relationship: relationshipFor(node),
      pathNodeIds: path,
    }));
    const candidate: GapCandidateV1 = {
      schemaVersion: GAP_CONTRACT_VERSION,
      gapId: `gap:${node.id}`,
      sourceUnknownNodeIds: [node.id],
      question: node.text.trim().endsWith('?') ? node.text.trim() : `${node.text.trim()}?`,
      targetUnknown: node.text,
      affectedDecisions,
      evidenceReview: { evidenceIds, ...evidenceReview },
      decisionChangeLikelihood: category((1 - node.confidence) * node.impact),
      decisionImpact: category(node.impact),
      assessmentConfidence: evidenceReview.answerability === 'conflicting'
        ? 'low'
        : evidenceReview.answerability === 'unanswered'
          ? 'low'
          : evidenceReview.answerability === 'answered'
            ? 'high'
            : 'medium',
      acquisitionPath: suppressionReason ? null : acquisitionPathFor(node),
      whyItMatters: node.why_it_matters?.[0]
        ?? `Resolving this could change ${affectedDecisions.length === 1 ? 'a live decision' : 'live decisions'}.`,
      suppressionReason,
    };
    return {
      candidate,
      // This preserves the current ranker as the comparison baseline. The V1
      // contract itself keeps urgency/interruption outside Gap Agent ownership.
      score: currentScores.get(node.id) ?? structuralFallbackScore(node, paths.length),
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
