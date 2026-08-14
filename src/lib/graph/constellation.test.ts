import { describe, expect, it } from 'vitest';
import { buildDecisionPath, calculateConstellationLayout, getNeighborhood } from '@/lib/graph/constellation';
import { createGoldenDemoProject } from '@/lib/demo/seed';

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
});
