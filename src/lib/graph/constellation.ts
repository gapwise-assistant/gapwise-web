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

export interface DecisionMapMetrics {
  width: number;
  height: number;
}

export interface DecisionMapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface DecisionMapComponent {
  nodeIds: string[];
  edgeCount: number;
}

export interface DecisionMapNodeDimensions {
  width: number;
  height: number;
}

function decisionMapScore(node: ClarityNode): number {
  return (node.impact * node.confidence) + (node.priority ?? 0) * 0.25;
}

/** Kept with the deterministic layout so renderer diagnostics use its exact node boxes. */
export function decisionMapNodeDimensions(
  node: ClarityNode,
  _secondary = false,
): DecisionMapNodeDimensions {
  const lineCount = Math.min(6, Math.max(3, Math.ceil(node.text.length / 42)));
  if (node.type === 'GOAL') return { width: 260, height: 62 + lineCount * 16 };
  return { width: 228, height: 58 + lineCount * 16 };
}

function semanticDirection(edge: ClarityEdge): { source: string; target: string } {
  return edge.type === 'depends_on'
    ? { source: edge.target, target: edge.source }
    : { source: edge.source, target: edge.target };
}

/** Connected components intentionally treat every persisted edge as undirected. */
export function decisionMapComponents(
  graph: Pick<Project, 'nodes' | 'edges'>,
): DecisionMapComponent[] {
  const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const adjacency = new Map<string, Set<string>>();
  graph.nodes.forEach((node) => adjacency.set(node.id, new Set()));
  graph.edges.forEach((edge) => {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  });

  const remaining = new Set(graph.nodes.map((node) => node.id));
  const components: DecisionMapComponent[] = [];
  while (remaining.size > 0) {
    const start = [...remaining].sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0))[0];
    const queue = [start];
    const nodeIds = new Set<string>([start]);
    remaining.delete(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      [...(adjacency.get(current) ?? [])]
        .sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0))
        .forEach((next) => {
          if (nodeIds.has(next)) return;
          nodeIds.add(next);
          remaining.delete(next);
          queue.push(next);
        });
    }
    components.push({
      nodeIds: [...nodeIds].sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0)),
      edgeCount: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).length,
    });
  }

  return components.sort((left, right) => {
    const leftConnected = left.edgeCount > 0 ? 1 : 0;
    const rightConnected = right.edgeCount > 0 ? 1 : 0;
    return rightConnected - leftConnected
      || right.edgeCount - left.edgeCount
      || right.nodeIds.length - left.nodeIds.length
      || (nodeOrder.get(left.nodeIds[0]) ?? 0) - (nodeOrder.get(right.nodeIds[0]) ?? 0);
  });
}

function componentLayout(
  graph: Pick<Project, 'nodes' | 'edges'>,
  component: DecisionMapComponent,
): { positions: Record<string, ConstellationPoint>; bounds: DecisionMapBounds } {
  const nodes = component.nodeIds
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter((node): node is ClarityNode => Boolean(node));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  nodes.forEach((node) => incoming.set(node.id, 0));
  graph.edges
    .filter((edge) => component.nodeIds.includes(edge.source) && component.nodeIds.includes(edge.target))
    .forEach((edge) => {
      const direction = semanticDirection(edge);
      outgoing.set(direction.source, [...(outgoing.get(direction.source) ?? []), direction.target]);
      incoming.set(direction.target, (incoming.get(direction.target) ?? 0) + 1);
    });

  const degree = (nodeId: string) => graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).length;
  const roots = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort((left, right) => degree(right.id) - degree(left.id) || decisionMapScore(right) - decisionMapScore(left) || left.text.localeCompare(right.text));
  const queue = roots.length > 0 ? roots.map((node) => node.id) : [nodes[0]?.id].filter((id): id is string => Boolean(id));
  const levels = new Map<string, number>();
  queue.forEach((id) => levels.set(id, 0));
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextLevel = (levels.get(current) ?? 0) + 1;
    (outgoing.get(current) ?? []).forEach((next) => {
      if (!levels.has(next)) {
        levels.set(next, nextLevel);
        queue.push(next);
      }
    });
  }
  nodes.forEach((node) => {
    if (levels.has(node.id)) return;
    levels.set(node.id, 0);
    queue.push(node.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      (outgoing.get(current) ?? []).forEach((next) => {
        if (levels.has(next)) return;
        levels.set(next, (levels.get(current) ?? 0) + 1);
        queue.push(next);
      });
    }
  });

  const layers = new Map<number, ClarityNode[]>();
  nodes.forEach((node) => {
    const level = levels.get(node.id) ?? 0;
    layers.set(level, [...(layers.get(level) ?? []), node]);
  });

  const positions: Record<string, ConstellationPoint> = {};
  const horizontalGap = 48;
  const verticalGap = 48;
  const maxLayerWidth = 1180;
  const layerRows = [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([level, layer]) => {
      const ordered = layer.sort((left, right) => (
        decisionMapScore(right) - decisionMapScore(left)
        || left.text.localeCompare(right.text)
        || left.id.localeCompare(right.id)
      ));
      const rows: Array<{ nodes: ClarityNode[]; width: number; height: number }> = [];
      ordered.forEach((node) => {
        const dimensions = decisionMapNodeDimensions(node);
        const current = rows.at(-1);
        const nextWidth = (current?.width ?? 0) + (current && current.nodes.length > 0 ? horizontalGap : 0) + dimensions.width;
        if (current && nextWidth > maxLayerWidth) {
          rows.push({ nodes: [node], width: dimensions.width, height: dimensions.height });
          return;
        }
        if (current) {
          current.nodes.push(node);
          current.width = nextWidth;
          current.height = Math.max(current.height, dimensions.height);
        } else {
          rows.push({ nodes: [node], width: dimensions.width, height: dimensions.height });
        }
      });
      return { level, rows };
    });

  const componentWidth = Math.max(
    0,
    ...layerRows.flatMap(({ rows }) => rows.map((row) => row.width)),
  );
  let cursorY = 0;
  layerRows.forEach(({ rows }) => {
    rows.forEach((row, rowIndex) => {
      let cursorX = (componentWidth - row.width) / 2;
      row.nodes.forEach((node) => {
        const dimensions = decisionMapNodeDimensions(node);
        positions[node.id] = {
          x: cursorX + dimensions.width / 2,
          y: cursorY + dimensions.height / 2,
          z: 0,
        };
        cursorX += dimensions.width + horizontalGap;
      });
      cursorY += row.height + (rowIndex < rows.length - 1 ? verticalGap : 0);
    });
    cursorY += verticalGap;
  });

  const bounds = decisionMapBounds(graph, positions);
  return { positions, bounds };
}

