import type { ClarityNode, EdgeType, NodeType, Project } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import { calculateClarityScore } from '@/lib/prioritization';

export const BAKERY_DEMO_ID = 'weekend_bakery_pop_up_demo';
export const BAKERY_DEMO_CREATED_AT = '2026-08-23T10:00:00.000Z';
export const BAKERY_LAUNCH_PLANNING_NOTES_ID = 'bakery_launch_planning_notes';

/**
 * One deliberately dense source note. The demo graph below is a stable,
 * repeatable representation of the same scenario so the Decision Map can be
 * exercised without requiring a live model call when the prefab is loaded.
 */
export const BAKERY_LAUNCH_PLANNING_NOTES = `Bakery Expansion and Launch Planning

I want to launch a weekend bakery pop-up within the next eight weeks and use the first three months to determine whether it can become a permanent business.

My main goal is to prove repeat demand and reach positive unit economics without taking on large fixed costs too early.

LOCATION

I am considering three launch locations.

The Saturday Market costs $900 per month plus 10% of sales. It has very strong Saturday and Sunday foot traffic, but the stall has no oven, refrigeration, storage, or prep area.

Using the Saturday Market would require a licensed commissary kitchen. One nearby commissary costs $450 per month for basic access, but weekend baking hours are limited and additional oven time costs $22 per hour.

The Shared Kitchen storefront costs $2,200 per month with no revenue share. It includes ovens, refrigeration, prep tables, dry storage, and a small customer-facing counter. The lease requires a three-month minimum commitment.

A neighborhood coffee shop has also offered to host the bakery on weekends. They would take 18% of bakery sales instead of charging rent. They already have refrigeration and display space, but there is no production kitchen and they only have room for about 60 bakery items per day.

I do not want fixed operating commitments above $2,500 per month until repeat demand is demonstrated.

PERMITS AND TIMING

The food permit application requires the operating address and kitchen arrangement, so I need to choose the location before submitting it.

The permit usually takes four to six weeks after a complete application is submitted.

My preferred launch weekend is seven weeks from now.

The city inspector said applications are sometimes delayed when businesses use a production kitchen at a different address from the sales location.

The Shared Kitchen is already approved for commercial food production, which may simplify the inspection process.

I am concerned that choosing the location too late could make the preferred launch date impossible.

CUSTOMER RESEARCH

I surveyed 120 people who live or work nearby.

78 said they would probably buy from a weekend bakery at least twice per month.

31 said they would probably visit only occasionally.

11 said they were unlikely to buy.

Convenience was the most frequently mentioned reason people would choose one bakery over another.

52 respondents preferred being able to preorder online and pick up quickly.

Most respondents expected individual pastries to cost between $6 and $8.

Customers interested in sourdough generally expected a loaf to cost between $10 and $14.

Several respondents said they would pay more for seasonal or specialty pastries, but I have not tested an exact premium price.

MENU

For the initial menu I am considering croissants, chocolate croissants, cookies, sourdough loaves, cinnamon rolls, focaccia, and two rotating seasonal pastries.

I want the first menu to remain small enough that two people can reliably produce it.

Croissants and laminated pastries require significantly more preparation time than cookies or focaccia.

Sourdough production also requires overnight fermentation and more storage space.

I have not decided whether the launch menu should emphasize high-margin simple products or use technically impressive pastries to make the bakery distinctive.

The coffee shop location's 60-item daily capacity could make a broad menu impractical.

PRICING

I still need to determine final prices.

I cannot confidently set pricing until I know the location costs, revenue-share structure, and initial menu.

The Saturday Market's 10% revenue share and the coffee shop's 18% share would affect the margin differently from the Shared Kitchen's fixed rent.

I want the average gross margin before labor to remain above 60%.

I have not yet calculated exact ingredient cost for every candidate product.

OPERATIONS

Two people will run production and sales initially.

One person is comfortable with bread and cookies but has limited experience producing laminated pastry at scale.

If the menu contains several laminated products, we may need either additional training or part-time production help.

I want to avoid hiring a third person until weekly demand justifies it.

The Shared Kitchen allows overnight storage.

The commissary kitchen offers limited storage and charges extra for dedicated shelving.

The coffee shop cannot store bakery inventory overnight.

SUPPLIERS

My preferred flour supplier offers good pricing but requires a $500 minimum order for delivery.

A smaller local supplier has no minimum but prices flour approximately 18% higher.

Butter prices have been volatile and could materially affect croissant margins.

I have not decided which supplier arrangement makes sense at launch.

BRANDING AND SALES

I own the bakery name and domain but the online ordering page is not built yet.

If preordering is part of the launch, the ordering flow needs to be ready before marketing begins.

I am considering taking preorders for pickup windows to reduce waste.

I have not decided whether to accept only preorders initially or also produce inventory for walk-up customers.

The Saturday Market would likely produce the most walk-up demand.

The coffee shop already has a regular customer base.

The Shared Kitchen storefront would require us to generate most of our own traffic.

MARKETING

I have approximately $1,500 available for launch marketing.

I could spend it on local social advertising, neighborhood flyers, opening-week promotions, or partnerships with nearby businesses.

I do not want to choose the marketing mix until I know which location we are using because each location has a different traffic profile.

FINANCIAL RISK

I have $12,000 available for the entire initial experiment, including deposits, permits, equipment, ingredients, packaging, marketing, and operating losses.

I want to preserve at least $4,000 of that amount as a reserve after launch.

If the Shared Kitchen requires a three-month commitment, that commitment needs to be considered against this reserve.

I am willing to accept lower profit during the first month if it produces useful evidence about repeat demand.

SUCCESS CRITERIA

I would consider the experiment promising if, by the end of the third month, at least 35% of first-time customers have purchased again and the bakery can cover ingredients, location costs, packaging, and direct labor from sales.

I do not yet have a reliable system for tracking repeat customers.

OPEN DECISIONS

I need to decide the launch location.

I need to decide the initial menu.

I need to decide product pricing.

I need to decide whether sales should be preorder-first, walk-up-first, or a mix.

I need to decide the launch supplier setup.

I need to decide the marketing mix.

I also need a way to measure repeat demand.

The location decision is the most time-sensitive because it affects the permit, operating costs, production setup, marketing strategy, pricing, and potentially whether the preferred launch date is achievable.`;

