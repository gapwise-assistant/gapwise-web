import { GoogleIntegrationState, GoogleWorkspaceSignals } from '@/types/google';
import { retrieveCalendarSignals, retrieveRealCalendarSignals } from '@/lib/google/calendar';
import { retrieveDriveSignals } from '@/lib/google/drive';
import { retrieveGmailSignals } from '@/lib/google/gmail';
import { demoCalendarEvents } from '@/lib/demo/localFixtures';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { calendarEventToSource } from '@/lib/google/sourceMapper';

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

  const calendarResult = calendar?.status === 'connected'
    ? await retrieveRealCalendarSignals(params.userId, calendar)
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
