import { ClarityEdge, ClarityNode, Project } from '@/types/clarity';
import type { DecisionMapProjection } from '@/lib/graph/decisionMapProjection';
import { buildDecisionStoryEdges, isDecisionStoryNode, type DecisionStoryEdge } from '@/lib/graph/decisionStory';

export interface ConstellationPoint {
  x: number;
  y: number;
  z: number;
}

export interface DecisionPath {
  nodeIds: string[];
  edgeIds: string[];
}

export type DecisionMapLane = 0 | 1 | 2 | 3 | 4;

export const DECISION_MAP_WIDTH = 1520;
export const DECISION_MAP_LANES = [0, 1, 2, 3, 4] as const;

export const DECISION_MAP_LANE_LABELS: Record<DecisionMapLane, string> = {
  0: 'Evidence & known',
  1: 'Assumptions & risks',
  2: 'Open questions',
  3: 'Decisions & actions',
  4: 'Goal',
};

const DECISION_MAP_X = [270, 560, 850, 1140];
const DECISION_MAP_ROW_HEIGHT = 160;
const DECISION_MAP_LANE_GAP = 34;

export interface DecisionMapMetrics {
  width: number;
  height: number;
  laneY: Record<DecisionMapLane, number>;
}

export interface DecisionMapNodeDimensions {
  width: number;
  height: number;
}

function decisionMapScore(node: ClarityNode): number {
  return (node.impact * node.confidence) + (node.priority ?? 0) * 0.25;
}

export function decisionMapLaneForType(type: ClarityNode['type']): DecisionMapLane | null {
  if (type === 'EVIDENCE' || type === 'KNOWN' || type === 'CONSTRAINT') return 0;
  if (type === 'ASSUMPTION' || type === 'RISK') return 1;
  if (type === 'UNKNOWN') return 2;
  if (type === 'DECISION' || type === 'NEXT_ACTION' || type === 'EXPERIMENT') return 3;
  if (type === 'GOAL') return 4;
  return null;
}

export function isDecisionMapSecondaryNode(
  node: ClarityNode,
  graph: Pick<Project, 'edges'>,
): boolean {
  if (node.type === 'PREFERENCE') return true;
  if (node.type !== 'KNOWN' && node.type !== 'EVIDENCE') return false;
  return !graph.edges.some((edge) =>
    (edge.source === node.id || edge.target === node.id) && edge.type !== 'derived_from'
  );
}

/** Kept with the deterministic layout so renderer diagnostics use its exact node boxes. */
export function decisionMapNodeDimensions(
  node: ClarityNode,
  secondary: boolean,
): DecisionMapNodeDimensions {
  const lineCount = Math.min(6, Math.max(3, Math.ceil(node.text.length / (secondary ? 24 : 42))));
  if (secondary) return { width: 160, height: 52 + lineCount * 16 };
  if (node.type === 'GOAL') return { width: 260, height: 62 + lineCount * 16 };
  return { width: 228, height: 58 + lineCount * 16 };
}

function laneNodes(
  graph: Pick<Project, 'nodes' | 'edges'>,
  lane: DecisionMapLane,
): ClarityNode[] {
  return graph.nodes
    .filter((node) => decisionMapLaneForType(node.type) === lane && !isDecisionMapSecondaryNode(node, graph))
    .sort((left, right) => {
      const scoreDifference = decisionMapScore(right) - decisionMapScore(left);
      return scoreDifference || left.text.localeCompare(right.text);
    });
}

export function calculateDecisionMapMetrics(
  graph: Pick<Project, 'nodes' | 'edges'>,
): DecisionMapMetrics {
  let cursor = 92;
  const laneY = {} as Record<DecisionMapLane, number>;

  DECISION_MAP_LANES.forEach((lane) => {
    const rows = Math.max(1, Math.ceil(laneNodes(graph, lane).length / DECISION_MAP_X.length));
    const laneHeight = Math.max(154, rows * DECISION_MAP_ROW_HEIGHT + 34);
    laneY[lane] = cursor + laneHeight / 2;
    cursor += laneHeight + DECISION_MAP_LANE_GAP;
  });

  const secondaryCount = graph.nodes.filter((node) => isDecisionMapSecondaryNode(node, graph)).length;
  const secondaryHeight = secondaryCount > 0 ? 100 + secondaryCount * 160 : 0;
  const width = secondaryCount > 0 ? DECISION_MAP_WIDTH : 1340;

  return {
    width,
    height: Math.max(cursor + 28, secondaryHeight + 56),
    laneY,
  };
}

