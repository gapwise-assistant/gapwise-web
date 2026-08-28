import type { AskResult } from '@/lib/ask/adkClient';

/**
 * These are captured-response cassettes for the deterministic generator E2E.
 * They are intentionally independent of the exported Firestore graph
 * fixtures: the latter describe observed persisted state, while these records
 * describe the external model contracts that the real generators consume.
 *
 * The historical exports do not contain the original raw Gemini payloads, so
 * this file records the same structured response contract with stable,
 * source-grounded responses. Nothing in this module is derived at runtime
 * from a final graph assertion.
 */
export interface GeneratorContextCassette {
  callType: 'context_analysis';
  journey: 'harbor' | 'riverside';
  stepKey: string;
  requestIdentity: { filename: string };
  response: {
    summary: string;
    relevance: 'relevant';
    operations: Array<Record<string, unknown>>;
    relationships: Array<Record<string, unknown>>;
  };
}

export interface GeneratorAskCassette {
  callType: 'ask';
  journey: 'harbor' | 'riverside';
  stepKey: string;
  requestIdentity: { askTurn: string };
  response: AskResult;
}

export interface GeneratorRelationshipRule {
  sourceType: string;
  sourceText: string;
  targetType: string;
  targetText: string;
  relationship: 'satisfies';
  confidence: number;
}

export interface GeneratorRelationshipCassette {
  callType: 'relationship_completion';
  journey: 'harbor' | 'riverside';
  stepKey: 'document' | 'ask_proposal';
  requestIdentity: { filenamePrefix: string };
  response: { classifications: Array<Record<string, unknown>> };
  /**
   * The captured payloads do not include the fresh run's generated pair IDs.
   * These source-grounded mappings bind a captured classification to the
   * runtime pair without deriving a graph from the expected final state.
   */
  relationshipRules?: readonly GeneratorRelationshipRule[];
}

export type GeneratorAiCassette =
  | GeneratorContextCassette
  | GeneratorAskCassette
  | GeneratorRelationshipCassette;

function context(
  journey: GeneratorContextCassette['journey'],
  stepKey: string,
  filename: string,
  summary: string,
  operations: Array<Record<string, unknown>>,
): GeneratorContextCassette {
  return {
    callType: 'context_analysis',
    journey,
    stepKey,
    requestIdentity: { filename },
    response: { summary, relevance: 'relevant', operations, relationships: [] },
  };
}

function add(
  nodeType: string,
  text: string,
  impact = 0.75,
): Record<string, unknown> {
  return { op: 'ADD_CONTEXT', nodeType, text, confidence: 0.94, impact };
}

function action(text: string, impact = 0.8): Record<string, unknown> {
  return { op: 'ADD_ACTION', text, confidence: 0.9, impact };
}

