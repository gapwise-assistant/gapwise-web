import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askGapswise, askPublicDemo, determineAskRoute, isFocusQuestion } from './adkClient';
import { resetStorageProviderForTests } from '@/lib/storage';

const originalUseFirestore = process.env.USE_FIRESTORE;

describe('isFocusQuestion', () => {
  it('recognizes narrow prioritization intent without classifying unrelated questions', () => {
    expect(isFocusQuestion('What should I do first?')).toBe(true);
    expect(isFocusQuestion('What deserves attention now?')).toBe(true);
    expect(isFocusQuestion('Why do neighbors prefer monthly meetings?')).toBe(false);
  });
});

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

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.USE_FIRESTORE = 'false';
  resetStorageProviderForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUseFirestore === undefined) delete process.env.USE_FIRESTORE;
  else process.env.USE_FIRESTORE = originalUseFirestore;
  resetStorageProviderForTests();
});

describe('determineAskRoute', () => {
  it('accepts web research routes without a reasoning mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'web_research',
      reason: 'The request asks for online verification.',
    })));

    await expect(determineAskRoute('demo-user', 'Search online for current information.', null))
      .resolves.toEqual({
        route: 'web_research',
        reason: 'The request asks for online verification.',
      });
  });

  it('accepts a nullable reasoning mode without retaining null downstream', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/internal/ask-route')) {
        return jsonResponse({
          route: 'web_research',
          reason: 'The request asks for online verification.',
          reasoningMode: null,
        });
      }
      if (target.endsWith('/internal/web-research')) {
        return jsonResponse({
          sessionId: 'web-session-null-mode',
          events: [{
            content: { parts: [{ text: 'Verified answer.' }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: 'https://example.com/verified', title: 'Verified source', snippet: 'Verified answer.' } }],
              groundingSupports: [{ segment: { text: 'Verified answer.' }, groundingChunkIndices: [0], confidenceScores: [0.95] }],
            },
          }],
        });
      }
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      }
      throw new Error(`Unexpected fetch ${target} ${String(init?.body ?? '')}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'Search online for current information.',
    });

    expect(result.answer).toBe('Verified answer.');
    expect(result.execution?.route).toBe('web_research');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/internal/web-research'))).toBe(true);
  });

  it('keeps internal context valid when reasoning mode is null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'internal_context',
      reason: 'The saved project context is relevant.',
      reasoningMode: null,
    })));

    await expect(determineAskRoute('demo-user', 'Can you summarize the saved project context?', null))
      .resolves.toEqual({
        route: 'internal_context',
        reason: 'The saved project context is relevant.',
      });
  });

  it('preserves a supplied graph reasoning mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'graph_reasoning',
      reason: 'The question requires graph analysis.',
      reasoningMode: 'decision',
    })));

    await expect(determineAskRoute('demo-user', 'What should I choose?', null))
      .resolves.toMatchObject({ route: 'graph_reasoning', reasoningMode: 'decision' });
  });

  it('uses the graph reasoning default when its mode is null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'graph_reasoning',
      reason: 'The question requires graph analysis.',
      reasoningMode: null,
    })));

    await expect(determineAskRoute('demo-user', 'How are these project items related?', null))
      .resolves.toMatchObject({ route: 'graph_reasoning', reasoningMode: 'reasoning' });
  });

  it('rejects invalid routes through the existing fallback policy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'not_a_route',
      reason: 'Malformed route.',
    })));

    await expect(determineAskRoute('demo-user', 'Help me think this through.', null))
      .resolves.toMatchObject({ route: 'internal_context' });
  });

  it('rejects invalid non-null reasoning modes through the existing fallback policy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'graph_reasoning',
      reason: 'Malformed reasoning mode.',
      reasoningMode: 'unsupported',
    })));

    await expect(determineAskRoute('demo-user', 'Help me think this through.', null))
      .resolves.toMatchObject({ route: 'internal_context' });
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

  it('preserves the graph-reasoning route from the routing agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'graph_reasoning',
      reason: 'The question requires tracing project dependencies.',
    })));

    await expect(determineAskRoute(
      'demo-user',
      'If the security review fails, what does that put at risk?',
      null,
    )).resolves.toMatchObject({ route: 'graph_reasoning' });
  });

  it('promotes a causal project question when the router returns internal context', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'internal_context',
      reason: 'The request concerns the user project.',
    })));

    await expect(determineAskRoute(
      'demo-user',
      'If the security review is delayed, what happens to the launch?',
      null,
    )).resolves.toMatchObject({
      route: 'graph_reasoning',
      reasoningMode: 'impact',
    });
  });

  it('promotes focus questions into the shared graph focus mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'internal_context',
      reason: 'The request concerns the user project.',
    })));

    await expect(determineAskRoute(
      'demo-user',
      'What should I focus on next?',
      null,
    )).resolves.toMatchObject({
      route: 'graph_reasoning',
      reasoningMode: 'focus',
    });
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

  it('keeps explicit web requests fail-closed when routing is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('routing service unavailable');
    }));

    await expect(determineAskRoute('demo-user', 'Search online for current information.', null))
      .rejects.toMatchObject({ stage: 'routing' });
  });

  it('falls back to internal context when a non-web routing request cannot be classified', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('routing service unavailable');
    }));

    await expect(determineAskRoute('demo-user', 'I am planning my first Night Lab event.', null))
      .resolves.toMatchObject({
        route: 'internal_context',
        reason: 'Routing unavailable; defaulted to project conversation.',
      });
  });

  it('normalizes an older clarification route to internal context', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      route: 'ask_clarification',
      reason: 'The older router used a clarification route.',
    })));

    await expect(determineAskRoute('demo-user', 'I am planning my first Night Lab event.', null))
      .resolves.toMatchObject({ route: 'internal_context' });
  });

  it('sends a new project message as first-class routing input when saved context is empty', async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ route: 'internal_context', reason: 'The current message contains useful project context.' });
    }));

    await expect(determineAskRoute(
      'demo-user',
      'I am organizing the first Night Lab for designers, engineers, artists, and founders. It will be one evening of experimental projects with a final showcase. I want it creative and slightly chaotic but organized, and I am still deciding the event size and format.',
      null,
    )).resolves.toMatchObject({ route: 'internal_context' });

    expect(requestBody).toMatchObject({
      message: expect.stringContaining('first Night Lab'),
      trusted_context: { sources: [], graph: [], resolvedAnswers: [], researchEvidence: [] },
    });
  });
});

describe('askGapswise', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('supplies the selected focus authoritatively for focus questions and preserves OPEN decision status', async () => {
    let partnerPrompt = '';
    const focusTitle = 'Validate local interest before choosing recurring logistics.';
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/api/internal/context-pack')) return jsonResponse({ contextPack: {
        relevantEvidence: [],
        upcomingCommitments: [],
        researchEvidence: [],
        recentDecisions: [{
          id: 'decision_frequency',
          type: 'DECISION',
          text: 'Choose monthly or biweekly meetings.',
          status: 'OPEN',
          source_refs: [],
        }],
      } });
      if (target.endsWith('/internal/ask-route')) return jsonResponse({ route: 'internal_context', reason: 'Prioritization question.' });
      if (target.endsWith('/api/internal/focus-assessment')) return jsonResponse({ focusAssessment: {
        kind: 'discovery',
        title: focusTitle,
        sourceNodeIds: ['decision_frequency'],
        sourceIds: [],
        score: 0.84,
        confidence: 0.9,
      } });
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_focus' });
      if (target.endsWith('/run_sse')) {
        const body = JSON.parse(String(init?.body)) as { new_message: { parts: Array<{ text: string }> } };
        partnerPrompt = body.new_message.parts[0].text;
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: JSON.stringify({ answer: focusTitle, outcome: 'recommendation' }) }] } })}\n`);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    await askGapswise({ userId: 'demo-user', message: 'What should I focus on first?' });

    expect(partnerPrompt).toContain(`Title: ${focusTitle}`);
    expect(partnerPrompt).toContain('Treat this Focus Assessment as the selected current project priority.');
    expect(partnerPrompt).toContain('Do not replace it with a different primary recommendation.');
    expect(partnerPrompt).toContain('Choose monthly or biweekly meetings. [OPEN]');
    expect(partnerPrompt).toContain('An OPEN decision is unresolved');
  });

  it('does not make the supplied assessment authoritative for a non-focus question', async () => {
    let partnerPrompt = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/api/internal/context-pack')) return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      if (target.endsWith('/internal/ask-route')) return jsonResponse({ route: 'internal_context', reason: 'Project question.' });
      if (target.endsWith('/api/internal/focus-assessment')) return jsonResponse({ focusAssessment: {
        kind: 'action', title: 'Prepare the venue.', sourceNodeIds: [], sourceIds: [], score: 0.7, confidence: 0.8,
      } });
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_non_focus' });
      if (target.endsWith('/run_sse')) {
        const body = JSON.parse(String(init?.body)) as { new_message: { parts: Array<{ text: string }> } };
        partnerPrompt = body.new_message.parts[0].text;
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: JSON.stringify({ answer: 'Monthly was the stronger survey preference.', outcome: 'exploration' }) }] } })}\n`);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    await askGapswise({ userId: 'demo-user', message: 'Why did neighbors prefer monthly meetings?' });

    expect(partnerPrompt).toContain('Use this assessment when relevant, but do not force it into unrelated answers.');
    expect(partnerPrompt).not.toContain('The user is asking for project prioritization.');
  });

  it('loads and sends a bounded graph slice only for graph reasoning', async () => {
    let graphContextRequests = 0;
    let normalContextPackRequests = 0;
    let partnerPrompt = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/api/internal/context-pack')) {
        const body = JSON.parse(String(init?.body)) as { graphReasoning?: boolean };
        if (body.graphReasoning) {
          graphContextRequests += 1;
          return jsonResponse({
            contextPack: {
              relevantEvidence: [],
              upcomingCommitments: [],
              researchEvidence: [],
              graphContext: {
                projectGoal: 'Launch the pilot safely.',
                startingNodeIds: ['question_security'],
                nodes: [{
                  id: 'question_security',
                  type: 'UNKNOWN',
                  status: 'OPEN',
                  text: 'Will the security review finish before Friday?',
                  confidence: 0.9,
                  impact: 0.8,
                }, {
                  id: 'risk_launch',
                  type: 'RISK',
                  status: 'OPEN',
                  text: 'A delayed security review could threaten the pilot launch.',
                  confidence: 0.9,
                  impact: 0.8,
                }],
                edges: [{
                  id: 'edge_security_risk',
                  source: 'question_security',
                  target: 'risk_launch',
                  type: 'affects',
                  confidence: 0.8,
                }],
              },
            },
          });
        }
        normalContextPackRequests += 1;
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      }
      if (target.endsWith('/internal/ask-route')) {
        return jsonResponse({ route: 'internal_context', reason: 'The request concerns the user project.' });
      }
      if (target.endsWith('/api/internal/focus-assessment')) return new Response('', { status: 404 });
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_graph' });
      if (target.endsWith('/run_sse')) {
        const body = JSON.parse(String(init?.body)) as { new_message: { parts: Array<{ text: string }> } };
        partnerPrompt = body.new_message.parts[0].text;
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: JSON.stringify({
          answer: 'The unresolved security review affects the Friday launch risk.',
          outcome: 'exploration',
        }) }] } })}\n`);
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'If the security review is delayed, what happens to the launch?',
    });

    expect(normalContextPackRequests).toBe(1);
    expect(graphContextRequests).toBe(1);
    expect(partnerPrompt).toContain('PROJECT_GRAPH_CONTEXT (graph reasoning is active)');
    expect(partnerPrompt).toContain('Launch the pilot safely.');
    expect(partnerPrompt).toContain('question_security');
    expect(result.graphReasoning).toMatchObject({
      startingNodeIds: ['question_security'],
      selectedNodeIds: ['question_security', 'risk_launch'],
      selectedEdges: [{
        id: 'edge_security_risk',
        source: 'question_security',
        target: 'risk_launch',
        type: 'affects',
      }],
    });
    expect(result.execution).toEqual({
      route: 'graph_reasoning',
      agent: 'Partner Agent',
      toolCalls: ['ADK /run_sse'],
    });
  });

  it('preserves an exploratory Partner Agent response without answer metadata', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_exploration' });
      if (target.endsWith('/internal/ask-route')) return jsonResponse({ route: 'internal_context', reason: 'Project conversation.' });
      if (target.endsWith('/run_sse')) {
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: JSON.stringify({
          answer: 'You are still shaping the first event. Would you rather optimize for intimacy or visible energy?',
          outcome: 'exploration',
        }) }] } })}\n`);
      }
      if (target.endsWith('/api/internal/context-pack')) return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'I am planning the first Night Lab event.',
    });

    expect(result).toMatchObject({
      answer: 'You are still shaping the first event. Would you rather optimize for intimacy or visible energy?',
      outcome: 'exploration',
    });
    expect(result.resolvesQuestionId).toBeUndefined();
    expect(result.conclusion).toBeUndefined();
  });

  it('uses the final streamed Ask envelope and normalizes lowercase proposal types', async () => {
    const finalAnswer = 'A one-day CSV delay could weaken confidence in the pilot results.';
    const intermediate = [
      '```json',
      '{',
      '  "answer": "A partial',
      'response",',
      '  "outcome": "exploration",',
      '  "contextProposals": []',
      '}',
      '```',
    ].join('\n');
    const finalEnvelope = `\`\`\`json\n${JSON.stringify({
      answer: finalAnswer,
      outcome: 'exploration',
      contextProposals: [{
        type: 'risk',
        text: 'Consistent CSV delays could undermine pilot credibility.',
        reasoning: 'The evaluation depends on timely data from all five properties.',
        status: 'OPEN',
      }],
    }, null, 2)}\n\`\`\``;

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/api/internal/context-pack')) {
        return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      }
      if (target.endsWith('/internal/ask-route')) {
        return jsonResponse({ route: 'internal_context', reason: 'Project risk question.' });
      }
      if (target.endsWith('/api/internal/focus-assessment')) return new Response('', { status: 404 });
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_streamed_json' });
      if (target.endsWith('/run_sse')) {
        return textResponse([
          `data: ${JSON.stringify({ content: { parts: [{ text: intermediate }] } })}`,
          `data: ${JSON.stringify({ content: { parts: [{ text: finalEnvelope }] } })}`,
          '',
        ].join('\n'));
      }
      throw new Error(`Unexpected fetch ${target}`);
    }));

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'Could late CSV files undermine the pilot results?',
    });

    expect(result.answer).toBe(finalAnswer);
    expect(result.answer).not.toContain('```json');
    expect(result.contextProposals).toEqual([expect.objectContaining({
      type: 'RISK',
      text: 'Consistent CSV delays could undermine pilot credibility.',
      reasoning: 'The evaluation depends on timely data from all five properties.',
      status: 'OPEN',
    })]);
  });

  it('returns a structured conclusion only for a supplied open question target', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('/apps/app/users/demo-user/sessions')) return jsonResponse({ id: 'session_conclusion' });
      if (target.endsWith('/internal/ask-route')) return jsonResponse({ route: 'internal_context', reason: 'Project context.' });
      if (target.endsWith('/run_sse')) {
        return textResponse(`data: ${JSON.stringify({ content: { parts: [{ text: JSON.stringify({
          answer: 'Given the available venue, start with donation-based admission for the first three events.',
          outcome: 'conclusion',
          resolvesQuestionId: 'question_123',
          conclusion: 'Start the first three events with donation-based admission.',
        }) }] } })}\n`);
      }
      if (target.endsWith('/api/internal/context-pack')) return jsonResponse({ contextPack: { relevantEvidence: [], upcomingCommitments: [], researchEvidence: [] } });
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await askGapswise({
      userId: 'demo-user',
      message: 'What admission model should I use?',
      openQuestions: [{ id: 'question_123', text: 'Should admission be donation-based for the first events?' }],
    });

    expect(result).toMatchObject({
      outcome: 'conclusion',
      resolvesQuestionId: 'question_123',
      conclusion: 'Start the first three events with donation-based admission.',
    });
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

describe('askPublicDemo', () => {
  it('uses the dedicated server-controlled public-demo execution boundary', async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('/internal/public-demo');
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        sessionId: 'public-session',
        events: [{
          content: {
            parts: [{ text: JSON.stringify({
              answer: 'Use the current project priorities.',
              outcome: 'recommendation',
              contextProposals: [],
            }) }],
          },
        }],
      });
    }));

    const result = await askPublicDemo({
      userId: 'public-user',
      message: 'What should I focus on?',
      project: { id: 'quick-project', title: 'Quick Demo', goal: 'Explore Gapwise', nodes: [], edges: [], sources: [] } as never,
    });

    expect(requestBody).toEqual({
      user_id: 'public-user',
      message: expect.stringContaining('What should I focus on?'),
      execution_profile: 'public_demo',
    });
    expect(result.sessionId).toBe('public-session');
    expect(result.execution?.toolCalls).toEqual(['ADK /internal/public-demo']);
  });
});
