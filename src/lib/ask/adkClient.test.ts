import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askGapswise, determineAskRoute, test3 } from './adkClient';

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

function textResponse(text: string, init?: ResponseInit): Response {
  return new Response(text, {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...(init?.headers ?? {}) },
  });
}

describe('determineAskRoute', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the structured ADK routing decision for explicit and unfamiliar questions', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('/internal/ask-route');
      return jsonResponse({ route: 'web_research', reason: 'The request asks for online verification.' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(determineAskRoute('demo-user', 'What is the MiniDV format?', null)).resolves.toMatchObject({
      route: 'web_research',
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/internal/ask-route'), expect.objectContaining({
      body: expect.stringContaining('MiniDV'),
    }));
  });

  it('preserves a trusted internal-context decision from the routing agent', async () => {
    const sources = [{
      id: 'src_birthday',
      title: 'Birthday',
      excerpt: 'My birthday is tomorrow.',
      score: 1,
      kind: 'source' as const,
    }];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'internal_context',
      reason: 'Trusted context contains the answer.',
    })));
    await expect(determineAskRoute('demo-user', 'When is my birthday?', null, sources)).resolves.toMatchObject({ route: 'internal_context' });
  });

  it('passes confirmed context and resolved answer details to the routing agent', async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ route: 'internal_context', reason: 'Trusted saved context answers the question.' });
    }));

    const contextPack = {
      activeGoals: [],
      unresolvedGaps: [],
      recentlyResolvedGaps: [{
        id: 'gap_resolved',
        type: 'UNKNOWN',
        text: 'What is the launch date?',
        source_refs: [],
        why_it_matters: ['The launch date affects the next action.'],
      }],
      recentDecisions: [],
      recentImportantEvents: ['What is the launch date? -> October 9'],
      researchEvidence: [{
        id: 'research_context',
        text: 'The launch date is October 9.',
        retrievedAt: '2026-08-20T10:00:00.000Z',
        sources: [],
        provenance: 'user_confirmed_ai_response',
        action: 'save_as_context',
        status: 'confirmed',
      }, {
        id: 'research_web_save',
        text: 'A web answer saved for later research.',
        retrievedAt: '2026-08-20T10:00:00.000Z',
        sources: [],
        provenance: 'assistant_web_research_confirmed_by_user',
        action: 'save',
        status: 'confirmed',
      }, {
        id: 'research_web_answer',
        text: 'The confirmed web answer is October 9.',
        retrievedAt: '2026-08-20T10:00:00.000Z',
        sources: [],
        provenance: 'assistant_web_research_confirmed_by_user',
        action: 'use_as_answer',
        status: 'confirmed',
      }, {
        id: 'research_decision_answer',
        text: 'Use a helper for the upstairs windows.',
        retrievedAt: '2026-08-20T10:00:00.000Z',
        sources: [],
        provenance: 'assistant_web_research_confirmed_by_user',
        action: 'use_as_decision',
        targetDecisionId: 'decision_windows',
        status: 'confirmed',
      }],
    } as unknown as Parameters<typeof determineAskRoute>[2];

    await determineAskRoute('demo-user', 'When is the launch date?', contextPack);

    expect(requestBody).toMatchObject({
      trusted_context: {
        graph: [{ type: 'UNKNOWN', text: 'What is the launch date?', details: 'The launch date affects the next action.' }],
        resolvedAnswers: ['What is the launch date? -> October 9'],
        researchEvidence: [{
          id: 'research_context',
          text: 'The launch date is October 9.',
          provenance: 'user_confirmed_ai_response',
        }, {
          id: 'research_web_answer',
          text: 'The confirmed web answer is October 9.',
          provenance: 'assistant_web_research_confirmed_by_user',
        }, {
          id: 'research_decision_answer',
          text: 'Use a helper for the upstairs windows.',
          provenance: 'assistant_web_research_confirmed_by_user',
          targetDecisionId: 'decision_windows',
        }],
      },
    });
    const trustedResearch = (requestBody?.trusted_context as { researchEvidence?: Array<{ id: string }> }).researchEvidence ?? [];
    expect(trustedResearch.map((item) => item.id)).not.toContain('research_web_save');
  });

  it('marks an unavailable routing response as a routing failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('routing service unavailable');
    }));

    await expect(determineAskRoute('demo-user', 'Search online for current information.', null))
      .rejects.toMatchObject({ stage: 'routing' });
  });
});

