import type { Project } from '@/types/clarity';
import { GoogleIntegrationState, GoogleWorkspaceSignals } from '@/types/google';
import { calendarSignalToSafeEvent, retrieveCalendarSignals, retrieveRealCalendarSignals } from '@/lib/google/calendar';
import { retrieveDriveSignals } from '@/lib/google/drive';
import { retrieveGmailSignals } from '@/lib/google/gmail';
import { demoCalendarEvents } from '@/lib/demo/localFixtures';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { calendarEventToSource } from '@/lib/google/sourceMapper';
import {
  prefilterCalendarEventsWithDiagnostics,
  refreshCalendarRelevance,
} from '@/lib/google/calendarRelevance';
import type { StorageProvider } from '@/lib/storage/types';
import { appendCalendarSyncStep } from '@/lib/observability/trace';

export function collectWorkspaceSignals(params: {
  integrations: GoogleIntegrationState[];
  query: string;
}): GoogleWorkspaceSignals {
  const calendar = params.integrations.find((integration) => integration.name === 'calendar');
  const gmail = params.integrations.find((integration) => integration.name === 'gmail');
  const drive = params.integrations.find((integration) => integration.name === 'drive');

  const calendarResult = calendar?.status === 'connected'
    ? retrieveCalendarSignals(calendar)
    : { events: [], sources: [] };
  const gmailResult = gmail?.status === 'connected'
    ? retrieveGmailSignals(gmail, params.query)
    : { messages: [], sources: [] };
  const driveResult = drive?.status === 'connected'
    ? retrieveDriveSignals(drive)
    : { files: [], sources: [] };

  return {
    calendarEvents: calendarResult.events,
    gmailMessages: gmailResult.messages,
    driveFiles: driveResult.files,
    derivedSources: [...calendarResult.sources, ...gmailResult.sources, ...driveResult.sources],
  };
}

export async function collectWorkspaceSignalsForUser(params: {
  userId: string;
  integrations: GoogleIntegrationState[];
  query: string;
  project?: Project;
  storage?: StorageProvider;
  now?: Date;
  forceCalendarRefresh?: boolean;
  calendarSyncRunId?: string;
}): Promise<GoogleWorkspaceSignals> {
  if (isDemoMode()) {
    const events = demoCalendarEvents().map((event) => ({
      id: event.id,
      title: event.summary,
      start: event.start ?? '',
      end: event.end ?? event.start ?? '',
      description: event.description,
      location: event.location,
    }));
    return {
      calendarEvents: events,
      gmailMessages: [],
      driveFiles: [],
      derivedSources: events.map(calendarEventToSource),
      ...(params.calendarSyncRunId ? { calendarSyncRunId: params.calendarSyncRunId } : {}),
    };
  }
  const calendar = params.integrations.find((integration) => integration.name === 'calendar');
  const gmail = params.integrations.find((integration) => integration.name === 'gmail');
  const drive = params.integrations.find((integration) => integration.name === 'drive');

  const hasConcreteProject = Boolean(
    params.project
      && params.project.id !== '__everything__'
      && params.project.id !== '__general_context__',
  );
  const calendarRetrievalStarted = Date.now();
  let calendarResult: Awaited<ReturnType<typeof retrieveRealCalendarSignals>> | { events: never[]; sources: never[]; diagnostics?: undefined };
  try {
    calendarResult = calendar?.status === 'connected' && hasConcreteProject
      ? await retrieveRealCalendarSignals(params.userId, calendar, params.now ?? new Date())
      : { events: [], sources: [] };
    if (params.calendarSyncRunId) {
      appendCalendarSyncStep(params.calendarSyncRunId, {
        name: 'Google Calendar retrieval',
        status: 'completed',
        startedAt: new Date(calendarRetrievalStarted).toISOString(),
        durationMs: Date.now() - calendarRetrievalStarted,
        details: calendarResult.diagnostics
          ? { ...calendarResult.diagnostics }
          : { connected: false, calendarId: null, rawResultCount: 0, eventIds: [] },
      });
    }
  } catch (error) {
    if (params.calendarSyncRunId) {
      appendCalendarSyncStep(params.calendarSyncRunId, {
        name: 'Google Calendar retrieval',
        status: 'failed',
        startedAt: new Date(calendarRetrievalStarted).toISOString(),
        durationMs: Date.now() - calendarRetrievalStarted,
        details: { calendarId: 'primary' },
        error: error instanceof Error ? error.message : 'Google Calendar retrieval failed.',
      });
    }
    throw error;
  }
  const gmailResult = gmail?.status === 'connected'
    ? retrieveGmailSignals(gmail, params.query)
    : { messages: [], sources: [] };
  const driveResult = drive?.status === 'connected'
    ? retrieveDriveSignals(drive)
    : { files: [], sources: [] };

  let calendarEvents = calendarResult.events;
  let calendarSources = calendarResult.sources;
  if (params.project && hasConcreteProject) {
    const prefilterStarted = Date.now();
    const prefilter = prefilterCalendarEventsWithDiagnostics(
      calendarEvents.map(calendarSignalToSafeEvent),
      params.now,
    );
    if (params.calendarSyncRunId) {
      appendCalendarSyncStep(params.calendarSyncRunId, {
        name: 'Deterministic Calendar prefilter',
        status: 'completed',
        startedAt: new Date(prefilterStarted).toISOString(),
        durationMs: Date.now() - prefilterStarted,
        details: {
          inputCount: calendarEvents.length,
          outputCount: prefilter.events.length,
          candidates: prefilter.diagnostics,
        },
      });
    }
    const relevance = await refreshCalendarRelevance({
      userId: params.userId,
      project: params.project,
      events: calendarEvents.map(calendarSignalToSafeEvent),
      storage: params.storage,
      now: params.now,
      force: params.forceCalendarRefresh,
      calendarSyncRunId: params.calendarSyncRunId,
    });
    const relevantEventIds = new Set(relevance.events.map((event) => event.id));
    const normalizedById = new Map(relevance.events.map((event) => [event.id, event]));
    calendarEvents = calendarEvents
      .filter((event) => relevantEventIds.has(event.id))
      .map((event) => {
        const normalized = normalizedById.get(event.id);
        return normalized
          ? {
              ...event,
              title: normalized.summary,
              description: normalized.description,
              start: normalized.start ?? event.start,
              end: normalized.end ?? event.end,
              location: normalized.location,
            }
          : event;
      });
    calendarSources = calendarEvents.map(calendarEventToSource);
  }

  return {
    calendarEvents,
    gmailMessages: gmailResult.messages,
    driveFiles: driveResult.files,
    derivedSources: [...calendarSources, ...gmailResult.sources, ...driveResult.sources],
    ...(params.calendarSyncRunId ? { calendarSyncRunId: params.calendarSyncRunId } : {}),
  };
}
