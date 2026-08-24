import type { ClarityEdge, ClarityNode, Project } from '@/types/clarity';
import type { DecisionMapProjection } from '@/lib/graph/decisionMapProjection';

export interface DecisionStoryEdge {
  id: string;
  source: string;
  target: string;
  type: ClarityEdge['type'];
}

export interface DecisionStoryJunction {
  target: string;
  sources: string[];
}

const STORY_NODE_TYPES = new Set<ClarityNode['type']>([
  'GOAL',
  'DECISION',
  'UNKNOWN',
  'ASSUMPTION',
  'NEXT_ACTION',
  'EXPERIMENT',
]);

const FLOW_EDGE_TYPES = new Set<ClarityEdge['type']>([
  'blocks',
  'depends_on',
  'resolves',
  'satisfies',
  'affects',
  'informs',
  'supports',
  'supersedes',
  'contradicts',
]);

const STORY_EDGE_PRIORITY: Record<ClarityEdge['type'], number> = {
  blocks: 0,
  depends_on: 1,
  satisfies: 2,
  resolves: 3,
  affects: 4,
  informs: 5,
  supersedes: 6,
  contradicts: 7,
  supports: 8,
  derived_from: 9,
};

export function isDecisionStoryNode(node: ClarityNode): boolean {
  return STORY_NODE_TYPES.has(node.type);
}

export function storySemanticDirection(edge: ClarityEdge): { source: string; target: string } {
  return edge.type === 'depends_on'
    ? { source: edge.target, target: edge.source }
    : { source: edge.source, target: edge.target };
}

function reachable(
  start: string,
  goal: string,
  edges: DecisionStoryEdge[],
): boolean {
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]));
  const queue = [start];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const next of adjacency.get(current) ?? []) {
      if (next === goal) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Builds only presentation edges. It never changes or writes canonical graph
 * edges. A depends_on edge is intentionally reversed for human reading.
 */
export function buildDecisionStoryEdges(
  project: Pick<Project, 'nodes' | 'edges'>,
  projection: Pick<DecisionMapProjection, 'visibleNodeIds'>,
): DecisionStoryEdge[] {
  const visible = new Set(projection.visibleNodeIds);
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const candidates = project.edges
    .filter((edge) => FLOW_EDGE_TYPES.has(edge.type))
    .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
    .filter((edge) => {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      return Boolean(source && target && isDecisionStoryNode(source) && isDecisionStoryNode(target));
    })
    .map((edge) => {
      const direction = storySemanticDirection(edge);
      return { id: edge.id, source: direction.source, target: direction.target, type: edge.type };
    });

  // Keep a single presentation edge for parallel canonical relationships.
  const unique = new Map<string, DecisionStoryEdge>();
  candidates.forEach((edge) => {
    const key = `${edge.source}→${edge.target}`;
    const existing = unique.get(key);
    if (!existing || STORY_EDGE_PRIORITY[edge.type] < STORY_EDGE_PRIORITY[existing.type]) unique.set(key, edge);
  });
  const deduplicated = [...unique.values()];

  // A direct decision → goal support edge is only useful when it is the last
  // step in the flow. If another visible route reaches the goal, omit the
  // shortcut while keeping it available in All.
  return deduplicated.filter((edge) => {
    if (edge.type !== 'supports' || nodes.get(edge.target)?.type !== 'GOAL') return true;
    return !reachable(edge.source, edge.target, deduplicated.filter((candidate) => candidate.id !== edge.id));
  });
}

export function buildDecisionStoryJunctions(edges: DecisionStoryEdge[]): DecisionStoryJunction[] {
  const sourcesByTarget = new Map<string, Set<string>>();
  edges.forEach((edge) => sourcesByTarget.set(edge.target, new Set([...(sourcesByTarget.get(edge.target) ?? []), edge.source])));
  return [...sourcesByTarget.entries()]
    .filter(([, sources]) => sources.size > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([target, sources]) => ({ target, sources: [...sources].sort() }));
}

export function decisionStoryRiskAnnotations(
  project: Project,
  decisionNodeId: string,
  visibleNodeIds: ReadonlySet<string>,
): string[] {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  return project.edges.flatMap((edge) => {
    if (!['affects', 'blocks', 'informs', 'supports'].includes(edge.type)) return [];
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const risk = source?.type === 'RISK' ? source : target?.type === 'RISK' ? target : undefined;
    const other = risk?.id === source?.id ? target : source;
    if (!risk || risk.status !== 'OPEN' || other?.type !== 'DECISION' || other.id !== decisionNodeId || !visibleNodeIds.has(other.id)) return [];
    return [risk.text];
  });
}

export function decisionStoryPath(
  project: Project,
  projection: Pick<DecisionMapProjection, 'visibleNodeIds'>,
  startNodeId: string | null,
): { nodeIds: string[]; edgeIds: string[] } {
  if (!startNodeId) return { nodeIds: [], edgeIds: [] };
  const edges = buildDecisionStoryEdges(project, projection);
  const goals = new Set(project.nodes.filter((node) => node.type === 'GOAL').map((node) => node.id));
  if (goals.has(startNodeId)) return { nodeIds: [startNodeId], edgeIds: [] };
  const queue: Array<{ nodeId: string; nodeIds: string[]; edgeIds: string[] }> = [{ nodeId: startNodeId, nodeIds: [startNodeId], edgeIds: [] }];
  const visited = new Set([startNodeId]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const edge of edges.filter((candidate) => candidate.source === current.nodeId)) {
      if (visited.has(edge.target)) continue;
      const next = {
        nodeId: edge.target,
        nodeIds: [...current.nodeIds, edge.target],
        edgeIds: [...current.edgeIds, edge.id],
      };
      if (goals.has(edge.target)) return next;
      visited.add(edge.target);
      queue.push(next);
    }
  }
  return { nodeIds: [startNodeId], edgeIds: [] };
}
