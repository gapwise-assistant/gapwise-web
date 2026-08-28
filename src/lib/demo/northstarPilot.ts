import type { Project } from '@/types/clarity';
import { anchorProjectDecision } from '@/lib/decisions/anchoring';
import { applyProjectPatch } from '@/lib/context/canonicalChanges';

export const NORTHSTAR_PILOT_DEMO_NAME = 'Northstar pilot';
export const NORTHSTAR_PILOT_CREATED_AT = '2026-08-24T09:00:00.000Z';
export const NORTHSTAR_PILOT_DEMO_ID = `project_launch-the-northstar-logistics-pilot_${Date.parse(NORTHSTAR_PILOT_CREATED_AT)}`;
export const NORTHSTAR_PILOT_CHAT_ID = 'northstar_pilot_discovery_chat';
export const NORTHSTAR_PILOT_RESOLVED_SCOPE = 'Use scheduled CSV imports and named user accounts for the eight-week pilot; defer the full API integration and SSO until after the pilot succeeds.';
export const NORTHSTAR_PILOT_TECHNICAL_DECISION = 'Choose the technical scope for the Northstar Logistics pilot';
export const NORTHSTAR_PILOT_PRICING_DECISION = 'Settle the pricing for the Northstar Logistics pilot';
export const NORTHSTAR_PILOT_SECURITY_QUESTION = 'Will Northstar accept the 14-month-old penetration-test summary under its 12-month security policy?';

export interface NorthstarPilotConversation {
  user: string;
  assistant: string;
  createdAt: string;
}

export const NORTHSTAR_PILOT_CONVERSATIONS: NorthstarPilotConversation[] = [
  {
    createdAt: '2026-08-24T09:01:00.000Z',
    user: `Northstar Logistics wants to run a paid eight-week pilot of our dispatch optimization product across three warehouses.

They want to start in about six weeks.

Their maximum pilot budget is $45,000.

Originally they asked for an API integration with their warehouse system and SSO for employees.

Their security review normally takes three to five weeks, and procurement will not issue the purchase order until security approves us.

For the pilot to be worthwhile, I want to show at least a 15% reduction in dispatch delays.

Internally, I also want the pilot to maintain at least a 40% gross margin and I don't want engineering to build major customer-specific functionality that we cannot reuse.

I still need to settle the technical scope and pricing.

What should I be thinking about first?`,
    assistant: `The biggest issue is probably not pricing yet.

The six-week target is close to the normal security-review duration, while the requested API and SSO could also consume engineering time.

I would first clarify which technical requirements are actually necessary for the pilot and what must happen before Northstar can start procurement. That will tell us whether the launch date is realistic before we optimize the commercial terms.`,
  },
  {
    createdAt: '2026-08-24T09:02:00.000Z',
    user: `I spoke with our CTO.

For the pilot, we can support a scheduled CSV import instead of building the full API.

A CSV-based pilot would probably require about 80 to 120 engineering hours.

The full API integration would likely take four to six weeks by itself.

Northstar also said they may be willing to waive SSO during the pilot if we use named user accounts instead.

We only have one engineer who can spend significant time on the pilot during the next three weeks.

If the pilot succeeds, we could build the reusable API integration afterward.`,
    assistant: `That changes the shape of the project considerably.

CSV import plus named accounts could remove two large technical items from the launch critical path, while keeping the reusable API work for after the pilot proves value.

The important next question is whether Northstar formally accepts that reduced technical scope for the pilot.`,
  },
  {
    createdAt: '2026-08-24T09:03:00.000Z',
    user: `Northstar confirmed that scheduled CSV imports and named user accounts are acceptable for the eight-week pilot.

Let's use that approach for phase one and leave the full API and SSO integration until after the pilot if it succeeds.`,
    assistant: `That removes the full API and SSO work from the pilot's immediate path.

The remaining launch risk now looks more concentrated around security approval and procurement, while pricing can be based on the much narrower implementation scope.`,
  },
  {
    createdAt: '2026-08-24T09:04:00.000Z',
    user: `I now have the exact security requirements.

Northstar needs our DPA, subprocessor list, architecture diagram, and penetration-test summary.

The DPA, subprocessor list, and architecture diagram are ready.

Our latest penetration-test summary is 14 months old.

Northstar's normal security policy says the penetration test should be no more than 12 months old, but our account executive thinks they sometimes allow exceptions for limited pilots.

We do not know whether they will accept our 14-month-old report.

Their security approver goes on vacation next Monday.

If we cannot submit the complete security package by this Friday, the review will probably slip by about two weeks.

Procurement cannot issue the purchase order until security approves us, and without the purchase order we cannot formally start the pilot.

The six-week target is still important.`,
    assistant: `That removes the full API and SSO work from the pilot's immediate path.

The remaining launch risk now looks more concentrated around security approval and procurement, while pricing can be based on the much narrower implementation scope.`,
  },
  {
    createdAt: '2026-08-24T09:05:00.000Z',
    user: `Pricing is also still unresolved.

Northstar's budget ceiling is $45,000.

Finance wants at least a 40% gross margin.

Engineering currently estimates the CSV pilot will take somewhere between 80 and 120 engineering hours, plus about 20 to 30 hours of support during the pilot.

I have not chosen the final pilot price yet.

I could spend today refining the price and proposal, but I am unsure whether that is more important than the security issue.`,
    assistant: `Pricing is important, but I would not treat the two issues as equivalent.

The security exception appears to sit upstream of the purchase order and therefore the pilot start itself. Pricing can still be refined once the pilot scope is known, but a missed security submission window could consume two weeks of a six-week launch schedule.

I would resolve whether Northstar will accept the existing penetration-test report before spending significant time optimizing the final price.`,
  },
];

