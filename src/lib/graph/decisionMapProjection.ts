import type { ClarityEdge, ClarityNode, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';

export type DecisionMapView = 'story' | 'focus' | 'all';

export interface DecisionMapCluster {
  parentNodeId: string;
  childNodeIds: string[];
}

export interface DecisionMapProjection {
  view: DecisionMapView;
  visibleNodeIds: string[];
  visibleEdgeIds: string[];
  backboneNodeIds: string[];
  clusters: DecisionMapCluster[];
  collapsedNodeIds: string[];
}

const SUPPORT_TYPES = new Set<ClarityNode['type']>([
  'KNOWN',
  'EVIDENCE',
  'CONSTRAINT',
  'PREFERENCE',
]);

const MAJOR_TYPES = new Set<ClarityNode['type']>([
  'GOAL',
  'DECISION',
  'UNKNOWN',
  'ASSUMPTION',
  'RISK',
  'NEXT_ACTION',
  'EXPERIMENT',
]);

function nodeMap(project: Project): Map<string, ClarityNode> {
  return new Map(project.nodes.map((node) => [node.id, node]));
}

function edgesBetween(project: Project, nodeIds: Set<string>): ClarityEdge[] {
  return project.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

function score(node: ClarityNode): number {
  return node.impact * node.confidence + (node.priority ?? 0) * 0.25;
}

function sortedIds(project: Project, ids: Set<string>): string[] {
  const order = new Map(project.nodes.map((node, index) => [node.id, index]));
  return [...ids].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
}

function semanticDirection(edge: ClarityEdge): { from: string; to: string } {
  // depends_on is persisted in the direction "source depends on target", but
  // the story is read from prerequisite to dependent decision.
  if (edge.type === 'depends_on') return { from: edge.target, to: edge.source };
  return { from: edge.source, to: edge.target };
}

function directedAdjacency(project: Project): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  project.edges.forEach((edge) => {
    const { from, to } = semanticDirection(edge);
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  });
  return adjacency;
}

function canReachGoal(project: Project, startNodeId: string): boolean {
  const goals = new Set(project.nodes.filter((node) => node.type === 'GOAL').map((node) => node.id));
  if (goals.has(startNodeId)) return true;
  const adjacency = directedAdjacency(project);
  const queue = [startNodeId];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of adjacency.get(current) ?? []) {
      if (goals.has(next)) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

function goalIdsReachableFrom(project: Project, startNodeId: string): string[] {
  const goals = new Set(project.nodes.filter((node) => node.type === 'GOAL').map((node) => node.id));
  const adjacency = directedAdjacency(project);
  const queue = [startNodeId];
  const visited = new Set(queue);
  const reached: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of adjacency.get(current) ?? []) {
      if (goals.has(next)) reached.push(next);
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}

function immediateSemanticNeighbors(project: Project, nodeId: string): Set<string> {
  const neighbors = new Set<string>([nodeId]);
  project.edges.forEach((edge) => {
    const { from, to } = semanticDirection(edge);
    if (from === nodeId) neighbors.add(to);
    if (to === nodeId) neighbors.add(from);
  });
  return neighbors;
}

function directMajorParents(project: Project, supportNodeId: string, majorIds: Set<string>): string[] {
  return sortedIds(project, new Set(project.edges.flatMap((edge) => {
    if (edge.type === 'derived_from') return [];
    if (edge.source === supportNodeId && majorIds.has(edge.target)) return [edge.target];
    if (edge.target === supportNodeId && majorIds.has(edge.source)) return [edge.source];
    return [];
  })));
}

function sameUnderlyingWork(action: ClarityNode, decision: ClarityNode): boolean {
  const ignored = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'the', 'to', 'whether', 'should', 'decide', 'choose', 'select', 'use']);
  const words = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => !ignored.has(word)) ?? []);
  const actionWords = words(action.text);
  const decisionWords = words(decision.text);
  const shared = [...actionWords].filter((word) => decisionWords.has(word)).length;
  const smaller = Math.max(1, Math.min(actionWords.size, decisionWords.size));
  return shared / smaller >= 0.45;
}