export const GENERATOR_CONTEXT_CASSETTES: readonly GeneratorContextCassette[] = [
  context(
    'harbor',
    'pilot_brief',
    'Harbor Pilot Brief.pdf',
    'The Harbor pilot has a November launch target, a 500-ticket scope, a 12% resolution-time goal, and a $45,000 budget ceiling.',
    [
      add('KNOWN', 'The Harbor customer-support pilot targets a November 1, 2026 launch and 500 support tickets.', 0.9),
      add('KNOWN', 'The pilot target is a 12% reduction in average resolution time.', 0.86),
      add('CONSTRAINT', 'The Harbor pilot budget cannot exceed $45,000.', 0.88),
    ],
  ),
  context(
    'harbor',
    'security_requirements',
    'Harbor Security Requirements.pdf',
    'Harbor requires security approval before procurement, 30-day customer-data deletion, and an annual penetration test; the current report is 14 months old.',
    [
      add('CONSTRAINT', 'Security approval is required before procurement can issue the purchase order.', 0.9),
      add('CONSTRAINT', 'Customer data must be deleted within 30 days after the pilot ends.', 0.92),
      add('CONSTRAINT', 'An annual penetration test must be on record for the pilot.', 0.84),
      add('EVIDENCE', 'The current Harbor penetration-test report is 14 months old.', 0.86),
    ],
  ),
  context(
    'harbor',
    'engineering_review',
    'Engineering Integration Review.pdf',
    'Nightly CSV integration is estimated at two weeks, a custom API at six weeks, deletion support is unconfirmed, and support load is estimated at 20 to 30 hours.',
    [
      add('KNOWN', 'Engineering estimates the nightly CSV integration at two weeks.', 0.86),
      add('KNOWN', 'Engineering estimates the custom API integration at six weeks.', 0.82),
      add('EVIDENCE', 'The estimated support load for the Harbor pilot is 20 to 30 hours.', 0.8),
    ],
  ),
  context(
    'harbor',
    'procurement_update',
    'Harbor Procurement Update.pdf',
    'Final pricing is proposed but unconfirmed, the approver is away until Monday, and missing Friday approval may delay launch.',
    [
      add('EVIDENCE', 'The proposed final Harbor pilot price is $38,500 and is awaiting approval.', 0.86),
      add('CONSTRAINT', 'Procurement cannot issue the purchase order until security approval is recorded.', 0.86),
      add('CONSTRAINT', 'Harbor commercial approval is unavailable until Monday.', 0.76),
      add('RISK', 'Missing Friday approval may delay the November 1 Harbor launch.', 0.82),
    ],
  ),
  context(
    'harbor',
    'final_readiness',
    'Harbor Launch Readiness Report.pdf',
    'The Harbor technical scope, security approval, deletion capability, pricing, procurement, and support ownership are confirmed; the production rehearsal remains incomplete.',
    [
      add('KNOWN', 'The Harbor pilot will use the nightly CSV integration.', 0.9),
      add('EVIDENCE', 'Harbor security approved the refreshed penetration-test report.', 0.92),
      add('EVIDENCE', 'Engineering confirmed that customer data can be deleted within 30 days after the pilot.', 0.92),
      add('EVIDENCE', 'The final Harbor pilot price was approved at $38,500.', 0.9),
      add('KNOWN', 'Procurement issued the Harbor pilot purchase order.', 0.86),
      add('KNOWN', 'Marcus Lee is the Harbor pilot support owner.', 0.72),
    ],
  ),
  context(
    'riverside',
    'pilot_brief',
    'Riverside Pilot Brief.pdf',
    'The Riverside pilot will serve 80 meals each Wednesday for six weeks beginning October 7, with price, service area, menu, and delivery coverage still open.',
    [
      add('KNOWN', 'The Riverside pilot runs for six Wednesdays beginning October 7, 2026 and serves 80 meals each Wednesday.', 0.9),
      add('CONSTRAINT', 'The Riverside pilot requires kitchen access, food-safety compliance, workable pricing, volunteer delivery coverage, and a complete rehearsal.', 0.88),
    ],
  ),
  context(
    'riverside',
    'kitchen_volunteers',
    'Kitchen and Volunteer Update.pdf',
    'The community kitchen is available on Wednesdays, paperwork and insurance are required before cooking, four volunteers are available, and complete route coverage is not confirmed.',
    [
      add('CONSTRAINT', 'The Riverside kitchen manager requires a current insurance certificate before the first cooking shift.', 0.84),
      add('CONSTRAINT', 'An allergen list is required with each Riverside menu.', 0.8),
      add('EVIDENCE', 'Four volunteers are available for most Riverside Wednesdays, but complete route coverage is not confirmed.', 0.86),
      // This mixed result intentionally mirrors the captured failure: the
      // source reports an operational gap as evidence and an action, rather
      // than assuming Gemini will classify it as one particular UNKNOWN.
      action('Develop a backup-driver plan in case volunteers cancel or driver coverage is incomplete.'),
    ],
  ),
  context(
    'riverside',
    'meal_cost_research',
    'Meal Cost and Customer Research.pdf',
    'The estimated meal cost is $9.30 and resident interviews suggest a $12 to $15 price range; price, delivery inclusion, service area, and menu remain unsettled.',
    [
      add('EVIDENCE', 'The estimated Riverside meal cost is $9.30 per meal.', 0.84),
      add('EVIDENCE', 'Riverside residents expect to pay approximately $12 to $15 per meal.', 0.82),
    ],
  ),
  context(
    'riverside',
    'food_safety_delivery',
    'Food Safety and Delivery Review.pdf',
    'The food-service permit is pending, the cooler test held temperature for 75 minutes against a 55-minute route, and backup delivery coverage remains unsettled.',
    [
      add('CONSTRAINT', 'The temporary Riverside food-service permit must be approved before the first service.', 0.88),
      add('EVIDENCE', 'The Riverside cooler test held the target temperature for 75 minutes against a longest planned route of 55 minutes.', 0.82),
      action('Run a complete packing-and-delivery rehearsal before launch.'),
    ],
  ),
  context(
    'riverside',
    'final_readiness',
    'Final Readiness Report.pdf',
    'The Riverside price, service area, menu, kitchen and compliance requirements, and primary and backup delivery coverage are confirmed; the rehearsal is still outstanding.',
    [
      add('EVIDENCE', 'The Riverside meal price was approved at $14 per meal.', 0.9),
      add('KNOWN', 'Riverside North is the selected service area and the rotating menu is confirmed.', 0.82),
      add('EVIDENCE', 'Riverside primary and backup delivery drivers are confirmed for every Wednesday route.', 0.92),
    ],
  ),
];

