import { describe, expect, it, vi } from 'vitest';
import { createDemoConnectedState, createDisconnectedState } from '@/lib/google/auth';
import { listContextPackCalendarEvents, retrieveCalendarSignals, retrieveRealCalendarSignals } from '@/lib/google/calendar';
import { retrieveDriveSignals } from '@/lib/google/drive';
import { retrieveGmailSignals } from '@/lib/google/gmail';
import { collectWorkspaceSignals } from '@/lib/google/workspace';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { generateDailyBrief } from '@/lib/attention/generateBrief';
import { getConfiguredGeminiModel, isEligibleGeminiModel } from '@/lib/google/genai';

describe('Google Workspace awareness', () => {
  it('uses an explicit low-cost Gemini model by default', () => {
    vi.stubEnv('GEMINI_MODEL', '');
    expect(getConfiguredGeminiModel()).toBe('gemini-3.5-flash-lite');

    vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-explicit-model');
    expect(getConfiguredGeminiModel()).toBe('gemini-3.5-explicit-model');
    vi.unstubAllEnvs();
  });

  it('rejects legacy Gemini selections for live paths', () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash-lite');
    expect(() => getConfiguredGeminiModel()).toThrow(/Gemini 3\.5 or newer/);
    expect(isEligibleGeminiModel('gemini-3.5-flash-lite')).toBe(true);
    expect(isEligibleGeminiModel('gemini-3.1-flash-lite')).toBe(false);
    vi.unstubAllEnvs();
  });

  it('handles permission denied and token expired states clearly', () => {
    expect(() =>
      retrieveGmailSignals(
        {
          ...createDemoConnectedState('gmail'),
          status: 'permission_denied',
        },
        'recruiter'
      )
    ).toThrow(/permission denied/i);

    expect(() =>
      retrieveCalendarSignals({
        ...createDemoConnectedState('calendar'),
        status: 'token_expired',
      })
    ).toThrow(/token expired/i);
  });

  it('does not retrieve from disconnected integrations', () => {
    const signals = collectWorkspaceSignals({
      integrations: [
        createDisconnectedState('calendar'),
        createDisconnectedState('gmail'),
        createDisconnectedState('drive'),
      ],
      query: 'recruiter meeting CV',
    });

    expect(signals.derivedSources).toHaveLength(0);
  });

  it('respects selected Drive folder and file boundaries', () => {
    const selected = retrieveDriveSignals(createDemoConnectedState('drive', { selectedDriveIds: ['career-folder'] }));
    const unselected = retrieveDriveSignals(createDemoConnectedState('drive', { selectedDriveIds: ['private-folder'] }));

    expect(selected.files.map((file) => file.id)).toEqual(['drive_cv_1']);
    expect(unselected.files.map((file) => file.id)).toEqual(['drive_private_1']);
  });

  it('calendar meeting source can increase urgency of related unresolved gap', () => {
    const project = createGoldenDemoProject();
    const calendarSignals = retrieveCalendarSignals(createDemoConnectedState('calendar'));
    project.sources.push(...calendarSignals.sources);

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-10',
      force: true,
    });

    expect(brief.recommendations[0].kind).toBe('preparation');
  });

  it('maps real Calendar API events into connector sources', async () => {
    const calendarClient = {
      events: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'real_event_1',
                summary: 'Real planning meeting',
                description: 'Discuss the Calendar OAuth integration.',
                start: { dateTime: '2026-08-12T10:00:00Z' },
                end: { dateTime: '2026-08-12T10:30:00Z' },
                htmlLink: 'https://calendar.google.com/event?eid=real_event_1',
              },
            ],
          },
        }),
      },
    } as any;

    const result = await retrieveRealCalendarSignals('demo-user', createDemoConnectedState('calendar'), undefined, calendarClient);

    expect(result.events[0]).toMatchObject({
      id: 'real_event_1',
      title: 'Real planning meeting',
    });
    expect(result.sources[0]).toMatchObject({
      id: 'gcal_real_event_1',
      origin: 'connector',
      mime_type: 'application/vnd.google.calendar.event',
      storage_url: 'https://calendar.google.com/event?eid=real_event_1',
    });
    expect(result.diagnostics).toMatchObject({
      calendarId: 'primary',
      rawResultCount: 1,
      eventIds: ['real_event_1'],
      eventTypeCounts: { default: 1 },
      statusCounts: { default: 1 },
    });
  });

  it('filters Context Pack Calendar events locally after reading the 30-day window', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'development');
    const calendarClient = {
      events: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'birthday_1',
                summary: 'Happy birthday!',
                eventType: 'birthday',
                start: { date: '2026-08-12' },
                end: { date: '2026-08-13' },
              },
              {
                id: 'ended_10_min_ago',
                summary: 'Already finished standup',
                eventType: 'default',
                start: { dateTime: '2026-08-11T19:20:00Z' },
                end: { dateTime: '2026-08-11T19:50:00Z' },
              },
              {
                id: 'ongoing_event',
                summary: 'Ongoing product review',
                eventType: 'default',
                start: { dateTime: '2026-08-11T19:30:00Z' },
                end: { dateTime: '2026-08-11T20:30:00Z' },
              },
              {
                id: 'gapwise_calendar_test',
                summary: 'gapwise calendar test',
                start: { dateTime: '2026-08-12T10:00:00Z' },
                end: { dateTime: '2026-08-12T10:30:00Z' },
              },
              {
                id: 'working_location_1',
                summary: 'Working from home',
                eventType: 'workingLocation',
                start: { date: '2026-08-13' },
                end: { date: '2026-08-14' },
              },
              {
                id: 'future_6mo',
                summary: 'Six month planning',
                eventType: 'default',
                start: { dateTime: '2027-02-12T10:00:00Z' },
                end: { dateTime: '2027-02-12T10:30:00Z' },
              },
              {
                id: 'gmail_event',
                summary: 'Flight from Gmail',
                eventType: 'fromGmail',
                start: { dateTime: '2026-08-14T10:00:00Z' },
                end: { dateTime: '2026-08-14T10:30:00Z' },
              },
            ],
          },
        }),
      },
    } as any;

    const events = await listContextPackCalendarEvents(
      'demo-user',
      new Date('2026-08-11T20:00:00Z'),
      calendarClient
    );

    expect(calendarClient.events.list).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        timeMin: '2026-08-11T20:00:00.000Z',
        timeMax: '2026-09-10T20:00:00.000Z',
        singleEvents: true,
        orderBy: 'startTime',
      })
    );
    expect(calendarClient.events.list).not.toHaveBeenCalledWith(expect.objectContaining({ eventTypes: expect.anything() }));
    expect(events.map((event) => event.id)).toEqual(['ongoing_event', 'gapwise_calendar_test', 'gmail_event']);
    expect(events.map((event) => event.summary)).toEqual([
      'Ongoing product review',
      'gapwise calendar test',
      'Flight from Gmail',
    ]);
    expect(events.some((event) => event.id === 'ended_10_min_ago')).toBe(false);
    expect(events.some((event) => /birthday/i.test(event.summary))).toBe(false);
    expect(events.some((event) => event.id === 'working_location_1')).toBe(false);
    expect(events.some((event) => event.id === 'future_6mo')).toBe(false);
    expect(info).toHaveBeenCalledWith(
      '[Gapwise Calendar Context Pack]',
      expect.objectContaining({
        rawEventCount: 7,
        filteredEventCount: 3,
        eventIds: expect.arrayContaining(['gapwise_calendar_test', 'birthday_1', 'working_location_1']),
        eventTypes: expect.arrayContaining(['default', 'birthday', 'workingLocation']),
      })
    );
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/access_token|refresh_token/i);
    vi.unstubAllEnvs();
    info.mockRestore();
  });

  it('relevant recruiter Gmail appears in Today with source explanation', () => {
    const project = createGoldenDemoProject();
    const gmailSignals = retrieveGmailSignals(
      createDemoConnectedState('gmail', { selectedLabels: ['INBOX', 'Opportunities'] }),
      'recruiter AI role compensation'
    );
    project.sources.push(...gmailSignals.sources);

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-10',
      force: true,
    });

    const recruiter = brief.recommendations.find((recommendation) => recommendation.id.includes('gmail_demo_recruiter_1'));
    expect(recruiter?.context_pack.relevantEvidence.some((evidence) => evidence.source_id === 'gmail_demo_recruiter_1')).toBe(true);
  });
});
