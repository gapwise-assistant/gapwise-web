import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { getStorageProvider, listProjects } from '@/lib/storage';
import { StorageProvider } from '@/lib/storage/types';
import { answerQuestion } from '@/lib/questions/answerQuestion';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/questions/answerQuestion', () => ({ answerQuestion: vi.fn() }));

vi.mock('@/lib/storage', () => ({
  getStorageProvider: vi.fn(),
  listProjects: vi.fn(),
  loadGeneralContext: vi.fn(),
}));

const storage = {
  getAskChats: vi.fn(),
  getAskMessages: vi.fn(),
  getAskResearch: vi.fn(),
  saveAskResearch: vi.fn(),
};

const chat = {
  id: 'chat_1',
  userId: 'demo-user',
  scopeType: 'project' as const,
  projectId: 'project_a',
  title: 'Research chat',
  adkSessionId: 'session_1',
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

const webAssistantMessage = {
  id: 'assistant_1',
  chatId: 'chat_1',
  userId: 'demo-user',
  projectId: 'project_a',
  role: 'assistant' as const,
  text: 'A researched answer.',
  sources: [{
    id: 'web_1',
    title: 'Example source',
    excerpt: 'Supporting result.',
    kind: 'web' as const,
    url: 'https://example.com/result',
    retrievedAt: '2026-08-20T10:01:00.000Z',
  }],
  createdAt: '2026-08-20T10:01:00.000Z',
};

const nonWebAssistantMessage = {
  id: 'assistant_non_web',
  chatId: 'chat_1',
  userId: 'demo-user',
  projectId: 'project_a',
  role: 'assistant' as const,
  text: 'An internal context suggestion.',
  sources: [{
    id: 'source_1',
    title: 'Internal doc',
    excerpt: 'Context note.',
    kind: 'source' as const,
  }],
  createdAt: '2026-08-20T10:01:00.000Z',
};

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/ask/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ask/research', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('demo-user');
    vi.mocked(getStorageProvider).mockReturnValue(storage as unknown as StorageProvider);
    storage.getAskChats.mockResolvedValue([chat]);
    storage.getAskMessages.mockResolvedValue([webAssistantMessage, nonWebAssistantMessage]);
    storage.getAskResearch.mockResolvedValue([]);
    storage.saveAskResearch.mockResolvedValue(undefined);
    vi.mocked(answerQuestion).mockResolvedValue({} as never);
  });

  it('persists Save as context with user_confirmed_ai_response for non-web responses', async () => {
    const response = await POST(jsonRequest({
      userId: 'demo-user',
      action: 'save_as_context',
      chatId: 'chat_1',
      assistantMessageId: 'assistant_non_web',
      projectId: 'project_a',
      text: 'Save this reviewed conclusion as context.',
    }));

    expect(response.status).toBe(200);
    expect(storage.saveAskResearch).toHaveBeenCalledWith('demo-user', expect.objectContaining({
      action: 'save_as_context',
      assistantMessageId: 'assistant_non_web',
      provenance: 'user_confirmed_ai_response',
    }));
  });

  it('allows Use as my answer for non-web responses without requiring web sources', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 'project_a', nodes: [{ id: 'question_1', text: 'Question 1?', type: 'UNKNOWN', status: 'OPEN' }] },
    ] as never);

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      action: 'use_as_answer',
      chatId: 'chat_1',
      assistantMessageId: 'assistant_non_web',
      projectId: 'project_a',
      targetQuestionId: 'question_1',
      text: 'Non-web confirmed answer.',
    }));

    expect(response.status).toBe(200);
    expect(storage.saveAskResearch).toHaveBeenCalledWith('demo-user', expect.objectContaining({
      action: 'use_as_answer',
      targetQuestionId: 'question_1',
      provenance: 'user_confirmed_ai_response',
      status: 'confirmed',
    }));
    expect(answerQuestion).toHaveBeenCalledWith({
      userId: 'demo-user',
      nodeId: 'question_1',
      answer: 'Non-web confirmed answer.',
      projectId: 'project_a',
    });
  });

  it('rejects Save research when response has no web sources', async () => {
    const response = await POST(jsonRequest({
      userId: 'demo-user',
      action: 'save',
      chatId: 'chat_1',
      assistantMessageId: 'assistant_non_web',
      projectId: 'project_a',
      text: 'Attempt to save unsourced research.',
    }));

    expect(response.status).toBe(400);
    expect(storage.saveAskResearch).not.toHaveBeenCalled();
  });

  it('persists Save research with assistant_web_research_confirmed_by_user when web sources exist', async () => {
    const response = await POST(jsonRequest({
      userId: 'demo-user',
      action: 'save',
      chatId: 'chat_1',
      assistantMessageId: 'assistant_1',
      projectId: 'project_a',
      text: 'Save this researched conclusion.',
    }));

    expect(response.status).toBe(200);
    expect(storage.saveAskResearch).toHaveBeenCalledWith('demo-user', expect.objectContaining({
      action: 'save',
      assistantMessageId: 'assistant_1',
      provenance: 'assistant_web_research_confirmed_by_user',
    }));
  });

  it('recovers pending Use as my answer without web sources', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 'project_a', nodes: [{ id: 'question_1', type: 'UNKNOWN', status: 'OPEN' }] },
    ] as never);
    storage.saveAskResearch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('The confirmed research write failed.'));

    const firstResponse = await POST(jsonRequest({
      userId: 'demo-user',
      action: 'use_as_answer',
      chatId: 'chat_1',
      assistantMessageId: 'assistant_non_web',
      projectId: 'project_a',
      targetQuestionId: 'question_1',
      text: 'Recover non-web answer.',
    }));

    expect(firstResponse.status).toBe(500);
    const pendingRecord = storage.saveAskResearch.mock.calls[0][1];
    expect(pendingRecord).toMatchObject({ status: 'pending', provenance: 'user_confirmed_ai_response' });

    storage.getAskResearch.mockResolvedValue([pendingRecord]);
    storage.saveAskResearch.mockResolvedValue(undefined);
    vi.mocked(listProjects).mockResolvedValue([
      {
        id: 'project_a',
        nodes: [{ id: 'question_1', text: 'Question 1?', type: 'UNKNOWN', status: 'RESOLVED' }],
        history: [{
          question: 'Question 1?',
          answer: 'Recover non-web answer.',
          timestamp: '2026-08-20T10:02:00.000Z',
          graph_diff_summary: 'Resolved "Question 1?" -> KNOWN: "Recover non-web answer."',
        }],
      },
    ] as never);

    const retryResponse = await POST(jsonRequest({
      userId: 'demo-user',
      action: 'use_as_answer',
      chatId: 'chat_1',
      assistantMessageId: 'assistant_non_web',
      projectId: 'project_a',
      targetQuestionId: 'question_1',
      text: 'Recover non-web answer.',
    }));

    expect(retryResponse.status).toBe(200);
    expect(storage.saveAskResearch).toHaveBeenLastCalledWith('demo-user', expect.objectContaining({ status: 'confirmed' }));
  });
});
