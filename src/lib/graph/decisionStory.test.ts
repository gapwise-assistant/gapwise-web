import { describe, expect, it } from 'vitest';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { buildDecisionMapProjection } from './decisionMapProjection';
import {
  buildDecisionStoryEdges,
  buildDecisionStoryJunctions,
  decisionStoryRiskAnnotations,
  decisionStoryPath,
} from './decisionStory';
import { calculateDecisionStoryLayout } from './constellation';

describe('Project Story presentation graph', () => {
  const focus = {
    kind: 'decision' as const,
    title: 'Choose the bakery location',
    actionNodeId: 'bakery_location_decision',
    sourceNodeIds: ['bakery_location_decision'],
    sourceIds: ['bakery_launch_planning_notes'],
    score: 0.9,
    confidence: 0.8,
  };

  it('reverses depends_on for presentation without mutating canonical edges', () => {
    const project = createBakeryDemoProject();
    const before = JSON.stringify(project);
    const projection = buildDecisionMapProjection(project, focus, 'story', new Set());
    const edges = buildDecisionStoryEdges(project, projection);

    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'bakery_location_decision', target: 'bakery_pricing_decision', type: 'depends_on' }),
      expect.objectContaining({ source: 'bakery_products_decision', target: 'bakery_pricing_decision', type: 'depends_on' }),
    ]));
    expect(JSON.stringify(project)).toBe(before);
  });

  it('keeps converging prerequisites as one clean flow and suppresses redundant goal shortcuts', () => {
    const project = createBakeryDemoProject();
    const projection = buildDecisionMapProjection(project, focus, 'story', new Set());
    const edges = buildDecisionStoryEdges(project, projection);
    const junctions = buildDecisionStoryJunctions(edges);

    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'bakery_location_decision', target: 'bakery_pricing_decision' }),
      expect.objectContaining({ source: 'bakery_products_decision', target: 'bakery_pricing_decision' }),
      expect.objectContaining({ source: 'bakery_pricing_decision', target: 'bakery_goal' }),
    ]));
    expect(edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'bakery_location_decision', target: 'bakery_goal' }),
      expect.objectContaining({ source: 'bakery_products_decision', target: 'bakery_goal' }),
    ]));
    expect(junctions).toEqual(expect.arrayContaining([
      { target: 'bakery_pricing_decision', sources: ['bakery_location_decision', 'bakery_products_decision', 'bakery_supplier_decision'] },
    ]));
  });

  it('keeps risks as annotations and highlights a selected downstream route', () => {
    const project = createBakeryDemoProject();
    const projection = buildDecisionMapProjection(project, focus, 'story', new Set());
    const visibleDecisions = new Set(projection.visibleNodeIds);
    expect(decisionStoryRiskAnnotations(project, 'bakery_location_decision', visibleDecisions)).toContain('Choosing a location too late could make the preferred launch weekend impossible');

    const path = decisionStoryPath(project, projection, 'bakery_location_decision');
    expect(path.nodeIds).toEqual(['bakery_location_decision', 'bakery_pricing_decision', 'bakery_goal']);
    expect(path.edgeIds).toHaveLength(2);
  });

  it('places every presentation prerequisite above its dependent and leaves the source graph unchanged', () => {
    const project = createBakeryDemoProject();
    const before = JSON.stringify(project);
    const projection = buildDecisionMapProjection(project, focus, 'story', new Set());
    const layout = calculateDecisionStoryLayout(project, projection);

    expect(layout.bakery_location_decision.y).toBeLessThan(layout.bakery_pricing_decision.y);
    expect(layout.bakery_products_decision.y).toBeLessThan(layout.bakery_pricing_decision.y);
    expect(layout.bakery_pricing_decision.y).toBeLessThan(layout.bakery_goal.y);
    expect(JSON.stringify(project)).toBe(before);
  });
});
