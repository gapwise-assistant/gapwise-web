import type { ClarityEdge, ClarityNode, EdgeType, Project } from '@/types/clarity';
import { questionIdentityKey } from '@/lib/questions/canonical';

const RELATIONSHIP_TYPES: EdgeType[] = [
  'supports',
  'contradicts',
  'depends_on',
  'blocks',
  'informs',
  'resolves',
  'satisfies',
  'derived_from',
  'supersedes',
  'affects',
];

export function isQuestionNode(node: ClarityNode): boolean {
  return node.type === 'UNKNOWN' || node.type === 'ASSUMPTION';
}

export function isEvidenceNode(node: ClarityNode): boolean {
  return ['KNOWN', 'EVIDENCE', 'EXPERIMENT'].includes(node.type);
}

/**
 * Stored evidence is complete as a record, but that lifecycle state does not
 * mean it answers another node. Resolution requires a result-bearing
 * statement and rejects language that explicitly leaves the result pending or
 * unverified.
 */
export function hasConclusiveResultEvidence(node: ClarityNode): boolean {
  if (
    node.created_by === 'user'
    && node.status === 'RESOLVED'
    && ['KNOWN', 'EVIDENCE', 'EXPERIMENT', 'CONSTRAINT', 'PREFERENCE', 'DECISION'].includes(node.type)
  ) {
    return true;
  }
  if (!isEvidenceNode(node)) {
    return node.type === 'DECISION' && node.status === 'RESOLVED';
  }

  const text = node.text.trim();
  if (!text || /\b(?:(?:has|have|did|does)\s+not\s+(?:yet\s+)?(?:test(?:ed)?|verif(?:y|ied)|confirm(?:ed)?|record(?:ed)?|receiv(?:e|ed)|complet(?:e|ed)|resolv(?:e|ed))|not tested|still pending|under review|no response|result unknown|unresolved|unconfirmed|not verified|not recorded)\b/i.test(text)) {
    return false;
  }
  return /\b(?:returned|created|produced|passed|failed|rejected|approved|confirmed|verified|recorded|completed|received|shows?|demonstrated|succeeded|successfully|matched|resolved)\b/i.test(text);
}

/**
 * Central graph contract. Edge direction is part of the meaning of an edge,
 * not presentation metadata:
 * - depends_on: source is dependent; target is prerequisite
 * - blocks: source is blocker; target is blocked
 * - informs/affects: source changes the target's understanding or direction
 * - resolves: completed outcome; target is already answered
 * - satisfies: future NEXT_ACTION; target is the intended outcome
 */
export function relationshipRoleCompatible(
  source: ClarityNode,
  target: ClarityNode,
  relationship: EdgeType,
): boolean {
  const question = isQuestionNode;
  const structuralTarget = (node: ClarityNode) => question(node)
    || ['GOAL', 'DECISION', 'NEXT_ACTION', 'RISK', 'CONSTRAINT'].includes(node.type);
  const blockableTarget = (node: ClarityNode) => question(node)
    || ['GOAL', 'DECISION', 'NEXT_ACTION'].includes(node.type);
  const dependencySource = (node: ClarityNode) => question(node)
    || ['GOAL', 'DECISION', 'NEXT_ACTION', 'RISK'].includes(node.type);
  const dependencyTarget = (node: ClarityNode) => question(node)
    || ['DECISION', 'NEXT_ACTION', 'RISK'].includes(node.type);

  switch (relationship) {
    case 'supports':
      return isEvidenceNode(source) || source.type === 'PREFERENCE';
    case 'contradicts':
      return isEvidenceNode(source) && (isEvidenceNode(target) || question(target) || target.type === 'DECISION');
    case 'resolves':
      return hasConclusiveResultEvidence(source)
        && (question(target) || target.type === 'DECISION');
    case 'satisfies':
      return source.type === 'NEXT_ACTION'
        && (question(target) || target.type === 'DECISION');
    case 'supersedes':
      return isEvidenceNode(source) && (isEvidenceNode(target) || question(target) || target.type === 'DECISION');
    case 'blocks':
      return (question(source) || ['RISK', 'CONSTRAINT', 'NEXT_ACTION', 'DECISION'].includes(source.type))
        && blockableTarget(target);
    case 'depends_on':
      // A goal is an outcome, not a prerequisite. This keeps
      // DECISION -> depends_on -> GOAL out of the graph.
      return dependencySource(source) && dependencyTarget(target);
    case 'informs':
      return (isEvidenceNode(source) || question(source) || ['RISK', 'CONSTRAINT', 'NEXT_ACTION', 'DECISION', 'PREFERENCE'].includes(source.type))
        && structuralTarget(target);
    case 'affects':
      return (isEvidenceNode(source) || question(source) || ['RISK', 'CONSTRAINT', 'NEXT_ACTION', 'DECISION', 'PREFERENCE'].includes(source.type))
        && structuralTarget(target);
    case 'derived_from':
      return source.id !== target.id;
    default:
      return false;
  }
}