describe('askGapswise', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles web research verification failure when no grounded URLs are returned', async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      requestedUrls.push(target);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) throw new Error('Partner session must not be created for web research.');
      if (target.endsWith('/internal/ask-route')) {
        return jsonResponse({ route: 'web_research', reason: 'Explicit online verification.' });
      }
      if (target.endsWith('/internal/web-research')) {
        return jsonResponse({
          sessionId: 'web_session_123',
          events: [{ content: { parts: [{ text: 'Unverified model output without grounded sources.' }] } }],
        });
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'Search the web for current mortgage rates',
    });

    expect(result.answer).toContain('External verification failed');
    expect(result.sources).toEqual([]);
    expect(requestedUrls.some((target) => target.endsWith('/apps/app/users/demo-user/sessions'))).toBe(false);
    expect(result.execution).toEqual({ route: 'web_research', agent: 'Web Research Agent', toolCalls: ['google_search'] });
  });

  it('returns grounded web sources for a routed MiniDV question', async () => {
    const groundedEvent = {
      content: { parts: [{ text: 'MiniDV is a digital video format documented by the cited source.' }] },
      groundingMetadata: {
        groundingChunks: [{ web: { uri: 'https://example.com/minidv', title: 'MiniDV reference', snippet: 'MiniDV is a digital video format.' } }],
        groundingSupports: [{ segment: { text: 'MiniDV is a digital video format.' }, groundingChunkIndices: [0], confidenceScores: [0.95] }],
      },
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) throw new Error('Partner session must not be created for web research.');
      if (target.endsWith('/internal/ask-route')) {
        return jsonResponse({ route: 'web_research', reason: 'Explicit online verification.' });
      }
      if (target.endsWith('/internal/web-research')) {
        return jsonResponse({ sessionId: 'web_session_123', events: [groundedEvent] });
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'What is the MiniDV format?',
    });

    expect(result.answer).toContain('MiniDV');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      kind: 'web',
      url: 'https://example.com/minidv',
      title: 'MiniDV reference',
    });
    expect(result.sessionId).toBeUndefined();
    expect(result.execution).toEqual({ route: 'web_research', agent: 'Web Research Agent', toolCalls: ['google_search'] });
  });

  it('does not claim google_search when the web-research endpoint is unreachable', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/internal/ask-route')) {
        return jsonResponse({ route: 'web_research', reason: 'Explicit online verification.' });
      }
      if (target.endsWith('/internal/web-research')) {
        throw new Error('web-research endpoint unavailable');
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      }
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'Search the web for current information.',
    });

    expect(result.answer).toContain('External verification failed');
    expect(result.execution).toEqual({ route: 'web_research', agent: 'Web Research Agent', toolCalls: [] });
  });

  it('answers from directly retrieved evidence when ADK returns a project-relevance refusal', async () => {
    const refusal = 'I do not have a birthday, as I am an AI. I can only help with Gapswise-related queries.';
    let contextPackRequest: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) {
        return jsonResponse({ id: 'session_123' });
      }
      if (target.endsWith('/internal/ask-route')) {
        return jsonResponse({ route: 'internal_context', reason: 'Trusted context directly answers.' });
      }
      if (target.endsWith('/run_sse')) {
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: refusal }] } })}\n`);
      }
      if (target.endsWith('/api/internal/context-pack')) {
        contextPackRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          contextPack: {
            relevantEvidence: [{
              source_id: 'src_birthday',
              filename: 'birthday.txt',
              excerpt: 'My birthday is tomorrow.',
              score: 1,
            }],
            upcomingCommitments: [],
            researchEvidence: [],
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
      excludeMessageId: 'message_current',
      excludeSourceId: 'ask_chat_message_current',
    });

    expect(result.answer).toBe('Your birthday is tomorrow.');
    expect(result.sources).toEqual([
      expect.objectContaining({ id: 'src_birthday', title: 'Birthday' }),
    ]);
    expect(result.execution).toEqual({ route: 'internal_context', agent: 'Partner Agent', toolCalls: ['ADK /run_sse'] });
    expect(contextPackRequest).toMatchObject({
      excludeMessageId: 'message_current',
      excludeSourceId: 'ask_chat_message_current',
    });
  });
});