function buildStoryBackbone(project: Project, focusAssessment: FocusAssessment | null): Set<string> {
  const nodes = nodeMap(project);
  const backbone = new Set<string>(project.nodes.filter((node) => node.type === 'GOAL').map((node) => node.id));
  const focusId = focusAssessment?.actionNodeId;
  if (focusId && nodes.has(focusId)) backbone.add(focusId);

  project.nodes.forEach((node) => {
    if (node.status === 'OPEN' && node.type === 'DECISION' && canReachGoal(project, node.id)) backbone.add(node.id);
  });

  // Keep risks that directly explain pressure on something already in the story.
  project.edges.forEach((edge) => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target || source.type !== 'RISK' || source.status !== 'OPEN') return;
    if (backbone.has(edge.target) && ['affects', 'blocks', 'informs', 'supports'].includes(edge.type)) backbone.add(source.id);
    if (backbone.has(edge.source) && ['affects', 'blocks', 'informs', 'supports'].includes(edge.type)) backbone.add(target.id);
  });

  // Preserve real dependency chains even when a node has no direct goal edge.
  let changed = true;
  while (changed) {
    changed = false;
    project.edges.forEach((edge) => {
      if (edge.type === 'depends_on' && backbone.has(edge.source) && !backbone.has(edge.target)) {
        backbone.add(edge.target);
        changed = true;
      }
      if (edge.type === 'blocks' && backbone.has(edge.target) && !backbone.has(edge.source)) {
        backbone.add(edge.source);
        changed = true;
      }
    });
  }

  return new Set([...backbone].filter((id) => nodes.has(id)));
}

function buildStoryProjection(
  project: Project,
  focusAssessment: FocusAssessment | null,
  expandedClusterIds: Set<string>,
): DecisionMapProjection {
  const nodes = nodeMap(project);
  const backbone = buildStoryBackbone(project, focusAssessment);
  const clusters = new Map<string, Set<string>>();
  const collapsed = new Set<string>();

  project.nodes.forEach((node) => {
    if (!SUPPORT_TYPES.has(node.type) || backbone.has(node.id)) return;
    const parents = directMajorParents(project, node.id, backbone);
    if (parents.length === 1) {
      const parent = parents[0];
      clusters.set(parent, new Set([...(clusters.get(parent) ?? []), node.id]));
      collapsed.add(node.id);
    }
  });

  // A future action that is explicitly intended to satisfy the same decision
  // is represented by the decision in the story and remains expandable there.
  project.edges.forEach((edge) => {
    if (edge.type !== 'satisfies') return;
    const action = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!action || !target || action.type !== 'NEXT_ACTION' || target.type !== 'DECISION') return;
    if (!sameUnderlyingWork(action, target)) return;
    backbone.delete(action.id);
    clusters.set(target.id, new Set([...(clusters.get(target.id) ?? []), action.id]));
    collapsed.add(action.id);
  });

  const visible = new Set<string>(backbone);
  project.nodes.forEach((node) => {
    if (!SUPPORT_TYPES.has(node.type) || collapsed.has(node.id)) return;
    const parents = directMajorParents(project, node.id, backbone);
    if (parents.length > 1) visible.add(node.id);
  });

  clusters.forEach((childIds, parentId) => {
    if (!expandedClusterIds.has(parentId)) return;
    childIds.forEach((id) => visible.add(id));
  });

  const clusterList: DecisionMapCluster[] = sortedIds(project, new Set(clusters.keys())).map((parentNodeId) => ({
    parentNodeId,
    childNodeIds: sortedIds(project, clusters.get(parentNodeId) ?? new Set()),
  }));
  const visibleEdgeIds = edgesBetween(project, visible).map((edge) => edge.id);

  return {
    view: 'story',
    visibleNodeIds: sortedIds(project, visible),
    visibleEdgeIds,
    backboneNodeIds: sortedIds(project, backbone),
    clusters: clusterList,
    collapsedNodeIds: sortedIds(project, collapsed),
  };
}

function buildFocusProjection(project: Project, focusAssessment: FocusAssessment | null): DecisionMapProjection {
  const focusId = focusAssessment?.actionNodeId;
  if (!focusId || !project.nodes.some((node) => node.id === focusId)) {
    return buildStoryProjection(project, focusAssessment, new Set());
  }
  const visible = immediateSemanticNeighbors(project, focusId);
  goalIdsReachableFrom(project, focusId).forEach((goalId) => visible.add(goalId));
  const visibleSet = new Set([...visible].filter((id) => project.nodes.some((node) => node.id === id)));
  return {
    view: 'focus',
    visibleNodeIds: sortedIds(project, visibleSet),
    visibleEdgeIds: edgesBetween(project, visibleSet).map((edge) => edge.id),
    backboneNodeIds: sortedIds(project, visibleSet),
    clusters: [],
    collapsedNodeIds: [],
  };
}

export function buildDecisionMapProjection(
  project: Project,
  focusAssessment: FocusAssessment | null,
  view: DecisionMapView,
  expandedClusterIds: Set<string>,
): DecisionMapProjection {
  if (view === 'all') {
    const visible = new Set(project.nodes.map((node) => node.id));
    return {
      view,
      visibleNodeIds: sortedIds(project, visible),
      visibleEdgeIds: project.edges.map((edge) => edge.id),
      backboneNodeIds: sortedIds(project, visible),
      clusters: [],
      collapsedNodeIds: [],
    };
  }
  if (view === 'focus') return buildFocusProjection(project, focusAssessment);
  return buildStoryProjection(project, focusAssessment, expandedClusterIds);
}
