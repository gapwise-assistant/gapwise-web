import type { ClarityNode, Project } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import { calculateClarityScore } from '@/lib/prioritization';

export const BAKERY_DEMO_ID = 'weekend_bakery_pop_up_demo';
export const BAKERY_DEMO_CREATED_AT = '2026-08-23T10:00:00.000Z';
export const BAKERY_LAUNCH_PLANNING_NOTES_ID = 'bakery_launch_planning_notes';

export const BAKERY_LAUNCH_PLANNING_NOTES = `I want to launch a small weekend bakery pop-up within about two months.

I am choosing between two locations.

The Saturday Market charges $900 per month plus 10% of sales. It gets strong weekend foot traffic, but the stall has no oven or refrigeration.

The Shared Kitchen storefront costs $2,200 per month with no revenue share. It includes ovens, refrigeration, prep tables, and some storage.

If I use the Saturday Market, I would also need a licensed commissary kitchen that costs about $450 per month.

I do not want fixed operating costs above $2,500 per month until I know the bakery has repeat demand.

I surveyed 42 nearby residents. 28 said they would probably buy from a weekend bakery at least twice per month.

Most respondents expected individual pastries to cost around $6 to $8.

I still need to decide which location to use, what initial products to sell, and what prices to charge.

The location needs to be chosen before I can submit the food permit application because the permit requires the operating address and kitchen arrangement.

The permit usually takes four to six weeks after submission.

I cannot confidently set final prices until I know the location costs and initial product mix.

For the first menu, I am considering croissants, cookies, sourdough loaves, and two rotating seasonal pastries.

I want to keep the first menu small enough that production is manageable by two people.

My biggest concern is choosing a location too late and then missing the intended launch`;

function node(params: Omit<ClarityNode, 'created_by' | 'created_at' | 'updated_at'>): ClarityNode {
  return {
    ...params,
    created_by: 'agent',
    created_at: BAKERY_DEMO_CREATED_AT,
    updated_at: BAKERY_DEMO_CREATED_AT,
  };
}

/** This demo intentionally carries no durable memories beyond its one context note. */
export function createBakeryDemoMemories(): DurableMemory[] {
  return [];
}

/**
 * A resettable project that starts with only the goal plus one planning note.
 * Every graph statement below is derived from that single note, so it remains
 * useful for exercising the Context, Focus, and decision flows without added
 * source material or a synthetic deadline.
 */
