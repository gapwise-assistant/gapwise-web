import { ClarityNode } from '@/types/clarity';
import { ContextPack, ContextPackInput } from '@/types/contextPack';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { hasGoogleOAuthTokens } from '@/lib/google/oauth';
import { listContextPackCalendarEvents } from '@/lib/google/calendar';
import { loadDurableMemories } from '@/lib/memory/serverStore';
import { isTextRelevantToProject } from '@/lib/scope/projectScope';
import { demoCareerConflictCalendarEvents, demoCalendarEvents, demoKintaGenCalendarEvents } from '@/lib/demo/localFixtures';
import { CAREER_CONFLICT_DEMO_ID } from '@/lib/demo/careerConflict';
import { KINTAGEN_DEMO_ID } from '@/lib/demo/kintagen';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { getStorageProvider } from '@/lib/storage';
import { AskChatMessage, AskResearchEvidence } from '@/types/ask';

export async function buildContextPackForUser(
  input: ContextPackInput,
  deps: {
    hasCalendarTokens?: typeof hasGoogleOAuthTokens;
    listCalendarEvents?: typeof listContextPackCalendarEvents;
    listMemories?: typeof loadDurableMemories;
    listAskMessages?: (userId: string) => Promise<AskChatMessage[]>;
    listAskResearch?: (userId: string) => Promise<AskResearchEvidence[]>;
    now?: Date;
  } = {}
): Promise<ContextPack> {
  const hasTokens = deps.hasCalendarTokens ?? hasGoogleOAuthTokens;
  const listEvents = deps.listCalendarEvents ?? listContextPackCalendarEvents;
  const listMemories = deps.listMemories ?? loadDurableMemories;
  const listAskMessages = deps.listAskMessages ?? ((userId: string) => getStorageProvider().getAskMessages(userId));
  const listAskResearch = deps.listAskResearch ?? ((userId: string) => getStorageProvider().getAskResearch(userId));
  const now = deps.now ?? new Date();
  let calendarCommitments: ClarityNode[] = [];
  let durableMemories = input.durableMemories;

  if (!durableMemories) {
    durableMemories = await listMemories(input.userId, input.profile);
  }

  let conversationMessages = input.conversationMessages;
  let researchEvidence = input.researchEvidence;
  try {
    if (!conversationMessages) conversationMessages = await listAskMessages(input.userId);
    if (!researchEvidence) researchEvidence = await listAskResearch(input.userId);
  } catch {
    conversationMessages ??= [];
    researchEvidence ??= [];
  }
  if (input.scope?.type === 'project') {
    const projectId = input.scope.projectId;
    conversationMessages = conversationMessages.filter((message) => message.projectId === projectId);
    researchEvidence = researchEvidence.filter((research) => research.projectId === projectId);
  }
  if (input.excludeMessageId) {
    conversationMessages = conversationMessages.filter((message) => message.id !== input.excludeMessageId);
  }
  researchEvidence = researchEvidence.filter((research) => research.status !== 'pending');
  if (input.excludeMessageId) {
    researchEvidence = researchEvidence.filter((research) => research.assistantMessageId !== input.excludeMessageId);
  }

  if (input.project.id === CAREER_CONFLICT_DEMO_ID || input.project.id === KINTAGEN_DEMO_ID) {
    const events = input.project.id === KINTAGEN_DEMO_ID ? demoKintaGenCalendarEvents(now) : demoCareerConflictCalendarEvents(now);
    calendarCommitments = calendarEventsToCommitmentNodes(
      events,
      now,
      10
    );
    if (input.scope?.type === 'project') {
      calendarCommitments = calendarCommitments.filter((commitment) =>
        isTextRelevantToProject(commitment.text, input.project)
      );
    }
  } else if (isDemoMode()) {
    const demoEvents = demoCalendarEvents(now);
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

  return buildContextPack({
    ...input,
    durableMemories,
    calendarCommitments,
    conversationMessages,
    researchEvidence,
  });
}
