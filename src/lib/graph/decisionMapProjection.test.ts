import { describe, expect, it } from 'vitest';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { buildDecisionMapProjection } from './decisionMapProjection';

describe('Decision Map projection', () => {
  it('uses All as the canonical projection and preserves every persisted node and edge', () => {
    const project = createBakeryDemoProject();
    const before = JSON.stringify(project);
    const projection = buildDecisionMapProjection(project, null);

    expect(projection.view).toBe('all');
    expect(projection.visibleNodeIds).toHaveLength(project.nodes.length);
    expect(projection.visibleNodeIds).toEqual(expect.arrayContaining(project.nodes.map((node) => node.id)));
    expect(projection.visibleEdgeIds).toEqual(project.edges.map((edge) => edge.id));
    expect(JSON.stringify(project)).toBe(before);
  });

  it('does not filter or rewrite graph relationships in All', () => {
    const project = createBakeryDemoProject();
    const projection = buildDecisionMapProjection(project, null);
    const visibleNodeIds = new Set(projection.visibleNodeIds);

    expect(projection.visibleNodeIds).toHaveLength(project.nodes.length);
    expect(projection.visibleEdgeIds).toEqual(
      project.edges
        .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
        .map((edge) => edge.id),
    );
  });
});