export function northstarPilotProjectInput(): { name: string; goal: string } {
  return {
    name: 'Launch the Northstar Logistics pilot',
    goal: 'Start a paid eight-week pilot with Northstar Logistics on time, prove that the product reduces dispatch delays, maintain healthy pilot economics, and avoid custom engineering that will not be reusable.',
  };
}

/** Finds the replay's technical-scope decision regardless of lifecycle state. */
export function findNorthstarTechnicalScopeDecision(project: Project): Project['nodes'][number] | undefined {
  return project.nodes
    .filter((node) => node.type === 'DECISION' && /technical|scope|api|sso|integration/i.test(node.text))
    .sort((left, right) => Number(right.status === 'OPEN') - Number(left.status === 'OPEN'))[0];
}

export function findNorthstarPricingDecision(project: Project): Project['nodes'][number] | undefined {
  return project.nodes
    .filter((node) => node.type === 'DECISION' && /pric|commercial|pilot fee/i.test(node.text))
    .sort((left, right) => {
      const leftDedicated = !/technical|scope|api|sso|integration/i.test(left.text);
      const rightDedicated = !/technical|scope|api|sso|integration/i.test(right.text);
      return Number(rightDedicated) - Number(leftDedicated)
        || Number(right.status === 'OPEN') - Number(left.status === 'OPEN');
    })[0];
}

/**
 * The replay has two user-stated decisions that are required by its scripted
 * workflow. Anchor them through the normal explicit-decision path so model
 * omission cannot terminate the replay before the later sources execute.
 */
export function ensureNorthstarReplayDecisions(project: Project, sourceId: string): Project {
  const technical = findNorthstarTechnicalScopeDecision(project);
  let updated = anchorProjectDecision(
    project,
    technical?.text ?? NORTHSTAR_PILOT_TECHNICAL_DECISION,
  );
  const anchoredTechnical = findNorthstarTechnicalScopeDecision(updated);
  const pricing = updated.nodes
    .filter((node) =>
      node.type === 'DECISION'
      && node.id !== anchoredTechnical?.id
      && /pric|commercial|pilot fee/i.test(node.text)
    )
    .sort((left, right) => Number(right.status === 'OPEN') - Number(left.status === 'OPEN'))[0];
  updated = anchorProjectDecision(
    updated,
    pricing?.text ?? NORTHSTAR_PILOT_PRICING_DECISION,
  );

  [findNorthstarTechnicalScopeDecision(updated), findNorthstarPricingDecision(updated)]
    .filter((node): node is Project['nodes'][number] => Boolean(node))
    .forEach((node) => {
      node.source_refs = Array.from(new Set([...node.source_refs, sourceId]));
    });
  return updated;
}

export function findNorthstarSecurityAcceptanceGap(project: Project): Project['nodes'][number] | undefined {
  return project.nodes
    .filter((node) => (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && node.status === 'OPEN')
    .find((node) => /penetration|security|report|accept/i.test(node.text));
}

export function ensureNorthstarSecurityAcceptanceGap(project: Project, sourceId: string): Project {
  if (findNorthstarSecurityAcceptanceGap(project)) return project;
  return applyProjectPatch(project, {
    operations: [{
      op: 'OPEN_UNKNOWN',
      operationRef: 'northstar-security-acceptance',
      text: NORTHSTAR_PILOT_SECURITY_QUESTION,
      confidence: 0.95,
      impact: 0.98,
    }],
  }, sourceId).project;
}
