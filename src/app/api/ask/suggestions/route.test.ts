import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { generateLocalAskSuggestions } from '@/lib/ask/localDemoAdapter';
import { POST } from './route';

vi.mock('@/lib/ask/adkClient', () => ({
  AskAgentError: class AskAgentError extends Error {},
  askGapswise: vi.fn(),
}));
vi.mock('@/lib/ask/localDemoAdapter', () => ({
  generateLocalAskSuggestions: vi.fn(),
}));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

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
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
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
      message: expect.stringContaining('The current Gapswise scope is: Japan trip.'),
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
      warning: 'AI suggestions are unavailable right now. Showing questions from the current context instead.',
      stage: 'agent-unavailable',
    });
  });

  it('rejects an invalid request', async () => {
    const response = await POST(jsonRequest({ userId: '' }));
    expect(response.status).toBe(400);
    expect(askGapswise).not.toHaveBeenCalled();
  });
});