export function decisionMapBounds(
  graph: Pick<Project, 'nodes'>,
  positions: Record<string, ConstellationPoint>,
): DecisionMapBounds {
  const boxes = graph.nodes
    .filter((node) => positions[node.id])
    .map((node) => {
      const point = positions[node.id];
      const dimensions = decisionMapNodeDimensions(node);
      return {
        minX: point.x - dimensions.width / 2,
        maxX: point.x + dimensions.width / 2,
        minY: point.y - dimensions.height / 2,
        maxY: point.y + dimensions.height / 2,
      };
    });
  if (boxes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const minX = Math.min(...boxes.map((box) => box.minX));
  const maxX = Math.max(...boxes.map((box) => box.maxX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  const maxY = Math.max(...boxes.map((box) => box.maxY));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function calculateDecisionMapLayout(
  graph: Pick<Project, 'nodes' | 'edges'>,
): Record<string, ConstellationPoint> {
  const components = decisionMapComponents(graph);
  const positions: Record<string, ConstellationPoint> = {};
  const componentGap = 96;
  const maxRowWidth = 1180;
  let cursorX = 90;
  let cursorY = 96;
  let rowHeight = 0;

  components.filter((component) => component.edgeCount > 0).forEach((component) => {
    const local = componentLayout(graph, component);
    if (cursorX > 90 && cursorX + local.bounds.width > maxRowWidth) {
      cursorX = 90;
      cursorY += rowHeight + componentGap;
      rowHeight = 0;
    }
    component.nodeIds.forEach((nodeId) => {
      const point = local.positions[nodeId];
      positions[nodeId] = { x: point.x + cursorX - local.bounds.minX, y: point.y + cursorY - local.bounds.minY, z: 0 };
    });
    cursorX += local.bounds.width + componentGap;
    rowHeight = Math.max(rowHeight, local.bounds.height);
  });

  if (rowHeight > 0) cursorY += rowHeight + componentGap;
  const isolated = components.filter((component) => component.edgeCount === 0).flatMap((component) => component.nodeIds);
  const isolatedRows: Array<{ nodeIds: string[]; width: number; height: number }> = [];
  isolated.forEach((nodeId) => {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    const dimensions = node ? decisionMapNodeDimensions(node) : { width: 228, height: 100 };
    const current = isolatedRows.at(-1);
    const nextWidth = (current?.width ?? 0) + (current && current.nodeIds.length > 0 ? 48 : 0) + dimensions.width;
    if (current && (current.nodeIds.length >= 4 || nextWidth > maxRowWidth)) {
      isolatedRows.push({ nodeIds: [nodeId], width: dimensions.width, height: dimensions.height });
      return;
    }
    if (current) {
      current.nodeIds.push(nodeId);
      current.width = nextWidth;
      current.height = Math.max(current.height, dimensions.height);
    } else {
      isolatedRows.push({ nodeIds: [nodeId], width: dimensions.width, height: dimensions.height });
    }
  });
  isolatedRows.forEach((row, rowIndex) => {
    let cursorX = 90;
    row.nodeIds.forEach((nodeId) => {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      const dimensions = node ? decisionMapNodeDimensions(node) : { width: 228, height: 100 };
      positions[nodeId] = {
        x: cursorX + dimensions.width / 2,
        y: cursorY + dimensions.height / 2,
        z: 0,
      };
      cursorX += dimensions.width + 48;
    });
    cursorY += row.height + (rowIndex < isolatedRows.length - 1 ? 48 : 0);
  });
  return positions;
}

export function calculateDecisionMapMetrics(
  graph: Pick<Project, 'nodes' | 'edges'>,
): DecisionMapMetrics {
  const positions = calculateDecisionMapLayout(graph);
  const bounds = decisionMapBounds(graph, positions);
  return {
    width: Math.max(980, bounds.maxX + 90),
    height: Math.max(620, bounds.maxY + 90),
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
