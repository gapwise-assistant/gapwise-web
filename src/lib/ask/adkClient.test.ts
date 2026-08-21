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
    expect(result.promptUsed).toContain('Who exactly is the demo for?');
    expect(result.promptUsed).toContain('What should I decide next?');
    expect(result.promptUsed).toContain('PRELOADED GAPWISE CONTEXT PACK');
    expect(result.promptUsed?.match(/planning-note\.txt:/g)).toHaveLength(1);
    expect(result.sources).toEqual([
      {
        id: 'src_2',
        title: 'Planning Note',
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
    const runRequest = (fetchMock.mock.calls as Array<[unknown, RequestInit?]>).find(([url]) => String(url).endsWith('/run_sse'))?.[1];
    const runBody = JSON.parse(String(runRequest?.body ?? '{}')) as { new_message?: { parts?: Array<{ text?: string }> } };
    expect(runBody.new_message?.parts?.[0]?.text).toContain('Who exactly is the demo for?');
    expect(runBody.new_message?.parts?.[0]?.text).toContain('What should I decide next?');
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

  it('removes a repeated Markdown response without flattening its list or arithmetic', async () => {
    const answer = [
      '**Current picture**',
      '',
      '- Apartment 1: $1,450 + $180 utilities = $1,630',
      '- Apartment 2: $1,600 with utilities included',
    ].join('\n');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_123' });
      if (target.endsWith('/run_sse')) return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: `${answer}\n\n${answer}` }] } })}\n`);
      if (target.endsWith('/api/internal/context-pack')) return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [] } });
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({ userId: 'demo-user', message: 'Compare the apartments.' });

    expect(result.answer).toBe(answer);
    expect(result.answer.match(/Apartment 1/g)).toHaveLength(1);
    expect(result.answer).toContain('$1,450 + $180 utilities = $1,630');
    expect(result.answer).toContain('- Apartment 2');
  });

  it('keeps only the final cumulative response when ADK repeats a line-wrapped draft', async () => {
    const draft = 'Based on\nthe ClinicFlow sources provided in your Context Pack:\n\n### What changed\nThe vendor cannot deliver the fix before September 15.';
    const final = 'Based on the ClinicFlow sources provided in your Context Pack:\n\n### What changed\nThe vendor cannot deliver the fix before September 15.';
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_123' });
      if (target.endsWith('/run_sse')) {
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: `${draft}\n${final}` }] } })}\n`);
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [] } });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({ userId: 'demo-user', message: 'What changed?' });

    expect(result.answer).toBe(final);
    expect(result.answer.match(/Based on/g)).toHaveLength(1);
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
      expect.objectContaining({ id: 'src_birthday', title: 'Birthday' }),
    ]);
  });

  it('does not replace a grounded answer merely because a project actor cannot do something', async () => {
    const groundedAnswer = [
      'The retry test answered the duplicate-record uncertainty.',
      'The vendor cannot deliver idempotent retries before September 15, so SMS consent is now the next launch blocker.',
    ].join(' ');
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_123' });
      if (target.endsWith('/run_sse')) {
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: groundedAnswer }] } })}\n`);
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({
          contextPack: {
            relevantEvidence: [{
              source_id: 'src_retry_results',
              filename: 'clinicflow-offline-retry-test-results.md',
              excerpt: 'A short source excerpt that should not replace the complete Gemini answer.',
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
      projectId: 'project_clinicflow',
      message: 'What changed after the retry test?',
    });

    expect(result.answer).toBe(groundedAnswer);
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