export function allowedRelationshipTypes(
  source: ClarityNode,
  target: ClarityNode,
): EdgeType[] {
  return RELATIONSHIP_TYPES.filter((relationship) =>
    relationshipRoleCompatible(source, target, relationship),
  );
}

/**
 * Relationship choices offered to the post-reconciliation completion pass.
 * Provenance and broad evidentiary edges are created by their dedicated
 * workflows; completion should only classify a concrete dependency,
 * influence, information, or intended-outcome relationship.
 */
export function completionAllowedRelationshipTypes(
  source: ClarityNode,
  target: ClarityNode,
): EdgeType[] {
  // Completion is deliberately narrower than the general graph validator.
  // `derived_from` is provenance and `supports` is supplied by explicit
  // answer/decision workflows; neither should be guessed by this pass.
  const structurallyAllowed = allowedRelationshipTypes(source, target)
    .filter((relationship) => relationship !== 'derived_from' && relationship !== 'supports');
  const questionOrDecisionTarget = isQuestionNode(target) || target.type === 'DECISION';

  // Facts and results provide information for a gap or decision. A resolves
  // edge is offered only when the text is a completed result, never merely
  // because the evidence node is stored with RESOLVED lifecycle status.
  if (isEvidenceNode(source) && questionOrDecisionTarget) {
    return structurallyAllowed.filter((relationship) =>
      relationship === 'informs'
      || (relationship === 'resolves' && hasConclusiveResultEvidence(source)),
    );
  }

  // A resolved decision outcome can answer a separate factual question, but
  // an open decision is not evidence for another node.
  if (source.type === 'DECISION' && source.status === 'RESOLVED' && isQuestionNode(target)) {
    return structurallyAllowed.filter((relationship) => relationship === 'resolves');
  }

  // Constraints, assumptions, and preferences can shape a question/decision,
  // but completion should not turn ordinary evaluation into a hard blocker.
  if (source.type === 'CONSTRAINT' && questionOrDecisionTarget) {
    return structurallyAllowed.filter((relationship) =>
      relationship === 'informs' || relationship === 'affects',
    );
  }
  if (source.type === 'ASSUMPTION' && questionOrDecisionTarget) {
    return structurallyAllowed.filter((relationship) => relationship === 'informs' || relationship === 'affects');
  }
  if (source.type === 'PREFERENCE' && target.type === 'DECISION') {
    return structurallyAllowed.filter((relationship) => relationship === 'affects');
  }

  // An unresolved factual prerequisite can block a downstream choice. A
  // NEXT_ACTION instead describes intended work that will satisfy its target.
  if (source.type === 'UNKNOWN' && target.type === 'DECISION') {
    return structurallyAllowed.filter((relationship) => relationship === 'blocks' || relationship === 'affects');
  }
  if (source.type === 'NEXT_ACTION' && questionOrDecisionTarget) {
    return structurallyAllowed.filter((relationship) =>
      relationship === 'satisfies' || relationship === 'informs' || relationship === 'affects',
    );
  }

  // These are the main downstream project paths. Keeping them explicit
  // prevents unrelated facts from consuming the bounded pair budget.
  if (source.type === 'DECISION' && target.type === 'GOAL') {
    return structurallyAllowed.filter((relationship) => relationship === 'affects');
  }
  if (source.type === 'RISK' && (target.type === 'GOAL' || target.type === 'DECISION')) {
    return structurallyAllowed.filter((relationship) => relationship === 'affects' || relationship === 'blocks');
  }
  if (source.type === 'CONSTRAINT' && target.type === 'GOAL') {
    return structurallyAllowed.filter((relationship) => relationship === 'affects');
  }

  return [];
}

