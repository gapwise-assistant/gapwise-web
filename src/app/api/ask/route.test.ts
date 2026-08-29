import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askGapswise, askPublicDemo, AskAgentError } from '@/lib/ask/adkClient';
import { boundedId } from '@/lib/ids/boundedId';
import { POST } from './route';
import { askGapswiseLocally } from '@/lib/ask/localDemoAdapter';
import { getStorageProvider, requireFirestoreStorage } from '@/lib/storage';
import { StorageProvider } from '@/lib/storage/types';
import { persistAskConversationContext } from '@/lib/ask/conversationContext';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { requirePublicDemoAppCheck } from '@/lib/auth/appCheck';

vi.mock('@/lib/history/projectSnapshots', () => ({
  createProjectSnapshot: vi.fn(),
}));

vi.mock('@/lib/ask/adkClient', () => ({
  AskAgentError: class AskAgentError extends Error {
    stage?: string;

    constructor(message: string, options?: { stage?: string }) {
      super(message);
      this.stage = options?.stage;
    }
  },
  askGapswise: vi.fn(),
  askPublicDemo: vi.fn(),
}));
vi.mock('@/lib/ask/localDemoAdapter', () => ({ askGapswiseLocally: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn(), requireFirestoreStorage: vi.fn() }));
vi.mock('@/lib/ask/conversationContext', () => ({ persistAskConversationContext: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireAuthenticatedPrincipal: vi.fn() }));
vi.mock('@/lib/auth/appCheck', () => ({ requirePublicDemoAppCheck: vi.fn() }));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const askStorage = {
  getAskChats: vi.fn(),
  getAskMessages: vi.fn(),
  getProject: vi.fn(),
  getPublicDemoUsage: vi.fn(),
  consumePublicDemoAsk: vi.fn(),
  reservePublicDemoAsk: vi.fn(),
  completePublicDemoAsk: vi.fn(),
  releasePublicDemoAsk: vi.fn(),
  saveAskChat: vi.fn(),
  saveAskMessage: vi.fn(),
  listProjectSnapshots: vi.fn(),
};

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ask', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getStorageProvider).mockReturnValue(askStorage as unknown as StorageProvider);
    vi.mocked(requireFirestoreStorage).mockReturnValue(askStorage as unknown as StorageProvider);
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'demo-user',
      emailVerified: false,
      provider: 'local',
      accessTier: 'local_development',
    });
    vi.mocked(requirePublicDemoAppCheck).mockResolvedValue(undefined);
    askStorage.getAskChats.mockResolvedValue([]);
    askStorage.getAskMessages.mockResolvedValue([]);
    askStorage.getProject.mockResolvedValue({ id: 'project_hackathon', title: 'Demo', goal: 'Demo goal', nodes: [], edges: [], sources: [] });
    askStorage.getPublicDemoUsage.mockResolvedValue(null);
    askStorage.reservePublicDemoAsk.mockResolvedValue({
      accepted: true,
      pending: false,
      alreadyCompleted: false,
      reservationId: 'reservation-1',
      messagesRemaining: 3,
      usage: {
        userId: 'demo-user',
        askMessagesUsed: 0,
        askOperationIds: [],
        createdAt: '2026-08-28T12:00:00.000Z',
        updatedAt: '2026-08-28T12:00:00.000Z',
        expiresAt: '2026-09-04T12:00:00.000Z',
      },
    });
    askStorage.completePublicDemoAsk.mockResolvedValue({
      accepted: true,
      pending: false,
      alreadyCompleted: false,
      messagesRemaining: 2,
      usage: {
        userId: 'public-user',
        askMessagesUsed: 1,
        askOperationIds: ['ask:chat-1:message-1'],
        createdAt: '2026-08-28T12:00:00.000Z',
        updatedAt: '2026-08-28T12:01:00.000Z',
        expiresAt: '2026-09-04T12:00:00.000Z',
      },
    });
    askStorage.releasePublicDemoAsk.mockResolvedValue(undefined);
    askStorage.saveAskChat.mockResolvedValue(undefined);
    askStorage.saveAskMessage.mockResolvedValue(undefined);
    askStorage.listProjectSnapshots.mockResolvedValue([]);
    vi.mocked(persistAskConversationContext).mockResolvedValue({
      sourceId: 'ask_chat_1_message_1',
      openQuestionIds: [],
      openQuestions: [],
    });
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
    vi.mocked(askPublicDemo).mockReset();
  });

  it('uses local Ask and never calls ADK in demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    vi.mocked(askGapswiseLocally).mockResolvedValue({ answer: '## Local answer', sessionId: 'demo_session', sources: [] });
    const response = await POST(jsonRequest({ userId: 'demo-user', message: 'What should I focus on?' }));
    expect(response.status).toBe(200);
    expect(askGapswiseLocally).toHaveBeenCalledOnce();
    expect(askGapswise).not.toHaveBeenCalled();
  });

  it('sends public-demo Ask directly to the Partner Agent and persists no project mutation', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'public-user',
      emailVerified: false,
      provider: 'anonymous',
      accessTier: 'public_demo',
    });
    askStorage.getPublicDemoUsage.mockResolvedValue({
      userId: 'public-user',
      quickDemoProjectId: 'quick-project',
      askMessagesUsed: 0,
      askOperationIds: [],
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
    });
    askStorage.getProject.mockResolvedValue({ id: 'quick-project', title: 'Quick Demo', goal: 'Explore Gapwise', nodes: [], edges: [], sources: [] });
    askStorage.reservePublicDemoAsk.mockResolvedValue({
      accepted: true,
      pending: false,
      alreadyCompleted: false,
      reservationId: 'reservation-1',
      messagesRemaining: 3,
      usage: {
        userId: 'public-user',
        quickDemoProjectId: 'quick-project',
        askMessagesUsed: 0,
        askOperationIds: [],
        createdAt: '2026-08-28T12:00:00.000Z',
        updatedAt: '2026-08-28T12:01:00.000Z',
      },
    });
    askStorage.completePublicDemoAsk.mockResolvedValue({
      accepted: true,
      pending: false,
      alreadyCompleted: false,
      messagesRemaining: 2,
      usage: {
        userId: 'public-user',
        askMessagesUsed: 1,
        askOperationIds: ['ask:chat-1:message-1'],
        createdAt: '2026-08-28T12:00:00.000Z',
        updatedAt: '2026-08-28T12:01:00.000Z',
        expiresAt: '2026-09-04T12:00:00.000Z',
      },
    });
    vi.stubEnv('GAPSWISE_PUBLIC_DAILY_ASK_LIMIT', '30');
    vi.mocked(askPublicDemo).mockResolvedValue({
      answer: 'The workshop has one unresolved supply choice.',
      outcome: 'exploration',
      sessionId: 'public-session',
      sources: [],
      contextProposals: [],
    });

    const response = await POST(jsonRequest({
      userId: 'public-user',
      message: 'What should I think about first?',
      projectId: 'quick-project',
      chatId: 'chat-1',
      userMessageId: 'message-1',
    }));

    expect(response.status).toBe(200);
    expect(askPublicDemo).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'public-user',
      project: expect.objectContaining({ id: 'quick-project' }),
      executionProfile: 'public_demo',
    }));
    expect(askStorage.completePublicDemoAsk).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'ask:chat-1:message-1',
      reservationId: 'reservation-1',
      assistantMessageId: expect.any(String),
    }));
    expect(askGapswise).not.toHaveBeenCalled();
    expect(persistAskConversationContext).not.toHaveBeenCalled();
    expect(askStorage.saveAskMessage).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      answer: 'The workshop has one unresolved supply choice.',
      publicDemo: { messagesRemaining: 2, complete: false },
      modelConfig: { profile: 'public_demo', maxOutputTokens: 512 },
      contextProposals: [],
    });
  });

  it('rejects a fourth public-demo Ask before calling the Partner Agent', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'public-user',
      emailVerified: false,
      provider: 'google',
      accessTier: 'public_demo',
    });
    askStorage.getPublicDemoUsage.mockResolvedValue({
      userId: 'public-user',
      quickDemoProjectId: 'quick-project',
      askMessagesUsed: 3,
      askOperationIds: ['one', 'two', 'three'],
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
    });
    askStorage.getProject.mockResolvedValue({ id: 'quick-project', title: 'Quick Demo', goal: 'Explore Gapwise', nodes: [], edges: [], sources: [] });
    askStorage.reservePublicDemoAsk.mockResolvedValue({
      accepted: false,
      pending: false,
      alreadyCompleted: false,
      blockedReason: 'user_limit',
      messagesRemaining: 0,
      usage: await askStorage.getPublicDemoUsage('public-user'),
    });
    vi.stubEnv('GAPSWISE_PUBLIC_DAILY_ASK_LIMIT', '30');

    const response = await POST(jsonRequest({
      userId: 'public-user',
      message: 'One more question',
      projectId: 'quick-project',
      chatId: 'chat-4',
      userMessageId: 'message-4',
    }));

    expect(response.status).toBe(429);
    expect(askPublicDemo).not.toHaveBeenCalled();
    expect(askStorage.saveAskMessage).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      publicDemo: { messagesRemaining: 0, complete: true },
    });
  });

  it('releases a pending public-demo reservation when the Partner Agent fails', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'public-user',
      emailVerified: false,
      provider: 'anonymous',
      accessTier: 'public_demo',
    });
    askStorage.getPublicDemoUsage.mockResolvedValue({
      userId: 'public-user',
      quickDemoProjectId: 'quick-project',
      askMessagesUsed: 0,
      askOperationIds: [],
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
      expiresAt: '2026-09-04T12:00:00.000Z',
    });
    askStorage.getProject.mockResolvedValue({ id: 'quick-project', title: 'Quick Demo', goal: 'Explore Gapwise', nodes: [], edges: [], sources: [] });
    vi.stubEnv('GAPSWISE_PUBLIC_DAILY_ASK_LIMIT', '30');
    vi.mocked(askPublicDemo).mockRejectedValueOnce(new AskAgentError('temporary', { stage: 'agent-unavailable' }));

    const response = await POST(jsonRequest({
      userId: 'public-user',
      message: 'Try this question',
      projectId: 'quick-project',
      chatId: 'chat-failure',
      userMessageId: 'message-failure',
    }));

    expect(response.status).toBe(503);
    expect(askStorage.completePublicDemoAsk).not.toHaveBeenCalled();
    expect(askStorage.releasePublicDemoAsk).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'ask:chat-failure:message-failure',
      reservationId: 'reservation-1',
    }));
  });

  it('returns a completed operation response without another agent call', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'public-user',
      emailVerified: false,
      provider: 'google',
      accessTier: 'public_demo',
    });
    askStorage.getPublicDemoUsage.mockResolvedValue({
      userId: 'public-user',
      quickDemoProjectId: 'quick-project',
      askMessagesUsed: 1,
      askOperationIds: ['ask:chat-complete:message-complete'],
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:01:00.000Z',
      expiresAt: '2026-09-04T12:00:00.000Z',
    });
    askStorage.getProject.mockResolvedValue({ id: 'quick-project', title: 'Quick Demo', goal: 'Explore Gapwise', nodes: [], edges: [], sources: [] });
    askStorage.getAskMessages.mockResolvedValue([{
      id: boundedId('ask_assistant', 'message-complete'),
      chatId: 'chat-complete',
      userId: 'public-user',
      projectId: 'quick-project',
      role: 'assistant',
      text: 'Saved response',
      sources: [],
      createdAt: '2026-08-28T12:01:00.000Z',
    }]);
    askStorage.getAskChats.mockResolvedValue([{
      id: 'chat-complete',
      userId: 'public-user',
      scopeType: 'project',
      projectId: 'quick-project',
      title: 'Completed question',
      adkSessionId: 'public-session',
      createdAt: '2026-08-28T12:00:00.000Z',
      updatedAt: '2026-08-28T12:01:00.000Z',
    }]);
    vi.stubEnv('GAPSWISE_PUBLIC_DAILY_ASK_LIMIT', '30');

    const response = await POST(jsonRequest({
      userId: 'public-user',
      message: 'Repeat the completed question',
      projectId: 'quick-project',
      chatId: 'chat-complete',
      userMessageId: 'message-complete',
      sessionId: 'public-session',
    }));

    expect(response.status).toBe(200);
    expect(askPublicDemo).not.toHaveBeenCalled();
    expect(askStorage.reservePublicDemoAsk).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      answer: 'Saved response',
      publicDemo: { messagesRemaining: 2 },
    });
  });

  it('returns the real ADK Ask result payload', async () => {
    vi.mocked(askGapswise).mockResolvedValue({
      answer: 'Focus on the target-persona decision.',
      sessionId: 'session_123',
      execution: { route: 'web_research', agent: 'Web Research Agent', toolCalls: ['google_search'] },
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
      execution: { route: 'web_research', agent: 'Web Research Agent', toolCalls: ['google_search'] },
      modelConfig: expect.objectContaining({
        provider: 'Vertex AI / Google ADK',
        agent: 'Web Research Agent',
        model: 'gemini-3.5-flash-lite',
        thinkingLevel: 'low',
        maxOutputTokens: 1024,
        retryAttempts: 3,
        execution: 'Used',
      }),
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

  it('passes the saved message and generated source exclusions to Context Pack retrieval', async () => {
    vi.mocked(askGapswise).mockResolvedValue({
      answer: 'The current answer.',
      sessionId: 'session_123',
      sources: [],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'What is the MiniDV format?',
      chatId: 'chat_1',
      userMessageId: 'message_1',
      projectId: 'project_a',
    }));

    expect(response.status).toBe(200);
    expect(askGapswise).toHaveBeenCalledWith(expect.objectContaining({
      excludeMessageId: 'message_1',
      excludeSourceId: 'ask_chat_1_message_1',
    }));
  });

  it('persists user context but does not promote the assistant exploration into context', async () => {
    vi.mocked(askGapswise).mockResolvedValue({
      answer: 'Would a monthly gathering feel more manageable for a first trial run?',
      outcome: 'exploration',
      sessionId: 'session_breakfast',
      sources: [],
    });
    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'I am unsure whether the Sunday community breakfast should be weekly or monthly. What should I focus on first?',
      chatId: 'chat_breakfast',
      userMessageId: 'message_breakfast',
      projectId: 'project_breakfast',
    }));

    expect(response.status).toBe(200);
    expect(persistAskConversationContext).toHaveBeenCalledOnce();
    expect(persistAskConversationContext).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message_breakfast',
      text: expect.stringContaining('Sunday community breakfast'),
    }));
    expect(persistAskConversationContext).not.toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Would a monthly gathering'),
    }));
    expect(askStorage.saveAskMessage).toHaveBeenLastCalledWith('demo-user', expect.objectContaining({
      role: 'assistant',
      outcome: 'exploration',
      text: expect.stringContaining('Would a monthly gathering'),
    }));
  });

  it('returns AI-derived proposals as pending metadata instead of persisting them as project context', async () => {
    vi.mocked(askGapswise).mockResolvedValue({
      answer: 'The delayed supplier confirmation may affect the schedule.',
      outcome: 'exploration',
      sessionId: 'session_proposal',
      sources: [],
      contextProposals: [{
        type: 'UNKNOWN',
        text: 'Whether the supplier can deliver by Friday.',
        reasoning: 'The answer could change the launch sequence.',
        status: 'OPEN',
      }],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'What happens if the supplier misses Friday?',
      chatId: 'chat_proposal',
      userMessageId: 'message_proposal',
      projectId: 'project_proposal',
    }));

    expect(response.status).toBe(200);
    expect(persistAskConversationContext).toHaveBeenCalledOnce();
    const assistantId = boundedId('ask_assistant', 'message_proposal');
    const proposalId = boundedId('proposal', `${assistantId}_UNKNOWN_Whether the supplier can deliver by Friday.`);
    expect(askStorage.saveAskMessage).toHaveBeenLastCalledWith('demo-user', expect.objectContaining({
      role: 'assistant',
      proposals: [expect.objectContaining({
        id: proposalId,
        status: 'OPEN',
        confirmationStatus: 'pending',
        sourceMessageId: assistantId,
      })],
    }));
    await expect(response.json()).resolves.toMatchObject({
      contextProposals: [expect.objectContaining({
        type: 'UNKNOWN',
        text: 'Whether the supplier can deliver by Friday.',
        status: 'OPEN',
        confirmationStatus: 'pending',
      })],
    });
  });

  it('persists the originating Ask target on a new chat', async () => {
    vi.mocked(askGapswise).mockResolvedValue({
      answer: 'Let us compare the options.',
      sessionId: 'session_decision',
      sources: [],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'Help me think through this decision.',
      chatId: 'chat_decision',
      userMessageId: 'message_decision',
      projectId: 'project_a',
      target: {
        type: 'decision',
        id: 'decision_windows',
        text: 'Decide whether to clean the upstairs windows alone.',
      },
    }));

    expect(response.status).toBe(200);
    expect(askStorage.saveAskChat).toHaveBeenCalledWith('demo-user', expect.objectContaining({
      id: 'chat_decision',
      target: {
        type: 'decision',
        id: 'decision_windows',
        text: 'Decide whether to clean the upstairs windows alone.',
      },
    }));
  });

  it('uses a local context response when the ADK agent is unavailable', async () => {
    vi.mocked(askGapswise).mockRejectedValue(new AskAgentError('ADK run failed with status 503.'));
    vi.mocked(askGapswiseLocally).mockResolvedValue({
      answer: '## Local context\n\nFocus on the unresolved decision.',
      sessionId: 'local_fallback_session',
      sources: [],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'What should I focus on?',
      projectId: 'project_hackathon',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      answer: expect.stringContaining('Focus on the unresolved decision.'),
      generatedBy: 'local-fallback',
      modelConfig: expect.objectContaining({
        provider: 'Deterministic local response',
        agent: 'Local demo Ask',
        model: 'gemini-3.5-flash-lite',
        execution: 'Simulated fixture; no Gemini/ADK call was made',
      }),
      sessionId: 'local_fallback_session',
    });
    expect(askGapswiseLocally).toHaveBeenCalledWith({
      userId: 'demo-user',
      message: 'What should I focus on?',
      projectId: 'project_hackathon',
    });
  });

  it('does not use local context when ADK routing fails', async () => {
    vi.mocked(askGapswise).mockRejectedValue(new AskAgentError('ADK routing failed.', { stage: 'routing' }));
    vi.mocked(askGapswiseLocally).mockResolvedValue({
      answer: 'This local answer must not be returned.',
      sessionId: 'local_fallback_session',
      sources: [],
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'Search online for the current format specification.',
      projectId: 'project_hackathon',
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'External verification failed: the request could not be routed safely.',
    });
    expect(askGapswiseLocally).not.toHaveBeenCalled();
  });

  it('rejects invalid requests', async () => {
    const response = await POST(jsonRequest({ userId: 'demo-user', message: '' }));

    expect(response.status).toBe(400);
    expect(askGapswise).not.toHaveBeenCalled();
  });

  it.each([
    { projectId: 'project_b', sessionId: 'session_a', message: 'project scope mismatch', status: 403, code: 'PERMISSION_DENIED' },
    { projectId: 'project_a', sessionId: 'session_b', message: 'ADK session mismatch', status: 400, code: 'VALIDATION_ERROR' },
  ])('rejects an existing chat with a $message', async ({ projectId, sessionId, status, code }) => {
    askStorage.getAskChats.mockResolvedValue([{
      id: 'chat_1',
      userId: 'demo-user',
      scopeType: 'project',
      projectId: 'project_a',
      title: 'Existing chat',
      adkSessionId: 'session_a',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    }]);

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      message: 'Continue this chat',
      chatId: 'chat_1',
      userMessageId: 'message_1',
      projectId,
      sessionId,
    }));

    expect(response.status).toBe(status);
    expect(askGapswise).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ code });
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
