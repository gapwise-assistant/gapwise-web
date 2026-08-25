import type { ClarityEdge, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';

/** The Decision Map is the complete canonical project graph. */
export type DecisionMapView = 'all';

export interface DecisionMapProjection {
  view: DecisionMapView;
  visibleNodeIds: string[];
  visibleEdgeIds: string[];
}

function sortedIds(project: Project, ids: Iterable<string>): string[] {
  const order = new Map(project.nodes.map((node, index) => [node.id, index]));
  return [...new Set(ids)].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
}

/**
 * Returns every persisted node and edge. Focus remains an input to the shared
 * renderer/debug path, but it never changes graph visibility.
 */
export function buildDecisionMapProjection(
  project: Project,
  _focusAssessment: FocusAssessment | null,
): DecisionMapProjection {
  const visibleNodeIds = sortedIds(project, project.nodes.map((node) => node.id));
  const visibleNodeSet = new Set(visibleNodeIds);
  const visibleEdgeIds = project.edges
    .filter((edge: ClarityEdge) => visibleNodeSet.has(edge.source) && visibleNodeSet.has(edge.target))
    .map((edge) => edge.id);

  return {
    view: 'all',
    visibleNodeIds,
    visibleEdgeIds,
  };
}
