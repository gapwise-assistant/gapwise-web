import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { POST } from './route';
import { askGapswiseLocally } from '@/lib/ask/localDemoAdapter';
import { getStorageProvider } from '@/lib/storage';
import { StorageProvider } from '@/lib/storage/types';
import { persistAskConversationContext } from '@/lib/ask/conversationContext';

vi.mock('@/lib/ask/adkClient', () => ({
  AskAgentError: class AskAgentError extends Error {
    stage?: string;

    constructor(message: string, options?: { stage?: string }) {
      super(message);
      this.stage = options?.stage;
    }
  },
  askGapswise: vi.fn(),
}));
vi.mock('@/lib/ask/localDemoAdapter', () => ({ askGapswiseLocally: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn() }));
vi.mock('@/lib/ask/conversationContext', () => ({ persistAskConversationContext: vi.fn() }));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const askStorage = {
  getAskChats: vi.fn(),
  saveAskChat: vi.fn(),
  saveAskMessage: vi.fn(),
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
    askStorage.getAskChats.mockResolvedValue([]);
    askStorage.saveAskChat.mockResolvedValue(undefined);
    askStorage.saveAskMessage.mockResolvedValue(undefined);
    vi.mocked(persistAskConversationContext).mockResolvedValue({
      sourceId: 'ask_chat_1_message_1',
      openQuestionIds: [],
      openQuestions: [],
    });
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
    expect(askStorage.saveAskMessage).toHaveBeenLastCalledWith('demo-user', expect.objectContaining({
      role: 'assistant',
      proposals: [expect.objectContaining({
        id: 'proposal_ask_assistant_message_proposal_0',
        status: 'OPEN',
        confirmationStatus: 'pending',
        sourceMessageId: 'ask_assistant_message_proposal',
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
