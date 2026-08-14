import { describe, expect, it } from 'vitest';
import {
  buildDecisionPath,
  calculateConstellationLayout,
  calculateDecisionMapMetrics,
  calculateDecisionMapLayout,
  getNeighborhood,
} from '@/lib/graph/constellation';
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

  it('places the decision map in a readable semantic hierarchy', () => {
    const project = createGoldenDemoProject();
    const layout = calculateDecisionMapLayout(project);

    expect(layout.node_known_track.y).toBeLessThan(layout.node_assumption_visual.y);
    expect(layout.node_assumption_visual.y).toBeLessThan(layout.unknown_target_user.y);
    expect(layout.unknown_target_user.y).toBeLessThan(layout.node_decision_track.y);
    expect(layout.node_decision_track.y).toBeLessThan(layout.node_goal.y);
    expect(layout.unknown_target_user.x).toBeGreaterThan(0);
    expect(layout.node_goal.x).toBeGreaterThan(0);
    expect(calculateDecisionMapLayout(project)).toEqual(layout);
  });

  it('keeps semantic lane metrics stable and ordered', () => {
    const project = createGoldenDemoProject();
    const metrics = calculateDecisionMapMetrics(project);

    expect(metrics.width).toBeGreaterThan(metrics.laneY[4]);
    expect(metrics.laneY[0]).toBeLessThan(metrics.laneY[1]);
    expect(metrics.laneY[1]).toBeLessThan(metrics.laneY[2]);
    expect(metrics.laneY[2]).toBeLessThan(metrics.laneY[3]);
    expect(metrics.laneY[3]).toBeLessThan(metrics.laneY[4]);
    expect(metrics.height).toBeGreaterThan(metrics.laneY[4]);
    expect(calculateDecisionMapMetrics(project)).toEqual(metrics);
  });
});
