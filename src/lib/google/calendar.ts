import { CalendarEventSignal, GoogleIntegrationState, SafeCalendarEvent } from '@/types/google';
import { assertCanRead } from '@/lib/google/auth';
import { getAuthorizedCalendarClient } from '@/lib/google/oauth';
import { calendarEventToSource } from '@/lib/google/sourceMapper';
import { calendar_v3 } from 'googleapis';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

const CONTEXT_PACK_CALENDAR_HORIZON_DAYS = 30;
const CONTEXT_PACK_ALLOWED_EVENT_TYPES = new Set(['default', 'fromGmail', 'focusTime', 'outOfOffice']);
const CONTEXT_PACK_EXCLUDED_EVENT_TYPES = new Set(['birthday', 'workingLocation']);

export function getDemoCalendarEvents(now = new Date('2026-08-10T10:00:00Z')): CalendarEventSignal[] {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return [
    {
      id: 'demo_meeting_1',
      title: 'Gapswise demo planning meeting',
      start: tomorrow.toISOString(),
      end: new Date(tomorrow.getTime() + 45 * 60 * 1000).toISOString(),
      description: 'Prepare target persona, pricing assumption, and 4-minute demo story.',
      sourceUrl: 'https://calendar.google.com/calendar/u/0/r/eventedit/demo_meeting_1',
    },
  ];
}

export function retrieveCalendarSignals(state: GoogleIntegrationState, now?: Date) {
  assertCanRead(state);
  const events = getDemoCalendarEvents(now);
  return {
    events,
    sources: events.map(calendarEventToSource),
  };
}

export async function retrieveRealCalendarSignals(
  userId: string,
  state: GoogleIntegrationState,
  now = new Date(),
  calendarClient?: calendar_v3.Calendar
) {
  assertExternalServicesAllowed('Google Calendar API');
  assertCanRead(state);
  const calendar = calendarClient ?? (await getAuthorizedCalendarClient(userId));
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  });
  const events: CalendarEventSignal[] = (response.data.items ?? []).map((event) => ({
    id: event.id ?? `calendar_${event.htmlLink ?? event.summary ?? Math.random()}`,
    title: event.summary ?? 'Untitled calendar event',
    start: event.start?.dateTime ?? event.start?.date ?? now.toISOString(),
    end: event.end?.dateTime ?? event.end?.date ?? event.start?.dateTime ?? event.start?.date ?? now.toISOString(),
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    sourceUrl: event.htmlLink ?? undefined,
  }));

  return {
    events,
    sources: events.map(calendarEventToSource),
  };
}

function eventTime(value: calendar_v3.Schema$EventDateTime | undefined): string | undefined {
  return value?.dateTime ?? value?.date ?? undefined;
}

export function toSafeCalendarEvent(event: calendar_v3.Schema$Event): SafeCalendarEvent {
  return {
    id: event.id ?? '',
    summary: event.summary ?? '',
    description: event.description ?? undefined,
    start: eventTime(event.start),
    end: eventTime(event.end),
    location: event.location ?? undefined,
  };
}

export async function listUpcomingCalendarEvents(
  userId: string,
  now = new Date(),
  calendarClient?: calendar_v3.Calendar
): Promise<SafeCalendarEvent[]> {
  assertExternalServicesAllowed('Google Calendar API');
  const calendar = calendarClient ?? (await getAuthorizedCalendarClient(userId));
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (response.data.items ?? []).map(toSafeCalendarEvent);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isBirthdayEvent(event: calendar_v3.Schema$Event): boolean {
  const type = event.eventType ?? 'default';
  const text = `${event.summary ?? ''} ${event.description ?? ''}`.toLowerCase();
  return type === 'birthday' || /\bbirthdays?\b/.test(text) || /happy birthday/i.test(event.summary ?? '');
}

function isContextPackCalendarEvent(event: calendar_v3.Schema$Event): boolean {
  const type = event.eventType ?? 'default';
  if (CONTEXT_PACK_EXCLUDED_EVENT_TYPES.has(type)) return false;
  if (!CONTEXT_PACK_ALLOWED_EVENT_TYPES.has(type)) return false;
  return !isBirthdayEvent(event);
}

function isWithinContextPackHorizon(event: calendar_v3.Schema$Event, now: Date, max: Date): boolean {
  const start = eventTime(event.start);
  const end = eventTime(event.end) ?? start;
  if (!start || !end) return true;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > now.getTime() && startTime <= max.getTime();
}

function logContextPackCalendarFiltering(
  rawEvents: calendar_v3.Schema$Event[],
  filteredEvents: calendar_v3.Schema$Event[]
): void {
  if (process.env.NODE_ENV !== 'development') return;

  console.info('[Gapswise Calendar Context Pack]', {
    rawEventCount: rawEvents.length,
    filteredEventCount: filteredEvents.length,
    events: rawEvents.map((event) => ({
      title: event.summary ?? '',
      type: event.eventType ?? 'default',
    })),
  });
}

export async function listContextPackCalendarEvents(
  userId: string,
  now = new Date(),
  calendarClient?: calendar_v3.Calendar
): Promise<SafeCalendarEvent[]> {
  assertExternalServicesAllowed('Google Calendar API');
  const calendar = calendarClient ?? (await getAuthorizedCalendarClient(userId));
  const timeMax = addDays(now, CONTEXT_PACK_CALENDAR_HORIZON_DAYS);
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: 50,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const rawEvents = response.data.items ?? [];
  const filteredEvents = rawEvents
    .filter((event) => isWithinContextPackHorizon(event, now, timeMax))
    .filter(isContextPackCalendarEvent)
    .slice(0, 10);

  logContextPackCalendarFiltering(rawEvents, filteredEvents);
  return filteredEvents.map(toSafeCalendarEvent);
}
