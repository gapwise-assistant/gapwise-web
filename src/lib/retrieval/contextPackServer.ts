import { ClarityNode } from '@/types/clarity';
import { ContextPack, ContextPackInput } from '@/types/contextPack';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { hasGoogleOAuthTokens } from '@/lib/google/oauth';
import { listContextPackCalendarEvents } from '@/lib/google/calendar';
import { loadDurableMemories } from '@/lib/memory/serverStore';
import { isTextRelevantToProject } from '@/lib/scope/projectScope';
import { demoCareerConflictCalendarEvents, demoCalendarEvents } from '@/lib/demo/localFixtures';
import { CAREER_CONFLICT_DEMO_ID } from '@/lib/demo/careerConflict';
import { isDemoMode } from '@/lib/runtime/demoMode';

export async function buildContextPackForUser(
  input: ContextPackInput,
  deps: {
    hasCalendarTokens?: typeof hasGoogleOAuthTokens;
    listCalendarEvents?: typeof listContextPackCalendarEvents;
    listMemories?: typeof loadDurableMemories;
    now?: Date;
  } = {}
): Promise<ContextPack> {
  const hasTokens = deps.hasCalendarTokens ?? hasGoogleOAuthTokens;
  const listEvents = deps.listCalendarEvents ?? listContextPackCalendarEvents;
  const listMemories = deps.listMemories ?? loadDurableMemories;
  const now = deps.now ?? new Date();
  let calendarCommitments: ClarityNode[] = [];
  let durableMemories = input.durableMemories;

  if (!durableMemories) {
    durableMemories = await listMemories(input.userId, input.profile);
  }

  if (isDemoMode()) {
    const demoEvents = input.project.id === CAREER_CONFLICT_DEMO_ID
      ? demoCareerConflictCalendarEvents(now)
      : demoCalendarEvents(now);
    calendarCommitments = calendarEventsToCommitmentNodes(demoEvents, now, 10);
    if (input.scope?.type === 'project') {
      calendarCommitments = calendarCommitments.filter((commitment) =>
        isTextRelevantToProject(commitment.text, input.project)
      );
    }
  } else try {
    if (await hasTokens(input.userId, 'calendar')) {
      const events = await listEvents(input.userId, now);
      calendarCommitments = calendarEventsToCommitmentNodes(events, now, 10);
      if (input.scope?.type === 'project') {
        calendarCommitments = calendarCommitments.filter((commitment) =>
          isTextRelevantToProject(commitment.text, input.project)
        );
      }
    }
  } catch {
    calendarCommitments = [];
  }

  return buildContextPack({ ...input, durableMemories, calendarCommitments });
}
