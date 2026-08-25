import type { ClarityNode, Project } from '@/types/clarity';
import type { AskGraphContext } from '@/types/contextPack';
import { relevanceScore } from '@/lib/retrieval/relevance';

const MAX_GRAPH_NODES = 16;
const MAX_STARTING_NODES = 8;
const MAX_DIRECT_NEIGHBORS = 8;
const MAX_SECOND_HOP_NODES = 4;

const OPEN_REASONING_TYPES = new Set<ClarityNode['type']>([
  'DECISION',
  'UNKNOWN',
  'ASSUMPTION',
]);

function nodeSearchText(node: ClarityNode): string {
  return `${node.type} ${node.text} ${node.why_it_matters?.join(' ') ?? ''}`;
}

function nodeScore(query: string, node: ClarityNode): number {
  const relevance = relevanceScore(query, nodeSearchText(node));
  const openBonus = node.status === 'OPEN' && OPEN_REASONING_TYPES.has(node.type)
    ? 0.2
    : 0;
  const priority = (node.priority ?? node.impact) * 0.1;
  return relevance + openBonus + priority;
}

function compareScoredNodes(
  left: { node: ClarityNode; score: number },
  right: { node: ClarityNode; score: number },
): number {
  return right.score - left.score
    || right.node.impact * right.node.confidence
      - left.node.impact * left.node.confidence
    || right.node.updated_at.localeCompare(left.node.updated_at)
    || left.node.id.localeCompare(right.node.id);
}

/**
 * Selects a bounded, question-specific view of the persisted project graph.
 * This is read-only and is only called for the graph_reasoning Ask route.
 */
export function buildAskGraphContext(
  project: Project,
  message: string,
): AskGraphContext {
  const validNodes = project.nodes.filter((node) => node.status !== 'DEPRECATED');
  const nodesById = new Map(validNodes.map((node) => [node.id, node]));
  const scoredNodes = validNodes
    .map((node) => ({ node, score: nodeScore(message, node) }))
    .sort(compareScoredNodes);

  const starting = scoredNodes
    .filter((item) => relevanceScore(message, nodeSearchText(item.node)) > 0)
    .slice(0, MAX_STARTING_NODES)
    .map((item) => item.node);

  if (starting.length === 0) {
    scoredNodes
      .filter((item) =>
        item.node.type === 'GOAL'
        || OPEN_REASONING_TYPES.has(item.node.type),
      )
      .slice(0, Math.min(4, MAX_STARTING_NODES))
      .forEach((item) => starting.push(item.node));
  }

  const selected = new Map(starting.map((node) => [node.id, node]));
  const startingNodeIds = starting.map((node) => node.id);

  const neighborCandidates = (
    currentIds: Set<string>,
    excludedIds: Set<string>,
  ): Array<{ node: ClarityNode; score: number }> => {
    const scores = new Map<string, number>();

    project.edges.forEach((edge) => {
      const isConnected = currentIds.has(edge.source) || currentIds.has(edge.target);
      if (!isConnected) return;
      const neighborId = currentIds.has(edge.source) ? edge.target : edge.source;
      if (excludedIds.has(neighborId)) return;

      const neighbor = nodesById.get(neighborId);
      if (!neighbor) return;
      scores.set(neighborId, Math.max(scores.get(neighborId) ?? 0, nodeScore(message, neighbor)));
    });

    return Array.from(scores.entries())
      .map(([id, score]) => ({ node: nodesById.get(id) as ClarityNode, score: score + 0.08 }))
      .sort(compareScoredNodes);
  };

  const startingIds = new Set(startingNodeIds);
  neighborCandidates(startingIds, new Set(selected.keys()))
    .slice(0, Math.min(MAX_DIRECT_NEIGHBORS, MAX_GRAPH_NODES - selected.size))
    .forEach(({ node }) => selected.set(node.id, node));

  // A small second hop is useful for a real prerequisite/consequence chain,
  // but only when the first hop has not already filled the graph budget.
  if (selected.size < 10) {
    neighborCandidates(new Set(selected.keys()), new Set(selected.keys()))
      .slice(0, Math.min(MAX_SECOND_HOP_NODES, MAX_GRAPH_NODES - selected.size))
      .forEach(({ node }) => selected.set(node.id, node));
  }

  const selectedNodeIds = new Set(selected.keys());
  const selectedEdges = project.edges.filter((edge) =>
    selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
  );

  return {
    projectGoal: project.goal,
    nodes: Array.from(selected.values()).map((node) => ({
      id: node.id,
      type: node.type,
      status: node.status,
      text: node.text,
      confidence: node.confidence,
      impact: node.impact,
    })),
    edges: selectedEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
    })),
    startingNodeIds,
  };
}
