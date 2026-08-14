import { afterEach, describe, expect, it, vi } from 'vitest';
import { askGapswise } from '@/lib/ask/adkClient';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('ADK Ask client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates an ADK session, runs /run_sse, and returns sanitized sources', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) {
        return jsonResponse({ id: 'session_123' });
      }
      if (target.endsWith('/run_sse')) {
        return textResponse([
          'data: {"content":{"parts":[{"text":"Focus on the demo narrative."}]}}',
          'data: {"content":{"parts":[{"text":"Use the target-persona gap as the next decision."}]}}',
          '',
        ].join('\n'));
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({
          contextPack: {
            provenanceSources: [
              {
                source_id: 'src_2',
                filename: 'planning-note.txt',
                excerpt: 'Who exactly is the demo for?',
                score: 0.82,
                supports: ['Who exactly is the demo for?'],
              },
            ],
            relevantEvidence: [
              {
                source_id: 'src_2',
                filename: 'planning-note.txt',
                excerpt: 'Who exactly is the demo for?',
                score: 0.82,
              },
            ],
            upcomingCommitments: [],
          },
        });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'What should I decide next?',
      projectId: 'project_hackathon',
    });

    expect(result.sessionId).toBe('session_123');
    expect(result.answer).toContain('Focus on the demo narrative.');
    expect(result.answer).toContain('Use the target-persona gap');
    expect(result.sources).toEqual([
      {
        id: 'src_2',
        title: 'planning-note.txt',
        excerpt: 'Who exactly is the demo for?',
        score: 0.82,
        kind: 'source',
        supports: ['Who exactly is the demo for?'],
        reason: 'Supports: Who exactly is the demo for?',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/run_sse',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"session_id":"session_123"'),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/apps/app/users/demo-user/sessions',
      expect.objectContaining({
        body: expect.stringContaining('"gapswise_user_id":"demo-user"'),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/apps/app/users/demo-user/sessions',
      expect.objectContaining({ body: expect.stringContaining('"gapswise_project_id":"project_hackathon"') })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/internal/context-pack',
      expect.objectContaining({ body: expect.stringContaining('"projectId":"project_hackathon"') })
    );
  });

  it('compacts duplicate ADK text events before returning user-visible text', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) {
        return jsonResponse({ id: 'session_123' });
      }
      if (target.endsWith('/run_sse')) {
        return textResponse([
          'data: {"content":{"parts":[{"text":"Gapswise service health status:\\n\\n- **\\nProduct**: Gapswise\\n- **Status**: ok"}]}}',
          'data: {"content":{"parts":[{"text":"Gapswise service health status:\\n\\n- **Product**: Gapswise\\n- **Status**: ok"}]}}',
          '',
        ].join('\n'));
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [] } });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'Check Gapswise health',
    });

    expect(result.answer.match(/Gapswise service health status/g)).toHaveLength(1);
  });

  it('removes repeated trailing fragments from ADK text events', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) {
        return jsonResponse({ id: 'session_123' });
      }
      if (target.endsWith('/run_sse')) {
        return textResponse([
          'data: {"content":{"parts":[{"text":"Gapswise service status: **OK** (`status: ok`, `product: Gapswise`)."}]}}',
          'data: {"content":{"parts":[{"text":"`product: Gapswise`)."}]}}',
          '',
        ].join('\n'));
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [] } });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'Check Gapswise health',
    });

    expect(result.answer).toBe('Gapswise service status: **OK** (`status: ok`, `product: Gapswise`).');
  });

  it('removes a duplicated refusal block returned inside one assistant response', async () => {
    const refusal = 'I cannot answer that from the selected context because it does not match the project goal.';
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) {
        return jsonResponse({ id: 'session_123' });
      }
      if (target.endsWith('/run_sse')) {
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: `${refusal} ${refusal}` }] } })}\n`);
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [] } });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'When is my birthday?',
    });

    expect(result.answer).toBe(refusal);
  });

  it('answers from directly retrieved evidence when ADK returns a project-relevance refusal', async () => {
    const refusal = 'I do not have a birthday, as I am an AI. I can only help with Gapswise-related queries.';
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) {
        return jsonResponse({ id: 'session_123' });
      }
      if (target.endsWith('/run_sse')) {
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: refusal }] } })}\n`);
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({
          contextPack: {
            relevantEvidence: [{
              source_id: 'src_birthday',
              filename: 'birthday.txt',
              excerpt: 'My birthday is tomorrow.',
              score: 1,
            }],
            upcomingCommitments: [],
          },
        });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'When is my birthday?',
      projectId: 'green_pencils',
    });

    expect(result.answer).toBe('Your birthday is tomorrow.');
    expect(result.sources).toEqual([
      expect.objectContaining({ id: 'src_birthday', title: 'birthday.txt' }),
    ]);
  });

  it('reuses an existing ADK session id', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/run_sse')) {
        return textResponse('data: {"content":{"parts":[{"text":"Still in the same session."}]}}\n');
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [] } });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'What changed recently?',
      sessionId: 'existing_session',
    });

    expect(result.sessionId).toBe('existing_session');
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/sessions'),
      expect.anything()
    );
  });

  it('does not invent a fallback answer when ADK is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('unavailable', { status: 503 })));

    await expect(
      askGapswise({
        userId: 'demo-user',
        message: 'What am I neglecting?',
      })
    ).rejects.toThrow(/ADK session creation failed/);
  });
});
