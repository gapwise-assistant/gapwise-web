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
 * Reject only relationships that add no distinct meaning to an existing pair.
 * A specific prerequisite/blocking edge makes a generic affects edge redundant;
 * other relationship types may coexist when the source supports both claims.
 */
export function relationshipAddsDistinctMeaning(
  existingEdges: ClarityEdge[],
  candidate: Pick<ClarityEdge, 'source' | 'target' | 'type'>,
): boolean {
  const pair = existingEdges.filter((edge) =>
    edge.source === candidate.source && edge.target === candidate.target,
  );
  if (pair.some((edge) => edge.type === candidate.type)) return false;

  if (
    candidate.type === 'affects'
    && pair.some((edge) => edge.type === 'depends_on' || edge.type === 'blocks')
  ) {
    return false;
  }

  return true;
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
