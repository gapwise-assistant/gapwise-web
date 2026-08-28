import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_PROFILE, createGoldenDemoProject } from '@/lib/demo/seed';
import { refreshAskSuggestionsForProject } from '@/lib/ask/suggestionsRefresh';
import type { AskSuggestionsCacheRecord } from '@/lib/storage/types';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';

const mocks = vi.hoisted(() => ({
  askGapswise: vi.fn(),
  generateLocalAskSuggestions: vi.fn(),
}));

vi.mock('@/lib/ask/adkClient', () => ({
  askGapswise: mocks.askGapswise,
}));

vi.mock('@/lib/ask/localDemoAdapter', () => ({
  generateLocalAskSuggestions: mocks.generateLocalAskSuggestions,
}));

describe('Ask suggestions refresh', () => {
  let records: Map<string, AskSuggestionsCacheRecord>;
  let storage: {
    getAskSuggestionsCache: ReturnType<typeof vi.fn>;
    saveAskSuggestionsCache: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    records = new Map();
    storage = {
      getAskSuggestionsCache: vi.fn(async (_userId: string, id: string) => records.get(id) ?? null),
      saveAskSuggestionsCache: vi.fn(async (_userId: string, record: AskSuggestionsCacheRecord) => {
        records.set(record.id, record);
      }),
    };
    mocks.askGapswise.mockReset();
    mocks.generateLocalAskSuggestions.mockReset();
    mocks.askGapswise.mockResolvedValue({
      answer: JSON.stringify({
        top_questions: ['Which delivery milestone is still uncertain?'],
        other_questions: ['What should be checked before launch?'],
      }),
    });
    mocks.generateLocalAskSuggestions.mockResolvedValue({
      top: ['Which local project detail should be clarified?'],
      other: [],
    });
  });

  afterEach(() => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
  });

  it('generates once, persists, and reuses the assessment until semantic state changes', async () => {
    const project = createGoldenDemoProject();
    const first = await refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: storage as never,
    });
    const second = await refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: storage as never,
    });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(mocks.askGapswise).toHaveBeenCalledOnce();
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledOnce();
    expect(mocks.askGapswise.mock.calls[0]?.[0].message).toContain('PROJECT-SCOPED GRAPH CONTEXT');

    project.nodes[0]!.text = `${project.nodes[0]!.text} with a confirmed requirement`;
    await refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: storage as never,
    });

    expect(mocks.askGapswise).toHaveBeenCalledTimes(2);
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledTimes(2);
  });

  it('does not save a temporary fallback and retries after the agent recovers', async () => {
    const project = createGoldenDemoProject();
    mocks.askGapswise
      .mockRejectedValueOnce(new Error('temporary agent failure'))
      .mockResolvedValueOnce({
        answer: JSON.stringify({
          top_questions: ['What is the next confirmed milestone?'],
          other_questions: [],
        }),
      });

    const first = await refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: storage as never,
    });
    const second = await refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: storage as never,
    });

    expect(first.warning).toContain('AI is unavailable');
    expect(second.top).toEqual(['What is the next confirmed milestone?']);
    expect(mocks.askGapswise).toHaveBeenCalledTimes(2);
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledOnce();
  });

  it('persists intentional local-context suggestions and reuses them', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const project = createGoldenDemoProject();

    const first = await refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: storage as never,
    });
    const second = await refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: storage as never,
    });

    expect(first.top).toEqual(['Which local project detail should be clarified?']);
    expect(second.cached).toBe(true);
    expect(mocks.generateLocalAskSuggestions).toHaveBeenCalledOnce();
    expect(mocks.askGapswise).not.toHaveBeenCalled();
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledOnce();
  });

  it('does not let an older generation overwrite a newer semantic version', async () => {
    const firstProject = createGoldenDemoProject();
    const secondProject = structuredClone(firstProject);
    secondProject.nodes[0]!.text = `${secondProject.nodes[0]!.text} with newer context`;
    let persistedVersion = semanticProjectVersion(firstProject);
    let current: AskSuggestionsCacheRecord | null = null;
    const releases: Array<() => void> = [];
    const raceStorage = {
      getAskSuggestionsCache: vi.fn(),
      saveAskSuggestionsCache: vi.fn(),
      getLatestAskSuggestionsCache: vi.fn(async () => current),
      getProjectSemanticVersion: vi.fn(async () => persistedVersion),
      beginAskSuggestionsRefresh: vi.fn(async (_userId: string, record: AskSuggestionsCacheRecord) => {
        current = { ...record };
        return true;
      }),
      publishAskSuggestionsCache: vi.fn(async (_userId: string, record: AskSuggestionsCacheRecord, generationId: string) => {
        if (current?.generationId !== generationId) return false;
        current = { ...record };
        return true;
      }),
    };
    mocks.askGapswise.mockImplementation(() => new Promise((resolve) => {
      const generatedLabel = `Generated ${releases.length + 1}?`;
      const release = () => resolve({
        answer: JSON.stringify({
          top_questions: [generatedLabel],
          other_questions: [],
        }),
      });
      releases.push(release);
    }));

    const firstRefresh = refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project: firstProject,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: raceStorage as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    persistedVersion = semanticProjectVersion(secondProject);
    const secondRefresh = refreshAskSuggestionsForProject({
      userId: 'ask-user',
      project: secondProject,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      storage: raceStorage as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(releases).toHaveLength(2);
    releases[1]!();
    await expect(secondRefresh).resolves.toMatchObject({ top: ['Generated 2?'] });
    releases[0]!();
    await firstRefresh;

    expect(current).toMatchObject({
      status: 'ready',
      requestedSemanticProjectVersion: persistedVersion,
      topQuestions: ['Generated 2?'],
    });
    expect(raceStorage.publishAskSuggestionsCache).toHaveBeenCalledOnce();
  });
});
