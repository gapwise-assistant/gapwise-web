import type { Project } from '@/types/clarity';

export const BAKERY_JOURNEY_CREATED_AT = '2026-08-23T11:00:00.000Z';
export const BAKERY_JOURNEY_DEMO_ID = `project_launch-a-weekend-bakery-pop-up_${Date.parse(BAKERY_JOURNEY_CREATED_AT)}`;
export const BAKERY_JOURNEY_LOCATION_DECISION = 'Use the Shared Kitchen storefront for the first three-month experiment.';

export interface BakeryJourneySource {
  id: string;
  filename: string;
  content: string;
}

export const BAKERY_JOURNEY_SOURCES: BakeryJourneySource[] = [
  {
    id: 'bakery_journey_initial_plan',
    filename: 'Initial bakery launch plan',
    content: `I want to launch a small weekend bakery pop-up within about two months.

I am deciding between three possible locations.

The Saturday Market costs $900 per month plus 10% of sales. It has strong weekend foot traffic, but the stall has no production kitchen, refrigeration, or storage.

The Shared Kitchen storefront costs $2,200 per month with no revenue share. It includes ovens, refrigeration, prep space, and storage, but requires a three-month commitment.

A neighborhood coffee shop has offered to host the bakery on weekends for 18% of sales. It has refrigeration and display space but no production kitchen and room for only about 60 bakery items per day.

I do not want fixed operating commitments above $2,500 per month until I know there is repeat demand.

The food permit requires the operating address and kitchen arrangement, so I need to choose the location before I can submit the permit application.

The permit normally takes four to six weeks.

I still need to decide the launch location, initial menu, and product pricing.

I cannot confidently determine final prices until I know the location costs and initial menu.

My biggest concern right now is choosing the location too late and missing the intended launch window.`,
  },
  {
    id: 'bakery_journey_customer_research',
    filename: 'Customer survey results',
    content: `I surveyed 120 people who live or work near the potential bakery locations.

78 said they would probably buy from a weekend bakery at least twice per month.

31 said they would probably visit occasionally.

11 said they were unlikely to buy.

Convenience was the most common reason people said they would choose one bakery over another.

52 respondents preferred being able to preorder online and pick up quickly.

Most respondents expected individual pastries to cost between $6 and $8.

People interested in sourdough generally expected a loaf to cost between $10 and $14.

Several respondents said they would pay more for seasonal or specialty pastries, but I have not tested a specific premium price.

This makes me more confident that there is demand, but I still have not decided which location gives the best balance between convenience, production capability, and cost.`,
  },
  {
    id: 'bakery_journey_operations_research',
    filename: 'Operations and supplier research',
    content: `I looked more closely at production and supplier constraints.

Two people will run production and sales initially.

One person is comfortable with bread, cookies, and focaccia but has limited experience producing laminated pastry at scale.

If we launch with several croissant-style products, we may need additional training or part-time production help.

The Shared Kitchen allows overnight storage.

The commissary kitchen near the Saturday Market charges $450 per month for basic access, has limited weekend oven availability, and charges $22 per additional oven hour.

The coffee shop cannot store bakery inventory overnight.

My preferred flour supplier has good pricing but requires a $500 minimum order.

A smaller supplier has no minimum order but charges around 18% more.

Butter prices have also been volatile, which could materially affect croissant margins.

For the initial menu I am considering croissants, cookies, sourdough loaves, focaccia, cinnamon rolls, and two rotating seasonal pastries.

I want the first menu to remain small enough that two people can produce it reliably.

I still think the location needs to be settled before I finalize the menu, pricing, supplier setup, and marketing plan.`,
  },
];

export function bakeryJourneyProjectInput(): { name: string; goal: string } {
  return {
    name: 'Launch a weekend bakery pop-up',
    goal: 'Launch a profitable weekend bakery pop-up within the next two months, validate repeat demand, and avoid taking on large fixed costs before the concept is proven.',
  };
}

export function findBakeryLocationDecision(project: Project): Project['nodes'][number] | undefined {
  return project.nodes
    .filter((node) => node.type === 'DECISION' && node.status === 'OPEN')
    .find((node) => /location|venue|where/i.test(node.text));
}
