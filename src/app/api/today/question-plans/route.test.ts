import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { POST } from './route';

vi.mock('@/lib/ask/adkClient', () => ({
  AskAgentError: class AskAgentError extends Error {
    stage = 'agent-unavailable';
  },
  askGapswise: vi.fn(),
}));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

function request(body: unknown): Request {
  return new Request('http://localhost/api/today/question-plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const question = {
  id: 'question_budget',
  question: 'What is the trip budget?',
  reason: 'It blocks the hotel decision.',
  provenance: 'Sources: japan-trip.txt',
};

describe('POST /api/today/question-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  });

  it('uses the existing ADK flow once for contextual answer suggestions', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    vi.mocked(askGapswise).mockResolvedValue({
      answer: JSON.stringify({
        suggestions: [{ questionId: question.id, suggestedAnswer: 'The budget is not recorded yet.', whyItMatters: 'It controls the hotel decision.' }],
        presentations: [{ questionId: question.id, title: 'Decide what to spend on the trip', summary: 'The budget determines which hotels are affordable.' }],
      }),
      sessionId: 'today_plans_session',
      sources: [],
    });

    const response = await POST(request({ userId: 'demo-user', projectId: 'japan_trip', scopeLabel: 'Japan trip', questions: [question] }));

    expect(response.status).toBe(200);
    expect(askGapswise).toHaveBeenCalledTimes(1);
    expect(askGapswise).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user',
      projectId: 'japan_trip',
      message: expect.stringContaining('question_budget'),
    }));
    await expect(response.json()).resolves.toMatchObject({
      generatedBy: 'gapswise-agent',
      suggestions: [{ questionId: 'question_budget', suggestedAnswer: 'The budget is not recorded yet.', whyItMatters: 'It controls the hotel decision.' }],
      presentations: [{ questionId: 'question_budget', title: 'Decide what to spend on the trip', summary: 'The budget determines which hotels are affordable.' }],
    });
  });

  it('uses local suggestions without calling the agent in demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';

    const response = await POST(request({ userId: 'demo-user', questions: [question] }));

    expect(response.status).toBe(200);
    expect(askGapswise).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ generatedBy: 'local-context', suggestions: [{ questionId: 'question_budget' }], presentations: [{ questionId: 'question_budget' }] });
  });

  it('keeps Today usable with a labeled local fallback when the agent is unavailable', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    vi.mocked(askGapswise).mockRejectedValue(new AskAgentError('The deployed ADK agent could not be reached while creating a session.'));

    const response = await POST(request({ userId: 'demo-user', questions: [question] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      generatedBy: 'local-fallback',
      stage: 'agent-unavailable',
      warning: expect.stringContaining('AI answer suggestions are unavailable'),
      suggestions: [{ questionId: 'question_budget' }],
      presentations: [{ questionId: 'question_budget' }],
    });
  });
});