function assignLanePositions(
  nodes: ClarityNode[],
  positions: Map<string, ConstellationPoint>,
  lane: DecisionMapLane,
  laneY: number,
): void {
  const columns = Math.min(DECISION_MAP_X.length, Math.max(nodes.length, 1));
  const xPositions = DECISION_MAP_X.slice(0, columns);
  const xOffset = (DECISION_MAP_X[DECISION_MAP_X.length - 1] - DECISION_MAP_X[0] - (xPositions[xPositions.length - 1] - xPositions[0])) / 2;
  const rows = Math.ceil(nodes.length / DECISION_MAP_X.length);

  nodes.forEach((node, index) => {
    const column = index % DECISION_MAP_X.length;
    const row = Math.floor(index / DECISION_MAP_X.length);
    const rowOffset = (row - (rows - 1) / 2) * DECISION_MAP_ROW_HEIGHT;
    positions.set(node.id, {
      x: (xPositions[column] ?? DECISION_MAP_X[0]) + xOffset,
      y: laneY + rowOffset,
      z: 0,
    });
  });
}

function connectedAnchorX(
  node: ClarityNode,
  graph: Pick<Project, 'edges'>,
  positions: Map<string, ConstellationPoint>,
): number | undefined {
  const relatedXs = graph.edges.flatMap((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return [];
    const relatedId = edge.source === node.id ? edge.target : edge.source;
    const related = positions.get(relatedId);
    return related ? [related.x] : [];
  });
  if (relatedXs.length === 0) return undefined;
  return relatedXs.reduce((total, x) => total + x, 0) / relatedXs.length;
}

/**
 * Deterministic five-lane layout for the readable 2D Decision Map.
 * The force layout remains available for the optional 3D constellation view.
 */
export function calculateDecisionMapLayout(
  graph: Pick<Project, 'nodes' | 'edges'>,
): Record<string, ConstellationPoint> {
  const positions = new Map<string, ConstellationPoint>();
  const metrics = calculateDecisionMapMetrics(graph);
  const lanes = DECISION_MAP_LANES.map((lane) => ({
    lane,
    nodes: laneNodes(graph, lane),
  }));

  lanes.forEach(({ lane, nodes }) => assignLanePositions(nodes, positions, lane, metrics.laneY[lane]));

  for (let pass = 0; pass < 3; pass += 1) {
    lanes.forEach(({ lane, nodes }) => {
      nodes.sort((left, right) => {
        const leftAnchor = connectedAnchorX(left, graph, positions) ?? 600;
        const rightAnchor = connectedAnchorX(right, graph, positions) ?? 600;
        return (leftAnchor - rightAnchor) || (decisionMapScore(right) - decisionMapScore(left)) || left.text.localeCompare(right.text);
      });
      assignLanePositions(nodes, positions, lane, metrics.laneY[lane]);
    });
    [...lanes].reverse().forEach(({ lane, nodes }) => {
      nodes.sort((left, right) => {
        const leftAnchor = connectedAnchorX(left, graph, positions) ?? 600;
        const rightAnchor = connectedAnchorX(right, graph, positions) ?? 600;
        return (leftAnchor - rightAnchor) || (decisionMapScore(right) - decisionMapScore(left)) || left.text.localeCompare(right.text);
      });
      assignLanePositions(nodes, positions, lane, metrics.laneY[lane]);
    });
  }

  graph.nodes
    .filter((node) => isDecisionMapSecondaryNode(node, graph))
    .sort((left, right) => (decisionMapScore(right) - decisionMapScore(left)) || left.text.localeCompare(right.text))
    .forEach((node, index) => {
      const row = index;
      positions.set(node.id, {
        x: 1400,
        y: 102 + row * 160,
        z: 0,
      });
    });

  return Object.fromEntries(positions);
}

