import type {
  ClarityEdge,
  ClarityNode,
  DecisionValueAssessment,
  DecisionValueLevel,
  DecisionValueTarget,
  EdgeType,
  ExpectedActionChange,
  Project,
  UserMemoryProfile,
} from '@/types/clarity';

const MAX_PATH_NODES = 7;
const PATH_EDGE_TYPES = new Set<EdgeType>(['blocks', 'depends_on', 'informs', 'affects']);
const TARGET_TYPES = new Set<ClarityNode['type']>(['GOAL', 'DECISION', 'NEXT_ACTION', 'RISK', 'CONSTRAINT']);

const EDGE_STRENGTH: Record<Extract<EdgeType, 'blocks' | 'depends_on' | 'informs' | 'affects'>, number> = {
  blocks: 1,
  depends_on: 0.86,
  affects: 0.8,
  informs: 0.68,
};

const TARGET_TYPE_WEIGHT: Record<DecisionValueTarget['node_type'], number> = {
  DECISION: 1,
  GOAL: 0.96,
  NEXT_ACTION: 0.88,
  RISK: 0.72,
  CONSTRAINT: 0.65,
};

interface PathCandidate {
  target: DecisionValueTarget;
  pathValue: number;
}

export interface DecisionValueOptions {
  now?: Date;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function levelFor(score: number): DecisionValueLevel {
  if (score >= 0.76) return 'high';
  if (score >= 0.48) return 'medium';
  if (score >= 0.22) return 'low';
  return 'none';
}

function relevantTarget(node: ClarityNode): node is ClarityNode & { type: DecisionValueTarget['node_type'] } {
  if (!TARGET_TYPES.has(node.type) || node.status === 'DEPRECATED') return false;
  if (node.type === 'DECISION' || node.type === 'NEXT_ACTION') return node.status === 'OPEN';
  return node.status !== 'RESOLVED';
}

function deadlineUrgency(deadline: string | undefined, now: Date): number {
  if (!deadline) return 0.15;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(deadline);
  const parsed = new Date(dateOnly ? `${deadline}T23:59:59.999Z` : deadline);
  if (Number.isNaN(parsed.getTime())) return 0.15;
  const days = (parsed.getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return 1;
  if (days <= 1) return 0.95;
  if (days <= 3) return 0.88;
  if (days <= 7) return 0.78;
  if (days <= 14) return 0.64;
  if (days <= 30) return 0.48;
  if (days <= 90) return 0.28;
  return 0.15;
}

function collectEvidence(project: Project, node: ClarityNode): {
  strength: DecisionValueAssessment['evidence_strength'];
  count: number;
} {
  const evidenceIds = new Set(node.source_refs);
  let conflicting = false;
  for (const edge of project.edges) {
    if (edge.source !== node.id && edge.target !== node.id) continue;
    if (edge.type === 'contradicts') conflicting = true;
    const adjacentId = edge.source === node.id ? edge.target : edge.source;
    const adjacent = project.nodes.find((candidate) => candidate.id === adjacentId);
    if (!adjacent || !['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'PREFERENCE'].includes(adjacent.type)) continue;
    adjacent.source_refs.forEach((id) => evidenceIds.add(id));
    if (adjacent.type === 'EVIDENCE' || adjacent.type === 'KNOWN') evidenceIds.add(adjacent.id);
  }
  if (conflicting) return { strength: 'conflicting', count: evidenceIds.size };
  if (evidenceIds.size >= 3) return { strength: 'strong', count: evidenceIds.size };
  if (evidenceIds.size > 0) return { strength: 'partial', count: evidenceIds.size };
  return { strength: 'none', count: 0 };
}

function acquisitionCost(node: ClarityNode, evidenceCount: number): number {
  const text = `${node.text} ${(node.why_it_matters ?? []).join(' ')}`.toLowerCase();
  let cost = 0.45;
  if (/acceptable|preference|willing|priority|would i|do i want|comfort/.test(text)) cost = 0.12;
  else if (/already|document|uploaded|record|notes?|contract|specification/.test(text)) cost = 0.24;
  else if (/recruiter|manager|client|vendor|owner|stakeholder|ask (?:them|someone)/.test(text)) cost = 0.42;
  else if (/measure|benchmark|test|experiment|prototype|trial|study/.test(text)) cost = 0.68;
  else if (/wait|approval|regulator|legal review|when will|external dependency/.test(text)) cost = 0.78;
  if (evidenceCount > 0) cost -= Math.min(0.15, evidenceCount * 0.04);
  return clamp(cost);
}

function evidenceUsefulness(strength: DecisionValueAssessment['evidence_strength']): number {
  if (strength === 'strong') return 0.9;
  if (strength === 'partial') return 0.68;
  if (strength === 'conflicting') return 0.5;
  return 0.25;
}

function reversibilityFor(project: Project, targets: DecisionValueTarget[]): DecisionValueAssessment['downstream_reversibility'] {
  if (targets.length === 0) return 'unknown';
  const targetNodes = targets
    .map((target) => project.nodes.find((node) => node.id === target.node_id))
    .filter((node): node is ClarityNode => Boolean(node));
  const sourceIds = new Set(targetNodes.flatMap((node) => node.source_refs));
  const text = [
    ...targetNodes.flatMap((node) => [node.text, ...(node.why_it_matters ?? [])]),
    ...project.sources.filter((source) => sourceIds.has(source.id)).map((source) => source.content),
  ].join(' ').toLowerCase();
  if (/irreversible|hard to reverse|cannot be undone|non[- ]refundable|binding contract|sign(?:ing)? the contract|production migration|terminate|public launch/.test(text)) {
    return 'hard_to_reverse';
  }
  if (/partly reversible|partially reversible|costly to reverse|commits? (?:several|significant)|switching cost/.test(text)) {
    return 'partly_reversible';
  }
  if (/reversible|pilot|trial|draft|prototype|temporary|can roll back/.test(text)) return 'reversible';
  return 'unknown';
}

function reversibilityWeight(value: DecisionValueAssessment['downstream_reversibility']): number {
  if (value === 'hard_to_reverse') return 1;
  if (value === 'partly_reversible') return 0.72;
  if (value === 'reversible') return 0.3;
  return 0.5;
}

function findAffectedTargets(project: Project, sourceNodeId: string): PathCandidate[] {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, ClarityEdge[]>();
  for (const edge of project.edges) {
    if (!PATH_EDGE_TYPES.has(edge.type)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }

  const bestByTarget = new Map<string, PathCandidate>();
  const bestTraversalState = new Map<string, number>();
  const queue: Array<{ nodeIds: string[]; edges: ClarityEdge[]; strength: number }> = [{
    nodeIds: [sourceNodeId],
    edges: [],
    strength: 1,
  }];
  let expandedStates = 0;
  while (queue.length > 0 && expandedStates < 600) {
    const current = queue.shift()!;
    expandedStates += 1;
    const currentId = current.nodeIds.at(-1)!;
    if (current.nodeIds.length >= MAX_PATH_NODES) continue;
    for (const edge of outgoing.get(currentId) ?? []) {
      if (current.nodeIds.includes(edge.target)) continue;
      const targetNode = nodes.get(edge.target);
      if (!targetNode || targetNode.status === 'DEPRECATED') continue;
      const nodeIds = [...current.nodeIds, edge.target];
      const edges = [...current.edges, edge];
      const edgeStrength = EDGE_STRENGTH[edge.type as keyof typeof EDGE_STRENGTH] * (edge.confidence ?? 1);
      const strength = current.strength * edgeStrength;
      if (relevantTarget(targetNode)) {
        const importance = clamp(targetNode.impact * TARGET_TYPE_WEIGHT[targetNode.type]);
        const depthDiscount = Math.pow(0.84, Math.max(0, edges.length - 1));
        const pathValue = clamp(strength * depthDiscount * importance);
        const candidate: PathCandidate = {
          pathValue,
          target: {
            node_id: targetNode.id,
            node_type: targetNode.type,
            label: targetNode.text,
            importance,
            relationship: edges[0].type,
            path_node_ids: nodeIds,
            path_edge_ids: edges.map((item) => item.id),
          },
        };
        if ((bestByTarget.get(targetNode.id)?.pathValue ?? -1) < pathValue) bestByTarget.set(targetNode.id, candidate);
      }
      const traversalKey = `${edges[0].type}:${edge.target}`;
      const traversalValue = strength * Math.pow(0.84, Math.max(0, edges.length - 1));
      if ((bestTraversalState.get(traversalKey) ?? -1) >= traversalValue) continue;
      bestTraversalState.set(traversalKey, traversalValue);
      queue.push({ nodeIds, edges, strength });
    }
  }
  return [...bestByTarget.values()].sort((left, right) =>
    right.pathValue - left.pathValue || left.target.node_id.localeCompare(right.target.node_id),
  );
}

function expectedActionChange(node: ClarityNode, strongest: DecisionValueTarget | null): ExpectedActionChange {
  if (!strongest) return 'same_action';
  const text = node.text.toLowerCase();
  if (/when|timeline|deadline|sequence|first|before|after|availability/.test(text)) return 'could_change_sequence';
  if (/how much|how many|percentage|percent|scope|workload|capacity|quantity|which|who|persona|scenario/.test(text)) return 'could_change_scope';
  if (
    strongest.node_type === 'DECISION' &&
    (strongest.relationship === 'blocks' || strongest.relationship === 'depends_on') &&
    /whether|acceptable|should|can we|go[- /]?no[- ]?go|approval/.test(text)
  ) return 'could_flip_decision';
  if (/risk|safe|security|legal|compliance|cost|price|compensation|salary|equity|budget/.test(text)) return 'could_change_risk';
  if (/confirm|verify|validate|evidence|is there|does .* exist/.test(text)) return 'could_confirm';
  if (
    strongest.node_type === 'DECISION' &&
    (strongest.relationship === 'blocks' || strongest.relationship === 'depends_on' || /whether|acceptable|should|can we|go[- /]?no[- ]?go|approval/.test(text))
  ) return 'could_flip_decision';
  if (strongest.relationship === 'blocks' && strongest.node_type === 'NEXT_ACTION') return 'could_change_sequence';
  return strongest.node_type === 'DECISION' ? 'could_change_scope' : 'could_confirm';
}

function actionChangeWeight(value: ExpectedActionChange): number {
  if (value === 'could_flip_decision') return 1;
  if (value === 'could_change_risk') return 0.82;
  if (value === 'could_change_sequence') return 0.78;
  if (value === 'could_change_scope') return 0.72;
  if (value === 'could_confirm') return 0.58;
  return 0.08;
}

function actionPhrase(value: ExpectedActionChange): string {
  if (value === 'could_flip_decision') return 'could change the decision';
  if (value === 'could_change_risk') return 'could change the risk or commitment';
  if (value === 'could_change_sequence') return 'could change what happens next';
  if (value === 'could_change_scope') return 'could change the chosen scope';
  if (value === 'could_confirm') return 'could confirm the current direction';
  return 'is not connected to a different next action';
}

/**
 * Calculates the structural decision value of resolving an UNKNOWN or weak
 * ASSUMPTION. Unique downstream targets and the strongest paths dominate;
 * duplicate edges do not increase the score.
 */
export function calculateDecisionValue(
  node: ClarityNode,
  project: Project,
  profile: UserMemoryProfile,
  options: DecisionValueOptions = {},
): DecisionValueAssessment {
  const paths = findAffectedTargets(project, node.id);
  const affectedTargets = paths.map((path) => path.target);
  const strongest = affectedTargets[0] ?? null;
  const topPathValues = paths.slice(0, 3).map((path) => path.pathValue);
  const structuralLeverage = clamp(
    (topPathValues[0] ?? 0) * 0.74 +
      (topPathValues[1] ?? 0) * 0.18 +
      (topPathValues[2] ?? 0) * 0.08,
  );
  const expectedChange = expectedActionChange(node, strongest);
  const directBlock = strongest?.relationship === 'blocks' && strongest.path_node_ids.length === 2;
  const blockingPathBoost = strongest?.relationship === 'blocks' ? (directBlock ? 0.08 : 0.05) : 0;
  const expectedChangeStrength = clamp(
    structuralLeverage * actionChangeWeight(expectedChange) + blockingPathBoost,
  );
  const evidence = collectEvidence(project, node);
  const acquisition = acquisitionCost(node, evidence.count);
  let answerability = clamp((1 - acquisition) * 0.68 + evidenceUsefulness(evidence.strength) * 0.32);
  if (profile.evidence_preference === 'strict_data' && evidence.strength === 'none') answerability = clamp(answerability - 0.12);
  const urgency = deadlineUrgency(project.deadline, options.now ?? new Date());
  const reversibility = reversibilityFor(project, affectedTargets);
  const uncertainty = clamp(1 - node.confidence);
  const strongestImportance = strongest?.importance ?? 0;
  let score = clamp(
    0.54 * expectedChangeStrength +
      0.12 * strongestImportance +
      0.07 * reversibilityWeight(reversibility) +
      0.05 * urgency +
      0.07 * answerability +
      0.06 * uncertainty +
      0.09 * clamp(node.impact) +
      (evidence.strength === 'conflicting' ? 0.06 : 0),
  );
  if (!strongest || expectedChange === 'same_action') score = Math.min(score, 0.21);

  const difficulty = acquisition >= 0.65 ? 'high' : acquisition >= 0.35 ? 'medium' : 'low';
  const targetLabel = strongest?.label.replace(/\s+/g, ' ').trim().slice(0, 96);
  const relationship = strongest
    ? strongest.path_node_ids.length === 2
      ? `a direct ${strongest.relationship.replaceAll('_', ' ')}`
      : `a ${strongest.path_node_ids.length - 1}-step ${strongest.relationship.replaceAll('_', ' ')} path`
    : null;
  const reason = strongest && targetLabel
    ? `Resolving this ${actionPhrase(expectedChange)} for “${targetLabel}” through ${relationship}; the answer appears ${difficulty} effort to obtain.`
    : 'No live decision, action, or goal path is represented yet, so resolving this is unlikely to change the next step.';

  return {
    score,
    level: levelFor(score),
    expected_action_change: expectedChange,
    structural_leverage: structuralLeverage,
    affected_targets: affectedTargets,
    strongest_path: strongest,
    urgency_contribution: urgency,
    answerability_contribution: answerability,
    acquisition_cost: acquisition,
    acquisition_difficulty: difficulty,
    evidence_strength: evidence.strength,
    downstream_reversibility: reversibility,
    meaningful_effect_count: affectedTargets.length,
    reason,
  };
}
