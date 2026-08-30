import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  getIntegrationStates: vi.fn(),
  retrieveRealCalendarSignals: vi.fn(),
  calendarSignalToSafeEvent: vi.fn((event: unknown) => event),
  refreshCalendarRelevance: vi.fn(),
}));

vi.mock('@/lib/ask/suggestionsRefresh', () => ({
  refreshAskSuggestionsForProject: mocks.refresh,
}));
vi.mock('@/lib/google/state', () => ({
  getIntegrationStates: mocks.getIntegrationStates,
}));
vi.mock('@/lib/google/calendar', () => ({
  retrieveRealCalendarSignals: mocks.retrieveRealCalendarSignals,
  calendarSignalToSafeEvent: mocks.calendarSignalToSafeEvent,
}));
vi.mock('@/lib/google/calendarRelevance', () => ({
  refreshCalendarRelevance: mocks.refreshCalendarRelevance,
}));
vi.mock('@/lib/runtime/demoMode', () => ({
  isDemoMode: () => false,
}));

import {
  clearAskSuggestionsScheduledForTests,
  scheduleAskSuggestionsRefresh,
} from '@/lib/ask/suggestionsScheduler';

describe('Ask suggestions scheduler', () => {
  beforeEach(() => {
    clearAskSuggestionsScheduledForTests();
    mocks.refresh.mockReset();
    mocks.getIntegrationStates.mockReset();
    mocks.retrieveRealCalendarSignals.mockReset();
    mocks.calendarSignalToSafeEvent.mockClear();
    mocks.refreshCalendarRelevance.mockReset();
    mocks.getIntegrationStates.mockResolvedValue([]);
    mocks.retrieveRealCalendarSignals.mockResolvedValue({ events: [], sources: [] });
  });

  it('marks the assessment and waits for the response lifecycle before refreshing', async () => {
    const project = createGoldenDemoProject();
    const markStale = vi.fn().mockResolvedValue(undefined);
    let afterWork!: () => Promise<void>;
    mocks.refresh.mockResolvedValue({ top: [], other: [], generatedBy: 'agent', cached: false });

    await scheduleAskSuggestionsRefresh({
      userId: 'scheduler-user',
      project,
      storage: { markAskSuggestionsStale: markStale } as never,
      scheduleAfterResponse: (work) => { afterWork = work; },
    });

    expect(markStale).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await afterWork();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('deduplicates identical project-version refresh requests', async () => {
    const project = createGoldenDemoProject();
    const callbacks: Array<() => Promise<void>> = [];
    const markStale = vi.fn().mockResolvedValue(undefined);

    await Promise.all([
      scheduleAskSuggestionsRefresh({
        userId: 'scheduler-user',
        project,
        storage: { markAskSuggestionsStale: markStale } as never,
        scheduleAfterResponse: (work) => { callbacks.push(work); },
      }),
      scheduleAskSuggestionsRefresh({
        userId: 'scheduler-user',
        project,
        storage: { markAskSuggestionsStale: markStale } as never,
        scheduleAfterResponse: (work) => { callbacks.push(work); },
      }),
    ]);

    expect(markStale).toHaveBeenCalledOnce();
    expect(callbacks).toHaveLength(1);
  });

  it('does not suppress a personalization refresh for the same project version', async () => {
    const project = createGoldenDemoProject();
    const callbacks: Array<() => Promise<void>> = [];
    const markStale = vi.fn().mockResolvedValue(undefined);
    const changedProfile = { ...DEFAULT_USER_PROFILE, answer_density: 'detailed' as const };

    await scheduleAskSuggestionsRefresh({
      userId: 'scheduler-user',
      project,
      profile: DEFAULT_USER_PROFILE,
      storage: { markAskSuggestionsStale: markStale } as never,
      scheduleAfterResponse: (work) => { callbacks.push(work); },
    });
    await scheduleAskSuggestionsRefresh({
      userId: 'scheduler-user',
      project,
      profile: changedProfile,
      storage: { markAskSuggestionsStale: markStale } as never,
      scheduleAfterResponse: (work) => { callbacks.push(work); },
    });

    expect(markStale).toHaveBeenCalledTimes(2);
    expect(callbacks).toHaveLength(2);
  });

  it('refreshes Calendar relevance after a semantic mutation when Calendar is connected', async () => {
    const project = createGoldenDemoProject();
    const markStale = vi.fn().mockResolvedValue(undefined);
    let afterWork!: () => Promise<void>;
    const calendarEvent = {
      id: 'calendar-release-review',
      title: 'Release review',
      start: '2026-08-30T10:00:00Z',
      end: '2026-08-30T11:00:00Z',
    };
    mocks.getIntegrationStates.mockResolvedValue([{
      name: 'calendar',
      status: 'connected',
      readOnly: true,
      scopes: [],
    }]);
    mocks.retrieveRealCalendarSignals.mockResolvedValue({ events: [calendarEvent], sources: [] });

    await scheduleAskSuggestionsRefresh({
      userId: 'scheduler-user',
      project,
      storage: {
        markAskSuggestionsStale: markStale,
        getGoogleIntegrations: mocks.getIntegrationStates,
      } as never,
      scheduleAfterResponse: (work) => { afterWork = work; },
    });

    await afterWork();
    expect(mocks.retrieveRealCalendarSignals).toHaveBeenCalledOnce();
    expect(mocks.refreshCalendarRelevance).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'scheduler-user',
      project,
      events: [calendarEvent],
    }));
  });
});