function storyLevels(nodes: ClarityNode[], edges: DecisionStoryEdge[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  edges.forEach((edge) => incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]));
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const levelFor = (nodeId: string): number => {
    const cached = levels.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const parents = (incoming.get(nodeId) ?? []).filter((parentId) => !visiting.has(parentId));
    const level = parents.length > 0 ? Math.max(...parents.map(levelFor)) + 1 : 0;
    visiting.delete(nodeId);
    levels.set(nodeId, level);
    return level;
  };
  nodes.forEach((node) => levelFor(node.id));
  return levels;
}

/** Deterministic top-to-bottom story layout. Presentation edges are semantic,
 * so depends_on is already reversed before levels are calculated. */
export function calculateDecisionStoryLayout(
  graph: Pick<Project, 'nodes' | 'edges'>,
  projection: Pick<DecisionMapProjection, 'visibleNodeIds'>,
): Record<string, ConstellationPoint> {
  const visible = new Set(projection.visibleNodeIds);
  const visibleNodes = graph.nodes.filter((node) => visible.has(node.id) && isDecisionStoryNode(node));
  const visibleEdges = buildDecisionStoryEdges({ ...graph, nodes: visibleNodes }, { visibleNodeIds: visibleNodes.map((node) => node.id) });
  const levels = storyLevels(visibleNodes, visibleEdges);
  const groups = new Map<number, ClarityNode[]>();
  visibleNodes.forEach((node) => {
    const depth = levels.get(node.id) ?? 0;
    groups.set(depth, [...(groups.get(depth) ?? []), node]);
  });

  const positions: Record<string, ConstellationPoint> = {};
  const maxColumns = Math.max(1, ...[...groups.values()].map((nodes) => nodes.length));
  const width = Math.max(980, (maxColumns - 1) * 300 + 380);
  [...groups.entries()].sort(([left], [right]) => left - right).forEach(([level, nodes]) => {
    nodes.sort((left, right) => {
      const scoreDifference = (right.impact * right.confidence) - (left.impact * left.confidence);
      return scoreDifference || left.text.localeCompare(right.text);
    });
    const startX = width / 2 - ((nodes.length - 1) * 300) / 2;
    nodes.forEach((node, index) => {
      positions[node.id] = {
        x: startX + index * 300,
        y: 110 + level * 190,
        z: 0,
      };
    });
  });

  return positions;
}

export function calculateDecisionStoryMetrics(
  graph: Pick<Project, 'nodes' | 'edges'>,
  projection: Pick<DecisionMapProjection, 'visibleNodeIds'>,
): { width: number; height: number } {
  const positions = calculateDecisionStoryLayout(graph, projection);
  const visibleNodes = graph.nodes.filter((node) => projection.visibleNodeIds.includes(node.id) && isDecisionStoryNode(node));
  const bounds = visibleNodes.reduce((current, node) => {
    const point = positions[node.id] ?? { x: 0, y: 0, z: 0 };
    const dimensions = decisionMapNodeDimensions(node, false);
    return {
      maxX: Math.max(current.maxX, point.x + dimensions.width / 2),
      maxY: Math.max(current.maxY, point.y + dimensions.height / 2),
    };
    }, { maxX: 0, maxY: 0 });
  return {
    width: Math.max(980, bounds.maxX + 180),
    height: Math.max(620, bounds.maxY + 180),
  };
}