/**
 * Relationship strength is only used for the narrow generic-vs-specific cases
 * where two edges express the same project meaning. It is not a global ranking
 * of all relationship types.
 */
const RELATIONSHIP_STRENGTH: Partial<Record<EdgeType, number>> = {
  informs: 1,
  affects: 1,
  supports: 2,
  blocks: 2,
  depends_on: 2,
};

function isInverseDependencyPair(
  left: Pick<ClarityEdge, 'source' | 'target' | 'type'>,
  right: Pick<ClarityEdge, 'source' | 'target' | 'type'>,
): boolean {
  return (
    left.type === 'blocks'
    && right.type === 'depends_on'
    && left.source === right.target
    && left.target === right.source
  ) || (
    left.type === 'depends_on'
    && right.type === 'blocks'
    && left.source === right.target
    && left.target === right.source
  );
}

function isStrongerRelationship(
  candidateType: EdgeType,
  existingType: EdgeType,
): boolean {
  const candidateStrength = RELATIONSHIP_STRENGTH[candidateType] ?? 0;
  const existingStrength = RELATIONSHIP_STRENGTH[existingType] ?? 0;
  return candidateStrength > existingStrength
    && (
      (candidateType === 'blocks' || candidateType === 'depends_on')
        && existingType === 'affects'
      || candidateType === 'supports' && existingType === 'informs'
    );
}

type RelationshipCandidate = Pick<ClarityEdge, 'source' | 'target' | 'type'> & {
  confidence?: number;
};

export type SemanticEdgeInput = Omit<ClarityEdge, 'id'> & {
  id?: string;
};

export type SemanticEdgeRejectionReason =
  | 'missing_source'
  | 'missing_target'
  | 'self_reference'
  | 'role_incompatible'
  | 'duplicate'
  | 'redundant_relationship';

/** Shared persistence invariant used by every canonical edge-writing path. */
export function semanticEdgeRejectionReason(
  project: Project,
  candidate: RelationshipCandidate,
): SemanticEdgeRejectionReason | undefined {
  const source = project.nodes.find((node) => node.id === candidate.source);
  const target = project.nodes.find((node) => node.id === candidate.target);
  if (!source) return 'missing_source';
  if (!target) return 'missing_target';
  if (source.id === target.id) return 'self_reference';
  if (!relationshipRoleCompatible(source, target, candidate.type)) return 'role_incompatible';
  if (!relationshipAddsDistinctMeaning(project.edges, candidate)) {
    return project.edges.some((edge) =>
      edge.source === candidate.source
      && edge.target === candidate.target
      && edge.type === candidate.type
    ) ? 'duplicate' : 'redundant_relationship';
  }
  return undefined;
}

export function relationshipAddsDistinctMeaning(
  existingEdges: ClarityEdge[],
  candidate: RelationshipCandidate,
): boolean {
  const pair = existingEdges.filter((edge) =>
    edge.source === candidate.source && edge.target === candidate.target,
  );
  if (pair.some((edge) => edge.type === candidate.type)) return false;

  if (existingEdges.some((edge) => isInverseDependencyPair(edge, candidate))) {
    return false;
  }

  if (pair.some((edge) => isStrongerRelationship(edge.type, candidate.type))) {
    return false;
  }

  if (candidate.type === 'informs' || candidate.type === 'affects' || candidate.type === 'supports') {
    const reciprocal = existingEdges.find((edge) =>
      edge.type === candidate.type
      && edge.source === candidate.target
      && edge.target === candidate.source,
    );
    if (reciprocal && (
      candidate.type === 'supports'
      || (reciprocal.confidence ?? 0) >= (candidate.confidence ?? 0)
    )) {
      return false;
    }
  }

  return true;
}

