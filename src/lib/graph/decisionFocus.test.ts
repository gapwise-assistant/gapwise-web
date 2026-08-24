import { describe, expect, it } from 'vitest';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { buildDecisionNodeFocus } from './decisionFocus';

describe('Decision Focus projection', () => {
  it('builds a readable focus from persisted inputs, dependencies, risks, and goal path', () => {
    const project = createBakeryDemoProject();
    const before = JSON.stringify(project);
    const focus = buildDecisionNodeFocus(project, 'bakery_location_decision');

    expect(focus?.node.id).toBe('bakery_location_decision');
    expect(focus?.inputs.map((node) => node.id)).toEqual(expect.arrayContaining([
      'bakery_saturday_market_facts',
      'bakery_shared_kitchen_facts',
      'bakery_fixed_cost_constraint',
      'bakery_permit_location_constraint',
    ]));
    expect(focus?.downstream.map((node) => node.id)).toContain('bakery_pricing_decision');
    expect(focus?.downstream.map((node) => node.id)).not.toContain('bakery_select_location_action');
    expect(focus?.nextActions.map((node) => node.id)).toContain('bakery_select_location_action');
    expect(focus?.risks.map((node) => node.id)).toContain('bakery_location_delay_risk');
    expect(focus?.goalPath.map((node) => node.id)).toEqual([
      'bakery_pricing_decision',
      'bakery_goal',
    ]);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('does not invent a focus for a missing node', () => {
    expect(buildDecisionNodeFocus(createBakeryDemoProject(), 'missing-node')).toBeNull();
  });
});
