import type { ClarityNode, Project } from '@/types/clarity';
import { relationshipRoleCompatible } from '@/lib/graph/relationshipSemantics';

function resolvedOutcome(node: ClarityNode | undefined): boolean {
  return Boolean(node && node.status === 'RESOLVED');
}

/**
 * Determines completion only from explicit graph structure; no text matching.
 * A satisfies edge records that completing this action is intended to settle
 * the target. The target becoming resolved is the only graph signal that the
 * action has become obsolete/completed. Informational and blocking edges do
 * not prove that the action itself was completed.
 */
export function isNextActionSatisfied(project: Project, node: ClarityNode): boolean {
  if (node.type !== 'NEXT_ACTION') return false;
  const nodesById = new Map(project.nodes.map((candidate) => [candidate.id, candidate]));

  return project.edges.some((edge) => {
    if (edge.source !== node.id || edge.type !== 'satisfies') return false;
    const target = nodesById.get(edge.target);
    return Boolean(
      target
      && relationshipRoleCompatible(node, target, 'satisfies')
      && resolvedOutcome(target),
    );
  });
}

export function resolveSatisfiedNextActions(project: Project, timestamp = new Date().toISOString()): string[] {
  const resolvedIds: string[] = [];
  project.nodes
    .filter((node) => node.type === 'NEXT_ACTION' && node.status === 'OPEN')
    .forEach((node) => {
      if (!isNextActionSatisfied(project, node)) return;
      node.status = 'RESOLVED';
      node.confidence = 1;
      node.updated_at = timestamp;
      resolvedIds.push(node.id);
    });
  return resolvedIds;
}
