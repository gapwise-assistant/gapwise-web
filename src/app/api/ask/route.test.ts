import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { POST } from './route';
import { askGapswiseLocally } from '@/lib/ask/localDemoAdapter';

vi.mock('@/lib/ask/adkClient', () => ({
  AskAgentError: class AskAgentError extends Error {},
  askGapswise: vi.fn(),
}));
vi.mock('@/lib/ask/localDemoAdapter', () => ({ askGapswiseLocally: vi.fn() }));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  });

  it('uses local Ask and never calls ADK in demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    vi.mocked(askGapswiseLocally).mockResolvedValue({ answer: '## Local answer', sessionId: 'demo_session', sources: [] });
    const response = await POST(jsonRequest({ userId: 'demo-user', message: 'What should I focus on?' }));
    expect(response.status).toBe(200);
    expect(askGapswiseLocally).toHaveBeenCalledOnce();
    expect(askGapswise).not.toHaveBeenCalled();
  });

  it('returns the real ADK Ask result payload', async () => {
    vi.mocked(askGapswise).mockResolvedValue({
      answer: 'Focus on the target-persona decision.',
      sessionId: 'session_123',
      sources: [
        {
          id: 'src_2',
          title: 'planning-note.txt',
          excerpt: 'Who exactly is the demo for?',
          score: 0.82,
          kind: 'source',
        },
      ],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'What should I decide next?',
      sessionId: 'session_123',
      projectId: 'project_hackathon',
    }));

    expect(response.status).toBe(200);
    expect(askGapswise).toHaveBeenCalledWith({
      userId: 'demo-user',
      message: 'What should I decide next?',
      sessionId: 'session_123',
      projectId: 'project_hackathon',
    });
    await expect(response.json()).resolves.toMatchObject({
      answer: 'Focus on the target-persona decision.',
      sessionId: 'session_123',
    });
  });

  it('accepts first-turn requests without an existing session id', async () => {
    vi.mocked(askGapswise).mockResolvedValue({
      answer: 'You should focus on the demo.',
      sessionId: 'new_session',
      sources: [],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'What am I neglecting?',
    }));

    expect(response.status).toBe(200);
    expect(askGapswise).toHaveBeenCalledWith({
      userId: 'demo-user',
      message: 'What am I neglecting?',
    });
  });

  it('rejects invalid requests', async () => {
    const response = await POST(jsonRequest({ userId: 'demo-user', message: '' }));

    expect(response.status).toBe(400);
    expect(askGapswise).not.toHaveBeenCalled();
  });

  it('returns a graceful error when the ADK agent is unavailable', async () => {
    vi.mocked(askGapswise).mockRejectedValue(new AskAgentError('ADK run failed with status 503.'));

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'What am I neglecting?',
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'ADK run failed with status 503.',
    });
  });
});