const EDGE_PRIORITY: Record<ClarityEdge['type'], number> = {
  blocks: 0,
  depends_on: 1,
  affects: 2,
  resolves: 3,
  satisfies: 4,
  contradicts: 5,
  supports: 6,
  supersedes: 7,
  informs: 8,
  derived_from: 9,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * A small deterministic spring layout keeps the graph stable between renders
 * while still spreading new and related nodes into a constellation shape.
 */
export function calculateConstellationLayout(
  graph: Pick<Project, 'nodes' | 'edges'>,
  iterations = 48,
): Record<string, ConstellationPoint> {
  const positions = new Map<string, ConstellationPoint>();
  const velocities = new Map<string, ConstellationPoint>();
  const nodes = graph.nodes;

  nodes.forEach((node, index) => {
    if (node.type === 'GOAL') {
      positions.set(node.id, { x: 0, y: 0, z: 0 });
    } else {
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
      const radius = 2.2 + (index % 4) * 0.55;
      positions.set(node.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.78,
        z: Math.sin(angle * 2.1) * (1.1 + (index % 3) * 0.35),
      });
    }
    velocities.set(node.id, { x: 0, y: 0, z: 0 });
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forces = new Map<string, ConstellationPoint>(
      nodes.map((node) => [node.id, { x: 0, y: 0, z: 0 }]),
    );

    for (let index = 0; index < nodes.length; index += 1) {
      const left = nodes[index];
      const leftPosition = positions.get(left.id);
      if (!leftPosition) continue;

      for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
        const right = nodes[otherIndex];
        const rightPosition = positions.get(right.id);
        if (!rightPosition) continue;

        const dx = leftPosition.x - rightPosition.x;
        const dy = leftPosition.y - rightPosition.y;
        const dz = leftPosition.z - rightPosition.z;
        const distanceSquared = Math.max(dx * dx + dy * dy + dz * dz, 0.35);
        const distance = Math.sqrt(distanceSquared);
        const repulsion = 0.34 / distanceSquared;
        const force = {
          x: (dx / distance) * repulsion,
          y: (dy / distance) * repulsion,
          z: (dz / distance) * repulsion,
        };
        const leftForce = forces.get(left.id);
        const rightForce = forces.get(right.id);
        if (leftForce && rightForce) {
          leftForce.x += force.x;
          leftForce.y += force.y;
          leftForce.z += force.z;
          rightForce.x -= force.x;
          rightForce.y -= force.y;
          rightForce.z -= force.z;
        }
      }
    }

    graph.edges.forEach((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      const sourceForce = forces.get(edge.source);
      const targetForce = forces.get(edge.target);
      if (!source || !target || !sourceForce || !targetForce) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.01);
      const spring = (distance - 2.35) * 0.018;
      sourceForce.x += (dx / distance) * spring;
      sourceForce.y += (dy / distance) * spring;
      sourceForce.z += (dz / distance) * spring;
      targetForce.x -= (dx / distance) * spring;
      targetForce.y -= (dy / distance) * spring;
      targetForce.z -= (dz / distance) * spring;
    });

    nodes.forEach((node) => {
      const position = positions.get(node.id);
      const velocity = velocities.get(node.id);
      const force = forces.get(node.id);
      if (!position || !velocity || !force) return;

      const isGoal = node.type === 'GOAL';
      velocity.x = (velocity.x + force.x - (isGoal ? position.x * 0.08 : position.x * 0.012)) * 0.82;
      velocity.y = (velocity.y + force.y - (isGoal ? position.y * 0.08 : position.y * 0.012)) * 0.82;
      velocity.z = (velocity.z + force.z - (isGoal ? position.z * 0.08 : position.z * 0.012)) * 0.82;
      position.x = clamp(position.x + velocity.x, -6.2, 6.2);
      position.y = clamp(position.y + velocity.y, -4.7, 4.7);
      position.z = clamp(position.z + velocity.z, -3.8, 3.8);
    });
  }

  return Object.fromEntries(positions);
}

export function getNeighborhood(
  graph: Pick<Project, 'nodes' | 'edges'>,
  nodeId: string,
  depth = 1,
): Set<string> {
  const visible = new Set<string>([nodeId]);
  let frontier = new Set<string>([nodeId]);

  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    graph.edges.forEach((edge) => {
      if (frontier.has(edge.source)) next.add(edge.target);
      if (frontier.has(edge.target)) next.add(edge.source);
    });
    next.forEach((id) => visible.add(id));
    frontier = next;
  }

  return visible;
}