export function createBakeryDemoProject(): Project {
  const sourceId = BAKERY_LAUNCH_PLANNING_NOTES_ID;
  const derivedNodeIds = [
    'bakery_goal',
    'bakery_location_decision',
    'bakery_products_decision',
    'bakery_pricing_decision',
    'bakery_saturday_market_facts',
    'bakery_shared_kitchen_facts',
    'bakery_commissary_requirement',
    'bakery_repeat_demand_evidence',
    'bakery_price_expectation_evidence',
    'bakery_permit_timing',
    'bakery_fixed_cost_constraint',
    'bakery_permit_location_constraint',
    'bakery_pricing_dependency_constraint',
    'bakery_two_person_menu_constraint',
    'bakery_initial_menu_preference',
    'bakery_location_delay_risk',
    'bakery_select_location_action',
  ];

  const project: Project = {
    id: BAKERY_DEMO_ID,
    title: 'Launch a weekend bakery pop-up',
    goal: 'Launch a profitable weekend bakery pop-up within the next two months, validate repeat demand, and avoid committing to high fixed costs before the concept is proven.',
    status: 'active',
    clarity_score: 0,
    created_at: BAKERY_DEMO_CREATED_AT,
    updated_at: BAKERY_DEMO_CREATED_AT,
    sources: [
      {
        id: sourceId,
        filename: 'Bakery Launch Planning Notes',
        type: 'note',
        content: BAKERY_LAUNCH_PLANNING_NOTES,
        extracted_at: BAKERY_DEMO_CREATED_AT,
        derived_node_ids: derivedNodeIds,
        processing_status: 'completed',
        origin: 'user',
        extraction_summary: 'One planning note establishes the launch goal, location, menu, and pricing decisions, operating-cost constraints, permit dependency, and demand evidence.',
      },
    ],
    nodes: [
      node({
        id: 'bakery_goal',
        type: 'GOAL',
        text: 'Launch a profitable weekend bakery pop-up while validating repeat demand before taking on high fixed costs',
        status: 'OPEN',
        confidence: 1,
        impact: 1,
        source_refs: [sourceId],
        why_it_matters: ['Defines the outcome for the two-month test without committing to unproven fixed costs.'],
      }),
      node({
        id: 'bakery_location_decision',
        type: 'DECISION',
        text: 'Choose between the Saturday Market and the Shared Kitchen storefront for the bakery pop-up location',
        status: 'OPEN',
        confidence: 0.72,
        impact: 0.99,
        source_refs: [sourceId],
        why_it_matters: ['The location determines equipment, fixed costs, the kitchen arrangement, and when the permit can be submitted.'],
      }),
      node({
        id: 'bakery_products_decision',
        type: 'DECISION',
        text: 'Choose the initial bakery product mix',
        status: 'OPEN',
        confidence: 0.55,
        impact: 0.82,
        source_refs: [sourceId],
        why_it_matters: ['The first menu must fit a two-person production capacity and inform pricing.'],
      }),
      node({
        id: 'bakery_pricing_decision',
        type: 'DECISION',
        text: 'Set initial prices for the bakery pop-up',
        status: 'OPEN',
        confidence: 0.48,
        impact: 0.84,
        source_refs: [sourceId],
        why_it_matters: ['Final prices depend on the selected location costs and the initial product mix.'],
      }),
      node({
        id: 'bakery_saturday_market_facts',
        type: 'KNOWN',
        text: 'The Saturday Market costs $900 per month plus 10% of sales, has strong weekend foot traffic, and provides no oven or refrigeration',
        status: 'RESOLVED',
        confidence: 0.92,
        impact: 0.94,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_shared_kitchen_facts',
        type: 'KNOWN',
        text: 'The Shared Kitchen storefront costs $2,200 per month with no revenue share and includes ovens, refrigeration, prep tables, and storage',
        status: 'RESOLVED',
        confidence: 0.92,
        impact: 0.94,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_commissary_requirement',
        type: 'KNOWN',
        text: 'Using the Saturday Market also requires a licensed commissary kitchen costing about $450 per month',
        status: 'RESOLVED',
        confidence: 0.88,
        impact: 0.9,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_repeat_demand_evidence',
        type: 'KNOWN',
        text: 'Of 42 surveyed nearby residents, 28 said they would probably buy from a weekend bakery at least twice per month',
        status: 'RESOLVED',
        confidence: 0.8,
        impact: 0.75,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_price_expectation_evidence',
        type: 'KNOWN',
        text: 'Most survey respondents expected individual pastries to cost around $6 to $8',
        status: 'RESOLVED',
        confidence: 0.76,
        impact: 0.7,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_permit_timing',
        type: 'KNOWN',
        text: 'The food permit usually takes four to six weeks after submission',
        status: 'RESOLVED',
        confidence: 0.85,
        impact: 0.93,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_fixed_cost_constraint',
        type: 'CONSTRAINT',
        text: 'Keep fixed operating costs at or below $2,500 per month until repeat demand is proven',
        status: 'RESOLVED',
        confidence: 0.98,
        impact: 0.98,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_permit_location_constraint',
        type: 'CONSTRAINT',
        text: 'Choose the location before submitting the food permit application because it requires the operating address and kitchen arrangement',
        status: 'RESOLVED',
        confidence: 0.98,
        impact: 0.98,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_pricing_dependency_constraint',
        type: 'CONSTRAINT',
        text: 'Final prices cannot be set confidently until location costs and the initial product mix are known',
        status: 'RESOLVED',
        confidence: 0.96,
        impact: 0.9,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_two_person_menu_constraint',
        type: 'CONSTRAINT',
        text: 'Keep the first menu small enough for two people to produce and manage',
        status: 'RESOLVED',
        confidence: 0.96,
        impact: 0.86,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_initial_menu_preference',
        type: 'PREFERENCE',
        text: 'Consider croissants, cookies, sourdough loaves, and two rotating seasonal pastries for the first menu',
        status: 'RESOLVED',
        confidence: 0.78,
        impact: 0.7,
        source_refs: [sourceId],
      }),
      node({
        id: 'bakery_location_delay_risk',
        type: 'RISK',
        text: 'Choosing a location too late could cause the intended launch to be missed',
        status: 'OPEN',
        confidence: 0.78,
        impact: 0.98,
        source_refs: [sourceId],
        why_it_matters: ['The permit lead time leaves little room to delay the location decision.'],
      }),
      node({
        id: 'bakery_select_location_action',
        type: 'NEXT_ACTION',
        text: 'Select the bakery pop-up location before submitting the food permit application',
        status: 'OPEN',
        confidence: 0.9,
        impact: 0.98,
        source_refs: [sourceId],
        why_it_matters: ['This action advances the permit dependency, but first requires recording the location decision.'],
      }),
    ],
    edges: [
      { id: 'bakery_edge_location_goal', source: 'bakery_location_decision', target: 'bakery_goal', type: 'supports' },
      { id: 'bakery_edge_products_goal', source: 'bakery_products_decision', target: 'bakery_goal', type: 'supports' },
      { id: 'bakery_edge_pricing_goal', source: 'bakery_pricing_decision', target: 'bakery_goal', type: 'supports' },
      { id: 'bakery_edge_market_location', source: 'bakery_saturday_market_facts', target: 'bakery_location_decision', type: 'informs' },
      { id: 'bakery_edge_kitchen_location', source: 'bakery_shared_kitchen_facts', target: 'bakery_location_decision', type: 'informs' },
      { id: 'bakery_edge_commissary_location', source: 'bakery_commissary_requirement', target: 'bakery_location_decision', type: 'informs' },
      { id: 'bakery_edge_cost_location', source: 'bakery_fixed_cost_constraint', target: 'bakery_location_decision', type: 'informs' },
      { id: 'bakery_edge_permit_location', source: 'bakery_permit_location_constraint', target: 'bakery_location_decision', type: 'informs' },
      { id: 'bakery_edge_permit_risk', source: 'bakery_permit_timing', target: 'bakery_location_delay_risk', type: 'informs' },
      { id: 'bakery_edge_location_risk', source: 'bakery_location_delay_risk', target: 'bakery_location_decision', type: 'affects' },
      { id: 'bakery_edge_menu_products', source: 'bakery_initial_menu_preference', target: 'bakery_products_decision', type: 'informs' },
      { id: 'bakery_edge_capacity_products', source: 'bakery_two_person_menu_constraint', target: 'bakery_products_decision', type: 'informs' },
      { id: 'bakery_edge_demand_products', source: 'bakery_repeat_demand_evidence', target: 'bakery_products_decision', type: 'informs' },
      { id: 'bakery_edge_pricing_location', source: 'bakery_pricing_decision', target: 'bakery_location_decision', type: 'depends_on' },
      { id: 'bakery_edge_pricing_products', source: 'bakery_pricing_decision', target: 'bakery_products_decision', type: 'depends_on' },
      { id: 'bakery_edge_price_evidence', source: 'bakery_price_expectation_evidence', target: 'bakery_pricing_decision', type: 'informs' },
      { id: 'bakery_edge_cost_pricing', source: 'bakery_pricing_dependency_constraint', target: 'bakery_pricing_decision', type: 'informs' },
      { id: 'bakery_edge_action_location', source: 'bakery_select_location_action', target: 'bakery_location_decision', type: 'depends_on' },
      { id: 'bakery_edge_action_permit', source: 'bakery_select_location_action', target: 'bakery_permit_location_constraint', type: 'supports' },
    ],
    history: [],
    active_question: null,
  };

  project.clarity_score = calculateClarityScore(project);
  return project;
}

export const BAKERY_DEMO_PROJECT = createBakeryDemoProject();
