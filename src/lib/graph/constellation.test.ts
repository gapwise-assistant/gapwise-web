import { describe, expect, it } from 'vitest';
import {
  buildDecisionPath,
  buildDecisionExplanation,
  calculateConstellationLayout,
  calculateDecisionMapMetrics,
  calculateDecisionMapLayout,
  decisionMapBounds,
  decisionMapComponents,
  decisionMapNodeDimensions,
  getNeighborhood,
} from '@/lib/graph/constellation';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import type { ClarityNode } from '@/types/clarity';

function testNode(id: string, text = id, type: ClarityNode['type'] = 'KNOWN'): ClarityNode {
  return {
    id,
    type,
    text,
    status: 'OPEN',
    confidence: 0.8,
    impact: 0.5,
    source_refs: [],
    created_by: 'user',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function expectNoCardCollisions(project: { nodes: ClarityNode[] }, layout: ReturnType<typeof calculateDecisionMapLayout>) {
  for (let leftIndex = 0; leftIndex < project.nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < project.nodes.length; rightIndex += 1) {
      const left = project.nodes[leftIndex];
      const right = project.nodes[rightIndex];
      const leftPoint = layout[left.id];
      const rightPoint = layout[right.id];
      const leftDimensions = decisionMapNodeDimensions(left);
      const rightDimensions = decisionMapNodeDimensions(right);
      const overlaps = Math.abs(leftPoint.x - rightPoint.x) < (leftDimensions.width + rightDimensions.width) / 2
        && Math.abs(leftPoint.y - rightPoint.y) < (leftDimensions.height + rightDimensions.height) / 2;
      expect(overlaps).toBe(false);
    }
  }
}

describe('constellation graph view model', () => {
  it('creates stable positions for every project node', () => {
    const project = createGoldenDemoProject();
    const first = calculateConstellationLayout(project);
    const second = calculateConstellationLayout(project);

    expect(Object.keys(first)).toHaveLength(project.nodes.length);
    expect(first).toEqual(second);
    expect(first.node_goal.x).toBeGreaterThanOrEqual(-6.2);
    expect(first.node_goal.x).toBeLessThanOrEqual(6.2);
  });

  it('finds a connected neighborhood in either edge direction', () => {
    const project = createGoldenDemoProject();
    const neighborhood = getNeighborhood(project, 'unknown_target_user');

    expect(neighborhood).toEqual(new Set(['unknown_target_user', 'node_decision_track']));
  });

  it('builds a decision path from a question to the goal', () => {
    const project = createGoldenDemoProject();
    const path = buildDecisionPath(project, 'unknown_target_user');

    expect(path.nodeIds).toEqual(['unknown_target_user', 'node_decision_track', 'node_goal']);
    expect(path.edgeIds).toEqual(['e5', 'e3']);
  });

  it('builds a directed explanation that prefers dependency steps before a direct goal support edge', () => {
    const project = createGoldenDemoProject();
    const path = buildDecisionExplanation(project, 'unknown_target_user');

    expect(path.nodeIds[0]).toBe('unknown_target_user');
    expect(path.nodeIds.at(-1)).toBe('node_goal');
    expect(path.nodeIds.length).toBeGreaterThan(1);
  });

  it('places every node in a compact connected-component layout', () => {
    const project = createGoldenDemoProject();
    const layout = calculateDecisionMapLayout(project);

    expect(Object.keys(layout)).toHaveLength(project.nodes.length);
    expect(Object.values(layout).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expectNoCardCollisions(project, layout);
    expect(new Set(Object.values(layout).map((point) => `${point.x}:${point.y}`)).size).toBe(project.nodes.length);
    expect(calculateDecisionMapLayout(project)).toEqual(layout);
  });

  it('reports actual card bounds without fixed semantic lanes', () => {
    const project = createGoldenDemoProject();
    const layout = calculateDecisionMapLayout(project);
    const metrics = calculateDecisionMapMetrics(project);
    const bounds = decisionMapBounds(project, layout);

    expect(metrics.width).toBeGreaterThanOrEqual(bounds.maxX + 90);
    expect(metrics.height).toBeGreaterThanOrEqual(bounds.maxY + 90);
    expect(calculateDecisionMapMetrics(project)).toEqual(metrics);
  });

  it('packs isolated nodes into a wrapping grid', () => {
    const project = {
      nodes: Array.from({ length: 20 }, (_, index) => ({
        id: `isolated-${index}`,
        type: 'KNOWN' as const,
        text: `Independent fact ${index}`,
        status: 'RESOLVED' as const,
        confidence: 1,
        impact: 0.2,
        source_refs: [],
        why_it_matters: [],
        created_by: 'user' as const,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })),
      edges: [],
    };
    const layout = calculateDecisionMapLayout(project);
    const ys = new Set(Object.values(layout).map((point) => point.y));

    expect(Object.keys(layout)).toHaveLength(20);
    expectNoCardCollisions(project, layout);
    expect(ys.size).toBeGreaterThan(1);
    expect(Math.max(...Object.values(layout).map((point) => point.y)) - Math.min(...Object.values(layout).map((point) => point.y))).toBeLessThan(700);
  });

  it('keeps a connected component and isolated context separated without collisions', () => {
    const base = createGoldenDemoProject();
    const project = {
      ...base,
      nodes: [
        ...base.nodes,
        ...Array.from({ length: 15 }, (_, index) => testNode(`isolated-${index}`, `A long independent context statement ${index} that should remain readable.`)),
      ],
    };
    const layout = calculateDecisionMapLayout(project);

    expect(Object.keys(layout)).toHaveLength(project.nodes.length);
    expectNoCardCollisions(project, layout);
    expect(decisionMapBounds(project, layout).height).toBeGreaterThan(decisionMapBounds(base, calculateDecisionMapLayout(base)).height);
  });

  it('keeps several independent connected components compact and deterministic', () => {
    const project = {
      nodes: [
        testNode('goal', 'Complete the work', 'GOAL'),
        testNode('evidence-a', 'Evidence A', 'EVIDENCE'),
        testNode('decision-a', 'Decision A', 'DECISION'),
        testNode('evidence-b', 'Evidence B', 'EVIDENCE'),
        testNode('decision-b', 'Decision B', 'DECISION'),
        testNode('isolated', 'An unconnected fact'),
      ],
      edges: [
        { id: 'edge-a', source: 'evidence-a', target: 'decision-a', type: 'supports' as const },
        { id: 'edge-goal', source: 'decision-a', target: 'goal', type: 'supports' as const },
        { id: 'edge-b', source: 'evidence-b', target: 'decision-b', type: 'supports' as const },
      ],
    };
    const first = calculateDecisionMapLayout(project);
    const second = calculateDecisionMapLayout(project);

    expect(first).toEqual(second);
    expectNoCardCollisions(project, first);
    expect(decisionMapComponents(project)).toHaveLength(3);
  });

  it('handles long cards without overlap', () => {
    const project = {
      nodes: [
        testNode('root', 'Root decision', 'DECISION'),
        testNode('long-a', 'A very long project statement that contains enough detail to fill the full readable card height and exercise actual card bounds.', 'EVIDENCE'),
        testNode('long-b', 'Another long project statement with independent detail that must remain separate from its sibling.', 'EVIDENCE'),
      ],
      edges: [
        { id: 'edge-a', source: 'long-a', target: 'root', type: 'supports' as const },
        { id: 'edge-b', source: 'long-b', target: 'root', type: 'supports' as const },
      ],
    };
    const layout = calculateDecisionMapLayout(project);

    expectNoCardCollisions(project, layout);
    expect(new Set(Object.values(layout).map((point) => `${point.x}:${point.y}`)).size).toBe(project.nodes.length);
  });

  it('detects connected components using undirected connectivity', () => {
    const project = createGoldenDemoProject();
    const components = decisionMapComponents(project);

    expect(components.reduce((total, component) => total + component.nodeIds.length, 0)).toBe(project.nodes.length);
    expect(components.reduce((total, component) => total + component.edgeCount, 0)).toBe(project.edges.length);
  });
});