/**
 * Remove only edges that are superseded by an accepted stronger candidate.
 * Inverse dependency edges are intentionally not removed here because they
 * are rejected by relationshipAddsDistinctMeaning() and the existing edge is
 * the one retained.
 */
export function removeSupersededRelationships(
  existingEdges: ClarityEdge[],
  candidate: RelationshipCandidate,
): void {
  const candidateConfidence = candidate.confidence ?? 0;
  for (let index = existingEdges.length - 1; index >= 0; index -= 1) {
    const edge = existingEdges[index];
    const sameDirectedPair = edge.source === candidate.source
      && edge.target === candidate.target;
    const supersededSamePair = sameDirectedPair
      && isStrongerRelationship(candidate.type, edge.type);
    const supersededReciprocalGeneric = (
      candidate.type === 'informs' || candidate.type === 'affects'
    ) && edge.type === candidate.type
      && edge.source === candidate.target
      && edge.target === candidate.source
      && candidateConfidence > (edge.confidence ?? 0);

    if (supersededSamePair || supersededReciprocalGeneric) {
      existingEdges.splice(index, 1);
    }
  }
}

/**
 * Persist one semantic edge using the same duplicate, redundancy, and
 * supersession rules for every graph-writing path.
 */
export function writeSemanticEdge(
  project: Project,
  edge: SemanticEdgeInput,
): ClarityEdge | undefined {
  const candidate: RelationshipCandidate = {
    source: edge.source,
    target: edge.target,
    type: edge.type,
    confidence: edge.confidence,
  };

  if (semanticEdgeRejectionReason(project, candidate)) return undefined;

  removeSupersededRelationships(project.edges, candidate);

  const persisted: ClarityEdge = {
    ...edge,
    id: edge.id ?? `edge_semantic_${Date.now()}_${project.edges.length}_${Math.random().toString(36).slice(2, 8)}`,
  };
  project.edges.push(persisted);
  // A valid resolves edge is also a lifecycle transition. Keeping this in the
  // shared writer means Context ingestion, completion, and explicit workflows
  // all preserve the same target-state invariant.
  ensureResolutionConsistency(project);
  return persisted;
}

function relationshipTokens(text: string): Set<string> {
  return new Set(questionIdentityKey(text)
    .split(' ')
    .filter((token) => token.length >= 4)
    .filter((token) => !['current', 'result', 'status', 'question', 'decision', 'action', 'information'].includes(token)));
}

/**
 * Evidence-to-decision links need substantive support unless the model
 * explicitly linked the nodes. Structural links can express dependency
 * without lexical overlap.
 */
export function relationshipHasSemanticSupport(
  source: ClarityNode,
  target: ClarityNode,
  relationship: EdgeType,
  explicitlyLinked: boolean,
): boolean {
  if (explicitlyLinked || !((relationship === 'informs' || relationship === 'affects') && isEvidenceNode(source) && target.type === 'DECISION')) {
    return true;
  }
  const sourceTokens = relationshipTokens(source.text);
  const targetTokens = relationshipTokens(target.text);
  const shared = [...sourceTokens].filter((token) => targetTokens.has(token)).length;
  return shared >= 2;
}

/**
 * Keep a valid completed outcome edge and its target status in sync. This is
 * intentionally narrow: it does not make favorable evidence, preferences,
 * recommendations, or intended work resolve anything.
 */
export function ensureResolutionConsistency(project: Project): void {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  project.edges
    .filter((edge) => edge.type === 'resolves')
    .forEach((edge) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      if (!source || !target || !relationshipRoleCompatible(source, target, 'resolves')) return;
      if (isQuestionNode(target) || target.type === 'DECISION') target.status = 'RESOLVED';
    });
}
