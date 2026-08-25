import type { Project } from '@/types/clarity';
import { createProjectFromInput } from '@/lib/projects/createProject';

export const HARBOR_HOTELS_TITLE = 'Launch the Harbor Hotels pilot';
export const HARBOR_HOTELS_GOAL =
  'Launch a paid eight-week energy-optimization pilot with Harbor Hotels across five properties by November 1, demonstrate at least a 12% reduction in energy cost, maintain at least a 40% gross margin, and avoid customer-specific engineering.';
export const HARBOR_HOTELS_DEADLINE = '2026-11-01';

export type HarborHotelsCheckpoint = 'early' | 'middle' | 'late';

export interface HarborHotelsSource {
  id: string;
  filename: string;
  content: string;
}

export const HARBOR_HOTELS_SOURCES: HarborHotelsSource[] = [
  {
    id: 'harbor_hotels_message_1',
    filename: 'Harbor Hotels message 1 — pilot brief',
    content: `Harbor Hotels wants to run a paid eight-week pilot of our energy-optimization product across five properties starting November 1. Their maximum pilot budget is $50,000. We want the pilot to demonstrate at least a 12% reduction in energy cost, maintain at least a 40% gross margin, and avoid building customer-specific engineering.`,
  },
  {
    id: 'harbor_hotels_message_2',
    filename: 'Harbor Hotels message 2 — technical scope',
    content: `Harbor originally requested a real-time integration with its building-management system, but we could also operate from nightly CSV exports. We have not chosen the technical scope yet.`,
  },
  {
    id: 'harbor_hotels_message_3',
    filename: 'Harbor Hotels message 3 — engineering estimate',
    content: `Engineering estimates the nightly CSV approach at 70 to 90 engineering hours. A real-time integration would take four to six weeks and most of that connector would be specific to Harbor. Harbor says nightly CSV exports are acceptable for the pilot.`,
  },
  {
    id: 'harbor_hotels_message_4',
    filename: 'Harbor Hotels message 4 — scope decision',
    content: `We decided to use nightly CSV exports for the pilot and defer the real-time building-management integration until after the pilot succeeds.`,
  },
  {
    id: 'harbor_hotels_message_5',
    filename: 'Harbor Hotels message 5 — security and procurement',
    content: `Harbor requires security approval before procurement can issue the purchase order. Their security review normally takes about three weeks. Our security package is ready except for the data-retention questionnaire. We still need confirmation from engineering on whether Harbor's customer data can be deleted within 30 days after the pilot.`,
  },
  {
    id: 'harbor_hotels_message_6',
    filename: 'Harbor Hotels message 6 — retention confirmation',
    content: `Engineering confirmed that Harbor's pilot data can be automatically deleted within 30 days after the pilot. The data-retention questionnaire can now be completed.`,
  },
  {
    id: 'harbor_hotels_message_7',
    filename: 'Harbor Hotels message 7 — support and pricing',
    content: `Finance estimates 25 to 35 support hours during the pilot. At the current proposed price of $42,000, we would be close to our 40% gross margin floor if support reaches the high end. We have not finalized pricing yet.`,
  },
  {
    id: 'harbor_hotels_message_8',
    filename: 'Harbor Hotels message 8 — weekend support',
    content: `Harbor says $42,000 is acceptable, but they want weekend support included at no additional charge. We have not decided whether to include weekend support.`,
  },
];

export const HARBOR_HOTELS_ASKS = {
  retentionRisk:
    'If engineering cannot support the 30-day deletion requirement, could that put the November 1 launch at risk?',
  dataReliabilityRisk:
    'If CSV files from one of the five hotels consistently arrive a day late, could that undermine the credibility of the pilot results enough to track?',
  weekendSupportTradeoff:
    'If we include weekend support, what parts of the current plan become most vulnerable, and which decision should we make first?',
} as const;

export const HARBOR_HOTELS_CHAT_ID = 'harbor_hotels_mvp_evaluation_chat';

export function harborHotelsProjectInput(): { name: string; goal: string; deadline: string } {
  return {
    name: HARBOR_HOTELS_TITLE,
    goal: HARBOR_HOTELS_GOAL,
    deadline: HARBOR_HOTELS_DEADLINE,
  };
}

export function createHarborHotelsProject(checkpoint: HarborHotelsCheckpoint): Project {
  const createdAt = '2026-08-24T12:00:00.000Z';
  const projectId = `harbor-hotels-${checkpoint}`;
  const project = createProjectFromInput(harborHotelsProjectInput(), createdAt);
  const goalNodeId = `goal_${projectId}`;

  return {
    ...project,
    id: projectId,
    nodes: project.nodes.map((node) => ({
      ...node,
      id: goalNodeId,
    })),
  };
}

export function sourcesForHarborCheckpoint(checkpoint: HarborHotelsCheckpoint): HarborHotelsSource[] {
  const count = checkpoint === 'early' ? 3 : checkpoint === 'middle' ? 5 : HARBOR_HOTELS_SOURCES.length;
  return HARBOR_HOTELS_SOURCES.slice(0, count);
}