interface DemoNodeInput {
  id: string;
  type: NodeType;
  text: string;
  status?: ClarityNode['status'];
  confidence?: number;
  impact?: number;
  why_it_matters?: string[];
}

function node(params: DemoNodeInput, sourceId: string): ClarityNode {
  return {
    id: params.id,
    type: params.type,
    text: params.text,
    status: params.status ?? 'RESOLVED',
    confidence: params.confidence ?? 0.9,
    impact: params.impact ?? 0.75,
    source_refs: [sourceId],
    why_it_matters: params.why_it_matters,
    created_by: 'agent',
    created_at: BAKERY_DEMO_CREATED_AT,
    updated_at: BAKERY_DEMO_CREATED_AT,
  };
}

/** This demo intentionally carries no durable memories beyond its one context note. */
export function createBakeryDemoMemories(): DurableMemory[] {
  return [];
}

export function createBakeryDemoProject(): Project {
  const sourceId = BAKERY_LAUNCH_PLANNING_NOTES_ID;
  const nodes = [
    node({ id: 'bakery_goal', type: 'GOAL', text: 'Launch a weekend bakery pop-up, prove repeat demand, and reach positive unit economics without taking on large fixed costs too early', confidence: 1, impact: 1, why_it_matters: ['Defines the outcome for the first three months of the experiment.'] }, sourceId),

    node({ id: 'bakery_location_decision', type: 'DECISION', text: 'Choose the launch location for the weekend bakery pop-up', status: 'OPEN', confidence: 0.8, impact: 1, why_it_matters: ['The location affects permits, equipment, costs, traffic, pricing, and the preferred launch weekend.'] }, sourceId),
    node({ id: 'bakery_products_decision', type: 'DECISION', text: 'Choose the initial bakery product mix', status: 'OPEN', confidence: 0.7, impact: 0.86, why_it_matters: ['The menu must fit two-person production capacity while making the bakery distinctive enough to test demand.'] }, sourceId),
    node({ id: 'bakery_pricing_decision', type: 'DECISION', text: 'Set initial prices for the bakery pop-up', status: 'OPEN', confidence: 0.62, impact: 0.9, why_it_matters: ['Pricing must cover each location and product combination while preserving the target margin.'] }, sourceId),
    node({ id: 'bakery_sales_channel_decision', type: 'DECISION', text: 'Choose whether launch sales should be preorder-first, walk-up-first, or a mix', status: 'OPEN', confidence: 0.68, impact: 0.78, why_it_matters: ['The sales model affects waste, the ordering build, production planning, and the value of each location.'] }, sourceId),
    node({ id: 'bakery_supplier_decision', type: 'DECISION', text: 'Choose the flour and ingredient supplier arrangement for launch', status: 'OPEN', confidence: 0.68, impact: 0.7, why_it_matters: ['Supplier minimums, price differences, and butter volatility can change working capital and margins.'] }, sourceId),
    node({ id: 'bakery_marketing_mix_decision', type: 'DECISION', text: 'Choose the launch marketing mix', status: 'OPEN', confidence: 0.64, impact: 0.65, why_it_matters: ['The marketing mix should match the selected location and stay within the launch budget.'] }, sourceId),
    node({ id: 'bakery_repeat_measurement_decision', type: 'DECISION', text: 'Choose how to measure repeat demand during the first three months', status: 'OPEN', confidence: 0.58, impact: 0.55, why_it_matters: ['A reliable repeat-purchase measure is required to decide whether the bakery can become permanent.'] }, sourceId),

    node({ id: 'bakery_ingredient_cost_unknown', type: 'UNKNOWN', text: 'What are the exact ingredient costs and gross margins for each candidate product?', status: 'OPEN', confidence: 0.84, impact: 0.88, why_it_matters: ['The product and location decisions cannot be compared reliably without unit costs.'] }, sourceId),
    node({ id: 'bakery_premium_price_unknown', type: 'UNKNOWN', text: 'What premium price would customers actually pay for seasonal or specialty pastries?', status: 'OPEN', confidence: 0.78, impact: 0.62 }, sourceId),
    node({ id: 'bakery_repeat_tracking_unknown', type: 'UNKNOWN', text: 'What reliable tracking method will identify whether first-time customers purchase again?', status: 'OPEN', confidence: 0.72, impact: 0.5, why_it_matters: ['The stated 35% repeat-purchase success criterion cannot be evaluated without a tracking method.'] }, sourceId),

    node({ id: 'bakery_saturday_market_facts', type: 'KNOWN', text: 'The Saturday Market costs $900 per month plus 10% of sales, has strong weekend foot traffic, and lacks oven, refrigeration, storage, and prep space', confidence: 0.94, impact: 0.95 }, sourceId),
    node({ id: 'bakery_shared_kitchen_facts', type: 'KNOWN', text: 'The Shared Kitchen costs $2,200 per month with no revenue share, includes production equipment and storage, and requires a three-month minimum lease', confidence: 0.94, impact: 0.95 }, sourceId),
    node({ id: 'bakery_commissary_requirement', type: 'CONSTRAINT', text: 'Using the Saturday Market requires a licensed commissary costing $450 per month, with limited weekend hours and $22 additional oven time', confidence: 0.9, impact: 0.9 }, sourceId),
    node({ id: 'bakery_coffee_shop_facts', type: 'KNOWN', text: 'The neighborhood coffee shop offers weekend space for 18% of sales, has refrigeration and display space, but no production kitchen and capacity for about 60 items per day', confidence: 0.92, impact: 0.9 }, sourceId),
    node({ id: 'bakery_repeat_demand_evidence', type: 'EVIDENCE', text: 'In a survey of 120 nearby people, 78 would probably buy from a weekend bakery at least twice per month, 31 occasionally, and 11 were unlikely to buy', confidence: 0.84, impact: 0.82 }, sourceId),
    node({ id: 'bakery_price_expectation_evidence', type: 'EVIDENCE', text: 'Most respondents expected individual pastries to cost between $6 and $8', confidence: 0.8, impact: 0.7 }, sourceId),
    node({ id: 'bakery_convenience_preference', type: 'PREFERENCE', text: 'Convenience was the most frequently mentioned reason customers would choose one bakery over another', confidence: 0.8, impact: 0.76 }, sourceId),
    node({ id: 'bakery_preorder_preference', type: 'PREFERENCE', text: '52 respondents preferred preordering online for quick pickup', confidence: 0.8, impact: 0.74 }, sourceId),
    node({ id: 'bakery_sourdough_price_evidence', type: 'EVIDENCE', text: 'Customers interested in sourdough generally expected a loaf to cost between $10 and $14', confidence: 0.76, impact: 0.62 }, sourceId),
    node({ id: 'bakery_permit_timing', type: 'KNOWN', text: 'The food permit usually takes four to six weeks after a complete application is submitted', confidence: 0.84, impact: 0.96 }, sourceId),
    node({ id: 'bakery_fixed_cost_constraint', type: 'CONSTRAINT', text: 'Keep fixed operating commitments at or below $2,500 per month until repeat demand is demonstrated', confidence: 0.98, impact: 0.98 }, sourceId),
    node({ id: 'bakery_permit_location_constraint', type: 'CONSTRAINT', text: 'The permit requires the operating address and kitchen arrangement, so the location must be chosen before submission', confidence: 0.98, impact: 0.98 }, sourceId),
    node({ id: 'bakery_pricing_dependency_constraint', type: 'CONSTRAINT', text: 'Final pricing depends on location costs, revenue-share structure, and the initial menu', confidence: 0.95, impact: 0.9 }, sourceId),
    node({ id: 'bakery_two_person_menu_constraint', type: 'CONSTRAINT', text: 'The first menu must remain small enough for two people to produce reliably', confidence: 0.96, impact: 0.86 }, sourceId),
    node({ id: 'bakery_initial_menu_preference', type: 'PREFERENCE', text: 'Consider croissants, chocolate croissants, cookies, sourdough loaves, cinnamon rolls, focaccia, and two rotating seasonal pastries for the first menu', confidence: 0.82, impact: 0.76 }, sourceId),
    node({ id: 'bakery_production_capability', type: 'KNOWN', text: 'One operator is comfortable with bread and cookies but has limited experience producing laminated pastry at scale', confidence: 0.88, impact: 0.82 }, sourceId),
    node({ id: 'bakery_storage_operations', type: 'CONSTRAINT', text: 'Shared Kitchen permits overnight storage, the commissary has limited paid storage, and the coffee shop cannot store inventory overnight', confidence: 0.9, impact: 0.78 }, sourceId),
    node({ id: 'bakery_supplier_alternatives', type: 'KNOWN', text: 'The preferred flour supplier requires a $500 delivery minimum, while a local supplier has no minimum but charges about 18% more', confidence: 0.9, impact: 0.72 }, sourceId),
    node({ id: 'bakery_butter_volatility', type: 'RISK', text: 'Volatile butter prices could materially reduce croissant margins', status: 'OPEN', confidence: 0.8, impact: 0.78 }, sourceId),
    node({ id: 'bakery_marketing_budget', type: 'CONSTRAINT', text: 'Approximately $1,500 is available for launch marketing', confidence: 0.96, impact: 0.68 }, sourceId),
    node({ id: 'bakery_experiment_budget_reserve', type: 'CONSTRAINT', text: 'The full experiment has $12,000 available and must preserve at least $4,000 after launch', confidence: 0.96, impact: 0.92 }, sourceId),
    node({ id: 'bakery_gross_margin_target', type: 'CONSTRAINT', text: 'Average gross margin before labor should remain above 60%', confidence: 0.96, impact: 0.9 }, sourceId),
    node({ id: 'bakery_success_criteria', type: 'KNOWN', text: 'The experiment is promising if at least 35% of first-time customers purchase again by month three and sales cover ingredients, location, packaging, and direct labor', confidence: 0.94, impact: 0.7 }, sourceId),
    node({ id: 'bakery_ordering_page_missing', type: 'RISK', text: 'The online ordering page is not built, so a preorder-first launch would need this flow before marketing begins', status: 'OPEN', confidence: 0.92, impact: 0.8 }, sourceId),

    node({ id: 'bakery_location_delay_risk', type: 'RISK', text: 'Choosing a location too late could make the preferred launch weekend impossible', status: 'OPEN', confidence: 0.9, impact: 1, why_it_matters: ['The preferred launch is seven weeks away while the permit can take four to six weeks.'] }, sourceId),
    node({ id: 'bakery_permit_delay_risk', type: 'RISK', text: 'Using a production kitchen at a different address may delay city inspection', status: 'OPEN', confidence: 0.82, impact: 0.88 }, sourceId),
    node({ id: 'bakery_margin_risk', type: 'RISK', text: 'A broad technically demanding menu or unfavorable revenue share could push unit economics below the target margin', status: 'OPEN', confidence: 0.84, impact: 0.9 }, sourceId),
    node({ id: 'bakery_repeat_tracking_risk', type: 'RISK', text: 'Without reliable repeat-customer tracking, the three-month experiment may not produce a trustworthy business decision', status: 'OPEN', confidence: 0.78, impact: 0.55 }, sourceId),

    node({ id: 'bakery_select_location_action', type: 'NEXT_ACTION', text: 'Record the chosen bakery pop-up location for the permit', status: 'OPEN', confidence: 0.78, impact: 0.62, why_it_matters: ['This action records the most time-sensitive decision and unlocks the permit path.'] }, sourceId),
    node({ id: 'bakery_submit_permit_action', type: 'NEXT_ACTION', text: 'Submit the food permit application after the location and kitchen arrangement are selected', status: 'OPEN', confidence: 0.72, impact: 0.45 }, sourceId),
    node({ id: 'bakery_build_ordering_action', type: 'NEXT_ACTION', text: 'Build the online ordering page for the launch sales channel', status: 'OPEN', confidence: 0.72, impact: 0.4 }, sourceId),
    node({ id: 'bakery_calculate_costs_action', type: 'NEXT_ACTION', text: 'Calculate ingredient costs and gross margin for each candidate product', status: 'OPEN', confidence: 0.72, impact: 0.45 }, sourceId),
    node({ id: 'bakery_define_repeat_tracking_action', type: 'NEXT_ACTION', text: 'Define and test the repeat-customer tracking method', status: 'OPEN', confidence: 0.72, impact: 0.45 }, sourceId),
  ];

  const edge = (id: string, source: string, target: string, type: EdgeType) => ({ id, source, target, type });
  const edges = [
    edge('bakery_edge_location_goal', 'bakery_location_decision', 'bakery_goal', 'supports'),
    edge('bakery_edge_products_goal', 'bakery_products_decision', 'bakery_goal', 'supports'),
    edge('bakery_edge_pricing_goal', 'bakery_pricing_decision', 'bakery_goal', 'supports'),
    edge('bakery_edge_sales_goal', 'bakery_sales_channel_decision', 'bakery_goal', 'supports'),
    edge('bakery_edge_supplier_goal', 'bakery_supplier_decision', 'bakery_goal', 'supports'),
    edge('bakery_edge_marketing_goal', 'bakery_marketing_mix_decision', 'bakery_goal', 'supports'),
    edge('bakery_edge_repeat_goal', 'bakery_repeat_measurement_decision', 'bakery_goal', 'supports'),

    edge('bakery_edge_market_location', 'bakery_saturday_market_facts', 'bakery_location_decision', 'informs'),
    edge('bakery_edge_kitchen_location', 'bakery_shared_kitchen_facts', 'bakery_location_decision', 'informs'),
    edge('bakery_edge_commissary_location', 'bakery_commissary_requirement', 'bakery_location_decision', 'informs'),
    edge('bakery_edge_coffee_location', 'bakery_coffee_shop_facts', 'bakery_location_decision', 'informs'),
    edge('bakery_edge_fixed_location', 'bakery_fixed_cost_constraint', 'bakery_location_decision', 'informs'),
    edge('bakery_edge_permit_location', 'bakery_permit_location_constraint', 'bakery_location_decision', 'informs'),
    edge('bakery_edge_permit_timing_location', 'bakery_permit_timing', 'bakery_location_decision', 'informs'),
    edge('bakery_edge_permit_risk', 'bakery_permit_timing', 'bakery_permit_delay_risk', 'informs'),
    edge('bakery_edge_location_delay', 'bakery_location_delay_risk', 'bakery_location_decision', 'affects'),
    edge('bakery_edge_permit_delay', 'bakery_permit_delay_risk', 'bakery_location_decision', 'affects'),

    edge('bakery_edge_repeat_products', 'bakery_repeat_demand_evidence', 'bakery_products_decision', 'informs'),
    edge('bakery_edge_menu_products', 'bakery_initial_menu_preference', 'bakery_products_decision', 'informs'),
    edge('bakery_edge_capacity_products', 'bakery_two_person_menu_constraint', 'bakery_products_decision', 'informs'),
    edge('bakery_edge_skill_products', 'bakery_production_capability', 'bakery_products_decision', 'informs'),
    edge('bakery_edge_storage_products', 'bakery_storage_operations', 'bakery_products_decision', 'informs'),
    edge('bakery_edge_coffee_products', 'bakery_coffee_shop_facts', 'bakery_products_decision', 'affects'),

    edge('bakery_edge_price_expectation', 'bakery_price_expectation_evidence', 'bakery_pricing_decision', 'informs'),
    edge('bakery_edge_sourdough_price', 'bakery_sourdough_price_evidence', 'bakery_pricing_decision', 'informs'),
    edge('bakery_edge_pricing_dependency', 'bakery_pricing_dependency_constraint', 'bakery_pricing_decision', 'informs'),
    edge('bakery_edge_margin_target', 'bakery_gross_margin_target', 'bakery_pricing_decision', 'informs'),
    edge('bakery_edge_cost_question', 'bakery_ingredient_cost_unknown', 'bakery_pricing_decision', 'informs'),
    edge('bakery_edge_premium_question', 'bakery_premium_price_unknown', 'bakery_pricing_decision', 'informs'),
    edge('bakery_edge_butter_margin', 'bakery_butter_volatility', 'bakery_margin_risk', 'informs'),
    edge('bakery_edge_margin_pricing', 'bakery_margin_risk', 'bakery_pricing_decision', 'affects'),

    edge('bakery_edge_pricing_location', 'bakery_pricing_decision', 'bakery_location_decision', 'depends_on'),

    edge('bakery_edge_convenience_sales', 'bakery_convenience_preference', 'bakery_sales_channel_decision', 'informs'),
    edge('bakery_edge_preorder_sales', 'bakery_preorder_preference', 'bakery_sales_channel_decision', 'informs'),
    edge('bakery_edge_ordering_sales', 'bakery_ordering_page_missing', 'bakery_sales_channel_decision', 'affects'),
    edge('bakery_edge_location_sales', 'bakery_sales_channel_decision', 'bakery_location_decision', 'depends_on'),
    edge('bakery_edge_menu_sales', 'bakery_sales_channel_decision', 'bakery_products_decision', 'depends_on'),

    edge('bakery_edge_supplier_options', 'bakery_supplier_alternatives', 'bakery_supplier_decision', 'informs'),
    edge('bakery_edge_supplier_margin', 'bakery_supplier_decision', 'bakery_pricing_decision', 'informs'),

    edge('bakery_edge_location_marketing', 'bakery_marketing_mix_decision', 'bakery_location_decision', 'depends_on'),
    edge('bakery_edge_sales_marketing', 'bakery_sales_channel_decision', 'bakery_marketing_mix_decision', 'depends_on'),
    edge('bakery_edge_marketing_budget', 'bakery_marketing_budget', 'bakery_marketing_mix_decision', 'informs'),

    edge('bakery_edge_success_repeat', 'bakery_success_criteria', 'bakery_repeat_measurement_decision', 'informs'),
    edge('bakery_edge_tracking_unknown', 'bakery_repeat_tracking_unknown', 'bakery_repeat_measurement_decision', 'informs'),
    edge('bakery_edge_tracking_risk', 'bakery_repeat_tracking_risk', 'bakery_repeat_measurement_decision', 'affects'),

    edge('bakery_edge_budget_location', 'bakery_experiment_budget_reserve', 'bakery_location_decision', 'informs'),
    edge('bakery_edge_budget_supplier', 'bakery_experiment_budget_reserve', 'bakery_supplier_decision', 'informs'),
    edge('bakery_edge_budget_marketing', 'bakery_experiment_budget_reserve', 'bakery_marketing_mix_decision', 'informs'),

    edge('bakery_edge_pricing_products', 'bakery_pricing_decision', 'bakery_products_decision', 'depends_on'),
    edge('bakery_edge_pricing_supplier', 'bakery_pricing_decision', 'bakery_supplier_decision', 'depends_on'),

    edge('bakery_edge_select_location_satisfies', 'bakery_select_location_action', 'bakery_location_decision', 'satisfies'),
    edge('bakery_edge_record_location_depends', 'bakery_select_location_action', 'bakery_location_decision', 'depends_on'),
    edge('bakery_edge_submit_permit', 'bakery_submit_permit_action', 'bakery_location_decision', 'depends_on'),
    edge('bakery_edge_ordering_satisfies', 'bakery_build_ordering_action', 'bakery_sales_channel_decision', 'satisfies'),
    edge('bakery_edge_costs_satisfies', 'bakery_calculate_costs_action', 'bakery_pricing_decision', 'satisfies'),
    edge('bakery_edge_repeat_satisfies', 'bakery_define_repeat_tracking_action', 'bakery_repeat_measurement_decision', 'satisfies'),
  ];

  const project: Project = {
    id: BAKERY_DEMO_ID,
    title: 'Launch a weekend bakery pop-up',
    goal: 'Launch a weekend bakery pop-up within eight weeks, prove repeat demand, and reach positive unit economics without taking on large fixed costs too early.',
    status: 'active',
    clarity_score: 0,
    created_at: BAKERY_DEMO_CREATED_AT,
    updated_at: BAKERY_DEMO_CREATED_AT,
    sources: [{
      id: sourceId,
      filename: 'Bakery Expansion and Launch Planning',
      type: 'note',
      content: BAKERY_LAUNCH_PLANNING_NOTES,
      extracted_at: BAKERY_DEMO_CREATED_AT,
      derived_node_ids: nodes.map((item) => item.id),
      processing_status: 'completed',
      origin: 'user',
      extraction_summary: 'One dense planning note establishes the launch goal, seven open decisions, supporting market and operating context, risks, and actions across location, permits, menu, pricing, sales, suppliers, marketing, and repeat demand.',
    }],
    nodes,
    edges,
    history: [],
    active_question: null,
  };

  project.clarity_score = calculateClarityScore(project);
  return project;
}

export const BAKERY_DEMO_PROJECT = createBakeryDemoProject();
