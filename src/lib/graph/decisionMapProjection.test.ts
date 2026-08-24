import { describe, expect, it } from 'vitest';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { buildDecisionMapProjection } from './decisionMapProjection';
import { calculateDecisionStoryLayout } from './constellation';

describe('Decision Map projection', () => {
  const focusAssessment = {
    kind: 'decision' as const,
    title: 'Choose the bakery location',
    actionNodeId: 'bakery_location_decision',
    sourceNodeIds: ['bakery_location_decision'],
    sourceIds: ['bakery_launch_planning_notes'],
    score: 0.91,
    confidence: 0.8,
    whyNow: 'The permit depends on this decision.',
    nextAction: 'Record the location decision.',
  };

  it('shows a compact story and groups one-parent support nodes without mutating the graph', () => {
    const project = createBakeryDemoProject();
    const before = JSON.stringify(project);
    const projection = buildDecisionMapProjection(project, focusAssessment, 'story', new Set());

    expect(projection.visibleNodeIds.length).toBeLessThan(project.nodes.length);
    expect(projection.visibleNodeIds).toEqual(expect.arrayContaining([
      'bakery_goal',
      'bakery_location_decision',
      'bakery_products_decision',
      'bakery_pricing_decision',
      'bakery_location_delay_risk',
    ]));
    expect(projection.clusters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentNodeId: 'bakery_location_decision',
        childNodeIds: expect.arrayContaining(['bakery_saturday_market_facts', 'bakery_permit_location_constraint']),
      }),
    ]));
    expect(projection.collapsedNodeIds).toEqual(expect.arrayContaining(['bakery_saturday_market_facts']));
    expect(JSON.stringify(project)).toBe(before);
  });

  it('reveals only the selected supporting cluster when expanded', () => {
    const project = createBakeryDemoProject();
    const collapsed = buildDecisionMapProjection(project, focusAssessment, 'story', new Set());
    const expanded = buildDecisionMapProjection(project, focusAssessment, 'story', new Set(['bakery_location_decision']));

    expect(expanded.visibleNodeIds).toEqual(expect.arrayContaining(collapsed.clusters[0]?.childNodeIds ?? []));
    expect(expanded.visibleNodeIds.length).toBeGreaterThan(collapsed.visibleNodeIds.length);
    expect(expanded.visibleEdgeIds).toEqual(expect.arrayContaining(
      project.edges
        .filter((edge) => expanded.visibleNodeIds.includes(edge.source) && expanded.visibleNodeIds.includes(edge.target))
        .map((edge) => edge.id),
    ));
  });

  it('keeps all canonical nodes and edges in the all view', () => {
    const project = createBakeryDemoProject();
    const projection = buildDecisionMapProjection(project, focusAssessment, 'all', new Set());

    expect(projection.visibleNodeIds).toHaveLength(project.nodes.length);
    expect(projection.visibleEdgeIds).toHaveLength(project.edges.length);
    expect(projection.collapsedNodeIds).toEqual([]);
  });

  it('collapses a same-work satisfies action under its decision', () => {
    const project = createBakeryDemoProject();
    const action = project.nodes.find((node) => node.id === 'bakery_select_location_action');
    if (!action) throw new Error('Bakery action fixture is missing.');
    project.nodes.push({
      ...action,
      id: 'bakery_select_location_satisfies_action',
      text: 'Choose the bakery location now',
    });
    project.edges.push({
      id: 'bakery_edge_location_satisfies',
      source: 'bakery_select_location_satisfies_action',
      target: 'bakery_location_decision',
      type: 'satisfies',
    });

    const projection = buildDecisionMapProjection(project, focusAssessment, 'story', new Set());

    expect(projection.collapsedNodeIds).toContain('bakery_select_location_satisfies_action');
    expect(projection.clusters.find((cluster) => cluster.parentNodeId === 'bakery_location_decision')?.childNodeIds)
      .toContain('bakery_select_location_satisfies_action');
  });

  it('lays out the story by semantic depth rather than node type', () => {
    const project = createBakeryDemoProject();
    const projection = buildDecisionMapProjection(project, focusAssessment, 'story', new Set());
    const layout = calculateDecisionStoryLayout(project, projection);

    expect(layout.bakery_location_decision.y).toBeLessThan(layout.bakery_pricing_decision.y);
    expect(layout.bakery_products_decision.y).toBeLessThan(layout.bakery_pricing_decision.y);
    expect(layout.bakery_pricing_decision.y).toBeLessThan(layout.bakery_goal.y);
  });
});
