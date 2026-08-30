import { ClarityNode } from '@/types/clarity';
import { ContextPack, ContextPackInput } from '@/types/contextPack';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { hasGoogleOAuthTokens } from '@/lib/google/oauth';
import { listContextPackCalendarEvents } from '@/lib/google/calendar';
import {
  loadCachedCalendarRelevance,
  loadCachedCalendarRelevanceForProject,
} from '@/lib/google/calendarRelevance';
import { loadDurableMemories } from '@/lib/memory/serverStore';
import { isTextRelevantToProject } from '@/lib/scope/projectScope';
import { demoCareerConflictCalendarEvents, demoCalendarEvents, demoKintaGenCalendarEvents } from '@/lib/demo/localFixtures';
import { CAREER_CONFLICT_DEMO_ID } from '@/lib/demo/careerConflict';
import { KINTAGEN_DEMO_ID } from '@/lib/demo/kintagen';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { getStorageProvider } from '@/lib/storage';
import { AskChatMessage, AskResearchEvidence } from '@/types/ask';
import { scheduleCalendarRelevanceRefresh } from '@/lib/ask/suggestionsScheduler';
import { recordTrace } from '@/lib/observability/trace';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';

export async function buildContextPackForUser(
  input: ContextPackInput,
  deps: {
    hasCalendarTokens?: typeof hasGoogleOAuthTokens;
    listCalendarEvents?: typeof listContextPackCalendarEvents;
    listMemories?: typeof loadDurableMemories;
    listAskMessages?: (userId: string) => Promise<AskChatMessage[]>;
    listAskResearch?: (userId: string) => Promise<AskResearchEvidence[]>;
    loadCalendarRelevance?: typeof loadCachedCalendarRelevance;
    loadCalendarRelevanceForProject?: typeof loadCachedCalendarRelevanceForProject;
    scheduleCalendarRefresh?: typeof scheduleCalendarRelevanceRefresh;
    now?: Date;
  } = {}
): Promise<ContextPack> {
  const hasTokens = deps.hasCalendarTokens ?? hasGoogleOAuthTokens;
  const listEvents = deps.listCalendarEvents ?? listContextPackCalendarEvents;
  const listMemories = deps.listMemories ?? loadDurableMemories;
  const listAskMessages = deps.listAskMessages ?? ((userId: string) => getStorageProvider().getAskMessages(userId));
  const listAskResearch = deps.listAskResearch ?? ((userId: string) => getStorageProvider().getAskResearch(userId));
  const loadCalendarRelevance = deps.loadCalendarRelevance ?? loadCachedCalendarRelevance;
  const loadCalendarRelevanceForProject = deps.loadCalendarRelevanceForProject ?? loadCachedCalendarRelevanceForProject;
  const scheduleCalendarRefresh = deps.scheduleCalendarRefresh ?? scheduleCalendarRelevanceRefresh;
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
    const hasConcreteProject = input.project.id !== '__everything__' && input.project.id !== '__general_context__';
    if (hasConcreteProject && await hasTokens(input.userId, 'calendar')) {
      const cachedRelevance = deps.loadCalendarRelevance
        ? await loadCalendarRelevance({
            userId: input.userId,
            project: input.project,
            events: await listEvents(input.userId, now),
            now,
          })
        : await loadCalendarRelevanceForProject({
            userId: input.userId,
            project: input.project,
            now,
          });
      let refreshScheduled = false;
      if ('stale' in cachedRelevance && cachedRelevance.stale) {
        refreshScheduled = true;
        void scheduleCalendarRefresh({
          userId: input.userId,
          project: input.project,
        });
      }
      calendarCommitments = calendarEventsToCommitmentNodes(cachedRelevance.events, now, 10);
      const relevanceByEventId = new Map(
        cachedRelevance.assessment?.results.map((result) => [result.eventId, result]) ?? [],
      );
      calendarCommitments = calendarCommitments.map((commitment) => {
        const eventId = commitment.source_refs[0]?.replace(/^gcal_/, '');
        const matchedNodeIds = eventId ? relevanceByEventId.get(eventId)?.matchedNodeIds ?? [] : [];
        return matchedNodeIds.length
          ? {
              ...commitment,
              why_it_matters: [
                ...(commitment.why_it_matters ?? []),
                `Relevant project nodes: ${matchedNodeIds.join(', ')}`,
              ],
            }
          : commitment;
      });
      recordTrace({
        userId: input.userId,
        route: '/internal/context-pack',
        label: 'Calendar Context Pack cache read',
        started_at: new Date().toISOString(),
        duration_ms: 0,
        agentNames: [],
        contextIds: cachedRelevance.events.map((event) => event.id),
        scores: [],
        toolCalls: ['loadCachedCalendarRelevanceForProject'],
        calendarContextPack: {
          projectId: input.project.id,
          projectSemanticVersion: semanticProjectVersion(input.project),
          assessmentId: cachedRelevance.assessment?.id ?? null,
          cacheStatus: cachedRelevance.assessment ? 'hit' : 'miss',
          stale: 'stale' in cachedRelevance && typeof cachedRelevance.stale === 'boolean'
            ? cachedRelevance.stale
            : false,
          relevantEventIds: cachedRelevance.events.map((event) => event.id),
          commitmentIds: calendarCommitments.map((commitment) => commitment.id),
          refreshScheduled,
        },
        pipelineSteps: [{
          name: 'Calendar Context Pack cache read',
          summary: cachedRelevance.assessment
            ? `Rebuilt ${calendarCommitments.length} Calendar commitment${calendarCommitments.length === 1 ? '' : 's'} from the saved assessment.`
            : 'No current project-scoped Calendar assessment was available.',
          execution: 'deterministic',
          contextCount: cachedRelevance.events.length,
        }],
      });
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
