import type { Project } from '@/types/clarity';
import { GoogleIntegrationState, GoogleWorkspaceSignals } from '@/types/google';
import { calendarSignalToSafeEvent, retrieveCalendarSignals, retrieveRealCalendarSignals } from '@/lib/google/calendar';
import { retrieveDriveSignals } from '@/lib/google/drive';
import { retrieveGmailSignals } from '@/lib/google/gmail';
import { demoCalendarEvents } from '@/lib/demo/localFixtures';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { calendarEventToSource } from '@/lib/google/sourceMapper';
import { refreshCalendarRelevance } from '@/lib/google/calendarRelevance';
import type { StorageProvider } from '@/lib/storage/types';

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
  const calendarResult = calendar?.status === 'connected' && hasConcreteProject
    ? await retrieveRealCalendarSignals(params.userId, calendar, params.now ?? new Date())
    : { events: [], sources: [] };
  const gmailResult = gmail?.status === 'connected'
    ? retrieveGmailSignals(gmail, params.query)
    : { messages: [], sources: [] };
  const driveResult = drive?.status === 'connected'
    ? retrieveDriveSignals(drive)
    : { files: [], sources: [] };

  let calendarEvents = calendarResult.events;
  let calendarSources = calendarResult.sources;
  if (params.project && hasConcreteProject) {
    const relevance = await refreshCalendarRelevance({
      userId: params.userId,
      project: params.project,
      events: calendarEvents.map(calendarSignalToSafeEvent),
      storage: params.storage,
      now: params.now,
      force: params.forceCalendarRefresh,
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
  };
}
