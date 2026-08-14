import { ClarityEdge, ClarityNode, Project } from '@/types/clarity';

export interface ConstellationPoint {
  x: number;
  y: number;
  z: number;
}

export interface DecisionPath {
  nodeIds: string[];
  edgeIds: string[];
}

const EDGE_PRIORITY: Record<ClarityEdge['type'], number> = {
  blocks: 0,
  depends_on: 1,
  affects: 2,
  resolves: 3,
  contradicts: 4,
  supports: 5,
  supersedes: 6,
  informs: 7,
  derived_from: 8,
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

