import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { generateLocalAskSuggestions } from '@/lib/ask/localDemoAdapter';
import { getStorageProvider, loadProjectForScope } from '@/lib/storage';
import type { StorageProvider } from '@/lib/storage/types';
import { POST } from './route';

vi.mock('@/lib/ask/adkClient', () => ({
  AskAgentError: class AskAgentError extends Error {},
  askGapswise: vi.fn(),
}));
vi.mock('@/lib/ask/localDemoAdapter', () => ({
  generateLocalAskSuggestions: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  getStorageProvider: vi.fn(),
  loadProjectForScope: vi.fn(),
}));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const storage = {
  getUserMemoryProfile: vi.fn(),
  getMemories: vi.fn(),
  replaceMemories: vi.fn(),
  getAskSuggestionsCache: vi.fn(),
  saveAskSuggestionsCache: vi.fn(),
};
let savedSuggestionRecord: Record<string, unknown> | null = null;

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/ask/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ask/suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedSuggestionRecord = null;
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
    vi.mocked(getStorageProvider).mockReturnValue(storage as unknown as StorageProvider);
    storage.getUserMemoryProfile.mockResolvedValue(null);
    storage.getMemories.mockResolvedValue([]);
    storage.replaceMemories.mockResolvedValue(undefined);
    vi.mocked(loadProjectForScope).mockImplementation(async (_userId, projectId) => ({
      project: {
        id: projectId ?? '__everything__',
        title: projectId ? 'Project' : 'Everything',
        goal: 'Prepare the project for launch.',
        status: 'active',
        clarity_score: 0,
        nodes: [],
        edges: [],
        sources: [],
        history: [],
        historyEvents: [],
        created_at: '2026-08-20T10:00:00.000Z',
        updated_at: '2026-08-20T10:00:00.000Z',
      },
      scope: projectId ? { type: 'project', projectId } : { type: 'everything' },
    } as never));
    storage.getAskSuggestionsCache.mockImplementation(async (_userId: string, cacheId: string) => (
      savedSuggestionRecord?.id === cacheId ? savedSuggestionRecord : null
    ));
    storage.saveAskSuggestionsCache.mockImplementation(async (_userId: string, record: Record<string, unknown>) => {
      savedSuggestionRecord = record;
    });
  });

  it('asks the existing ADK session flow for project-scoped questions', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    vi.mocked(askGapswise).mockResolvedValue({
      answer: '{"top_questions":["What is blocking the Japan trip budget?","Which dates are fixed?","What should I book first?"],"other_questions":["What can wait?","What should I compare?","What changed?"]}',
      sessionId: 'suggestions_session',
      sources: [],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      projectId: 'japan_trip',
      scopeLabel: 'Japan trip',
    }));

    expect(response.status).toBe(200);
    expect(askGapswise).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user',
      projectId: 'japan_trip',
      message: expect.stringContaining('The current Gapwise scope is: Japan trip.'),
    }));
    await expect(response.json()).resolves.toEqual({
      topQuestions: [
        'What is blocking the Japan trip budget?',
        'Which dates are fixed?',
        'What should I book first?',
      ],
      otherQuestions: ['What can wait?', 'What should I compare?', 'What changed?'],
      generatedBy: 'gapswise-agent',
    });
  });

  it('uses the context-aware local path in demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    vi.mocked(generateLocalAskSuggestions).mockResolvedValue({
      top: ['Have I estimated the full cost and key logistics for this trip?'],
      other: ['What can wait until later?'],
    });

    const response = await POST(jsonRequest({ userId: 'demo-user', scopeLabel: 'Everything' }));

    expect(response.status).toBe(200);
    expect(generateLocalAskSuggestions).toHaveBeenCalledWith({
      userId: 'demo-user',
    });
    await expect(response.json()).resolves.toEqual({
      topQuestions: ['Have I estimated the full cost and key logistics for this trip?'],
      otherQuestions: ['What can wait until later?'],
      generatedBy: 'local-context',
    });

    const reopened = await POST(jsonRequest({ userId: 'demo-user', scopeLabel: 'Everything' }));
    expect(reopened.status).toBe(200);
    expect(generateLocalAskSuggestions).toHaveBeenCalledOnce();
    await expect(reopened.json()).resolves.toMatchObject({ generatedBy: 'local-context' });
  });

  it('uses context-derived suggestions when the agent is unavailable', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    vi.mocked(askGapswise).mockRejectedValue(new AskAgentError('ADK is unavailable.'));
    vi.mocked(generateLocalAskSuggestions).mockResolvedValue({
      top: ['What should I clarify about the trip budget?'],
      other: ['What should I verify next?'],
    });

    const response = await POST(jsonRequest({ userId: 'demo-user' }));

    expect(response.status).toBe(200);
    expect(generateLocalAskSuggestions).toHaveBeenCalledWith({ userId: 'demo-user', projectId: undefined });
    await expect(response.json()).resolves.toEqual({
      topQuestions: ['What should I clarify about the trip budget?'],
      otherQuestions: ['What should I verify next?'],
      generatedBy: 'local-fallback',
      warning: 'Using saved context for these suggestions while AI is unavailable.',
      stage: 'agent-unavailable',
    });
  });

  it('retries AI after a temporary fallback instead of reusing it from cache', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    vi.mocked(askGapswise)
      .mockRejectedValueOnce(new AskAgentError('ADK is unavailable.'))
      .mockResolvedValueOnce({
        answer: '{"top_questions":["What should the recovered agent clarify?"],"other_questions":[]}',
        sessionId: 'suggestions_session',
        sources: [],
      });
    vi.mocked(generateLocalAskSuggestions).mockResolvedValue({
      top: ['What should the fallback clarify?'],
      other: [],
    });

    const first = await POST(jsonRequest({ userId: 'demo-user', projectId: 'recovery-project' }));
    const second = await POST(jsonRequest({ userId: 'demo-user', projectId: 'recovery-project' }));

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ generatedBy: 'local-fallback' });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({
      topQuestions: ['What should the recovered agent clarify?'],
      otherQuestions: [],
      generatedBy: 'gapswise-agent',
    });
    expect(askGapswise).toHaveBeenCalledTimes(2);
    expect(generateLocalAskSuggestions).toHaveBeenCalledOnce();
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledOnce();
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledWith(
      'demo-user',
      expect.objectContaining({ generatedBy: 'gapswise-agent' }),
    );
  });

  it('keeps the Career Demo deterministic even when AI mode is enabled', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    vi.mocked(generateLocalAskSuggestions).mockResolvedValue({
      top: ["Given Northstar's Product Engineer role is 70–80% frontend and I want backend or applied AI ownership, what would have to be true for this role to still be worth pursuing?"],
      other: [],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      projectId: 'career_conflict_demo',
      scopeLabel: 'Career Transition — Northstar Product Engineer',
    }));

    expect(response.status).toBe(200);
    expect(generateLocalAskSuggestions).toHaveBeenCalledWith({
      userId: 'demo-user',
      projectId: 'career_conflict_demo',
    });
    expect(askGapswise).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ generatedBy: 'local-context' });
  });

  it('rejects an invalid request', async () => {
    const response = await POST(jsonRequest({ userId: '' }));
    expect(response.status).toBe(400);
    expect(askGapswise).not.toHaveBeenCalled();
  });
});
