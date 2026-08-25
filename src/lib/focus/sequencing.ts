import type { ClarityNode, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';

const ACTIONABLE_PREREQUISITE_TYPES = new Set<ClarityNode['type']>([
  'DECISION',
  'UNKNOWN',
  'ASSUMPTION',
  'NEXT_ACTION',
]);

/**
 * Canonical edge contract:
 * - A depends_on B: A is dependent, B is prerequisite.
 * - B blocks A: B is prerequisite, A is dependent.
 */
export function getUnresolvedPrerequisites(project: Project, nodeId: string): ClarityNode[] {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const prerequisites = new Map<string, ClarityNode>();

  function visit(dependentId: string) {
    if (visited.has(dependentId)) return;
    visited.add(dependentId);

    for (const edge of project.edges) {
      let prerequisiteId: string | null = null;
      if (edge.type === 'blocks' && edge.target === dependentId) prerequisiteId = edge.source;
      if (edge.type === 'depends_on' && edge.source === dependentId) prerequisiteId = edge.target;
      if (!prerequisiteId) continue;

      const prerequisite = nodesById.get(prerequisiteId);
      if (!prerequisite || prerequisite.status !== 'OPEN') continue;
      prerequisites.set(prerequisite.id, prerequisite);
      visit(prerequisite.id);
    }
  }

  visit(nodeId);
  return [...prerequisites.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function isNodeBlocked(project: Project, nodeId: string): boolean {
  return getUnresolvedPrerequisites(project, nodeId).length > 0;
}

function actionablePrerequisite(node: ClarityNode): boolean {
  return node.status === 'OPEN' && ACTIONABLE_PREREQUISITE_TYPES.has(node.type);
}

function focusKindForNode(node: ClarityNode): FocusAssessment['kind'] {
  if (node.type === 'DECISION') return 'decision';
  if (node.type === 'NEXT_ACTION') return 'action';
  return 'question';
}

/**
 * Removes assessments whose explicit action target is blocked. When an
 * actionable leaf prerequisite has no candidate of its own, promotes an
 * ephemeral assessment for it without creating a graph node.
 */
export function sequenceFocusAssessments(
  project: Project,
  assessments: FocusAssessment[],
): FocusAssessment[] {
  const representedActionNodeIds = new Set(
    assessments.flatMap((assessment) => {
      const targetNodeId = assessment.targetNodeId ?? assessment.actionNodeId;
      return targetNodeId ? [targetNodeId] : [];
    }),
  );
  const eligible = assessments.filter((assessment) =>
    !((assessment.targetNodeId ?? assessment.actionNodeId)
      && isNodeBlocked(project, assessment.targetNodeId ?? assessment.actionNodeId!))
  );
  const promotedByNodeId = new Map<string, FocusAssessment>();

  assessments
    .filter((assessment) => {
      const targetNodeId = assessment.targetNodeId ?? assessment.actionNodeId;
      return Boolean(targetNodeId && isNodeBlocked(project, targetNodeId));
    })
    .forEach((blockedAssessment) => {
      const targetNodeId = blockedAssessment.targetNodeId ?? blockedAssessment.actionNodeId!;
      getUnresolvedPrerequisites(project, targetNodeId)
        .filter(actionablePrerequisite)
        .filter((node) => !isNodeBlocked(project, node.id))
        .filter((node) => !representedActionNodeIds.has(node.id))
        .forEach((node) => {
          const promoted: FocusAssessment = {
            kind: focusKindForNode(node),
            title: node.text,
            nextAction: node.text,
            whyNow: `This unresolved prerequisite must be addressed before “${blockedAssessment.title}”.`,
            sourceNodeIds: Array.from(new Set([node.id, ...blockedAssessment.sourceNodeIds])),
            sourceIds: Array.from(new Set([...node.source_refs, ...blockedAssessment.sourceIds])),
            targetNodeId: node.id,
            representedNodeIds: [node.id],
            actionNodeId: node.id,
            score: blockedAssessment.score,
            confidence: node.confidence,
          };
          const existing = promotedByNodeId.get(node.id);
          if (!existing || promoted.score > existing.score) promotedByNodeId.set(node.id, promoted);
        });
    });

  return [...eligible, ...promotedByNodeId.values()];
}