export function buildDecisionPath(
  graph: Pick<Project, 'nodes' | 'edges'>,
  startNodeId: string,
): DecisionPath {
  const goalIds = new Set(graph.nodes.filter((node) => node.type === 'GOAL').map((node) => node.id));
  if (!graph.nodes.some((node) => node.id === startNodeId) || goalIds.size === 0) {
    return { nodeIds: [startNodeId], edgeIds: [] };
  }
  if (goalIds.has(startNodeId)) return { nodeIds: [startNodeId], edgeIds: [] };

  const queue = [startNodeId];
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const visited = new Set<string>([startNodeId]);
  let goalId: string | undefined;

  while (queue.length > 0 && !goalId) {
    const current = queue.shift();
    if (!current) break;
    const neighbors = graph.edges
      .filter((edge) => edge.source === current || edge.target === current)
      .sort((a, b) => EDGE_PRIORITY[a.type] - EDGE_PRIORITY[b.type]);

    for (const edge of neighbors) {
      const next = edge.source === current ? edge.target : edge.source;
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, { nodeId: current, edgeId: edge.id });
      if (goalIds.has(next)) {
        goalId = next;
        break;
      }
      queue.push(next);
    }
  }

  if (!goalId) return { nodeIds: [startNodeId], edgeIds: [] };

  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  let current: string | undefined = goalId;
  while (current) {
    nodeIds.unshift(current);
    const step = previous.get(current);
    if (!step) break;
    edgeIds.unshift(step.edgeId);
    current = step.nodeId;
  }

  return { nodeIds, edgeIds };
}

const EXPLANATION_EDGE_PRIORITY: Record<ClarityEdge['type'], number> = {
  blocks: 0,
  depends_on: 0,
  satisfies: 1,
  affects: 2,
  informs: 3,
  supports: 4,
  resolves: 4,
  contradicts: 5,
  supersedes: 5,
  derived_from: 6,
};

function explanationDirection(edge: ClarityEdge): { from: string; to: string } {
  return edge.type === 'depends_on'
    ? { from: edge.target, to: edge.source }
    : { from: edge.source, to: edge.target };
}

/**
 * Finds a semantic explanation path without treating the graph as an
 * undirected adjacency list. Persisted edges remain untouched.
 */
export function buildDecisionExplanation(
  graph: Pick<Project, 'nodes' | 'edges'>,
  startNodeId: string,
): DecisionPath {
  const goalIds = new Set(graph.nodes.filter((node) => node.type === 'GOAL').map((node) => node.id));
  if (!graph.nodes.some((node) => node.id === startNodeId) || goalIds.has(startNodeId)) {
    return { nodeIds: [startNodeId], edgeIds: [] };
  }

  const outgoing = new Map<string, ClarityEdge[]>();
  graph.edges.forEach((edge) => {
    const direction = explanationDirection(edge);
    outgoing.set(direction.from, [...(outgoing.get(direction.from) ?? []), edge]);
  });
  outgoing.forEach((edges) => edges.sort((left, right) => (
    EXPLANATION_EDGE_PRIORITY[left.type] - EXPLANATION_EDGE_PRIORITY[right.type]
      || left.id.localeCompare(right.id)
  )));

  const search = (nodeId: string, visited: Set<string>, nodeIds: string[], edgeIds: string[]): DecisionPath | null => {
    if (goalIds.has(nodeId)) return { nodeIds, edgeIds };
    if (nodeIds.length >= Math.max(8, graph.nodes.length + 1)) return null;
    for (const edge of outgoing.get(nodeId) ?? []) {
      const next = explanationDirection(edge).to;
      if (visited.has(next)) continue;
      const result = search(next, new Set([...visited, next]), [...nodeIds, next], [...edgeIds, edge.id]);
      if (result) return result;
    }
    return null;
  };

  return search(startNodeId, new Set([startNodeId]), [startNodeId], [])
    ?? { nodeIds: [startNodeId], edgeIds: [] };
}