export const GENERATOR_RELATIONSHIP_CASSETTES: readonly GeneratorRelationshipCassette[] = [
  {
    callType: 'relationship_completion',
    journey: 'harbor',
    stepKey: 'document',
    requestIdentity: { filenamePrefix: 'Harbor' },
    response: { classifications: [] },
  },
  {
    callType: 'relationship_completion',
    journey: 'riverside',
    stepKey: 'document',
    requestIdentity: { filenamePrefix: 'Riverside' },
    response: { classifications: [] },
  },
  {
    callType: 'relationship_completion',
    journey: 'riverside',
    stepKey: 'ask_proposal',
    requestIdentity: { filenamePrefix: 'Ask proposal' },
    response: { classifications: [] },
    relationshipRules: [
      {
        sourceType: 'NEXT_ACTION',
        sourceText: 'Develop a backup-driver plan in case volunteers cancel or driver coverage is incomplete.',
        targetType: 'UNKNOWN',
        targetText: 'Confirm complete volunteer driver coverage for every Wednesday route.',
        relationship: 'satisfies',
        confidence: 0.96,
      },
    ],
  },
  {
    callType: 'relationship_completion',
    journey: 'harbor',
    stepKey: 'ask_proposal',
    requestIdentity: { filenamePrefix: 'Ask proposal' },
    response: { classifications: [] },
  },
];

function ask(
  journey: GeneratorAskCassette['journey'],
  stepKey: string,
  askTurn: string,
  answer: string,
): GeneratorAskCassette {
  return {
    callType: 'ask',
    journey,
    stepKey,
    requestIdentity: { askTurn },
    response: {
      answer,
      outcome: 'exploration',
      sources: [],
      openQuestionIds: [],
      openQuestions: [],
      execution: {
        route: 'internal_context',
        agent: 'Partner Agent',
        toolCalls: ['ADK /run_sse'],
      },
    },
  };
}

export const GENERATOR_ASK_CASSETTES: readonly GeneratorAskCassette[] = [
  ask('harbor', 'planning', 'planning', 'The first Harbor planning priority is to clarify the technical scope and the production-readiness work required before launch.'),
  ask('harbor', 'security-impact', 'security-impact', 'A delay in meeting the deletion requirement would affect security approval and the procurement path.'),
  ask('harbor', 'procurement', 'procurement', 'Before procurement can finish, the project needs the remaining security and commercial approvals.'),
  ask('riverside', 'validation', 'validation', 'The first Riverside validation pass should cover kitchen paperwork, route coverage, and the packing-and-delivery rehearsal.'),
  ask('riverside', 'cancellations', 'cancellations', 'Driver cancellations make a backup coverage plan important for reliable Wednesday routes.'),
  ask('riverside', 'pricing', 'pricing', 'The Riverside price should be considered against the estimated cost and the range residents said they would pay.'),
];

export const GENERATOR_AI_CASSETTES: readonly GeneratorAiCassette[] = [
  ...GENERATOR_CONTEXT_CASSETTES,
  ...GENERATOR_RELATIONSHIP_CASSETTES,
  ...GENERATOR_ASK_CASSETTES,
];

export function contextCassetteFor(filename: string): GeneratorContextCassette | undefined {
  return GENERATOR_CONTEXT_CASSETTES.find((cassette) => cassette.requestIdentity.filename === filename);
}

export function askCassetteFor(turn: string): GeneratorAskCassette | undefined {
  return GENERATOR_ASK_CASSETTES.find((cassette) => cassette.requestIdentity.askTurn === turn);
}
