import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('@/lib/ask/suggestionsRefresh', () => ({
  refreshAskSuggestionsForProject: mocks.refresh,
}));

import {
  clearAskSuggestionsScheduledForTests,
  scheduleAskSuggestionsRefresh,
} from '@/lib/ask/suggestionsScheduler';

describe('Ask suggestions scheduler', () => {
  beforeEach(() => {
    clearAskSuggestionsScheduledForTests();
    mocks.refresh.mockReset();
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
});
