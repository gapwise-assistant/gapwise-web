import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { getStorageProvider } from '@/lib/storage';
import { StorageProvider } from '@/lib/storage/types';

vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn() }));

const storage = {
  getAskChats: vi.fn(),
  getAskMessages: vi.fn(),
  getAskResearch: vi.fn(),
  saveAskChat: vi.fn(),
};

describe('GET /api/ask/chats', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getStorageProvider).mockReturnValue(storage as unknown as StorageProvider);
  });

  it('returns research records alongside chat history for reload state', async () => {
    storage.getAskChats.mockResolvedValue([{
      id: 'chat_1',
      userId: 'demo-user',
      scopeType: 'project',
      projectId: 'project_a',
      title: 'Research chat',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:01:00.000Z',
    }]);
    storage.getAskMessages.mockResolvedValue([]);
    storage.getAskResearch.mockResolvedValue([{
      id: 'research_1',
      userId: 'demo-user',
      chatId: 'chat_1',
      assistantMessageId: 'assistant_1',
      projectId: 'project_a',
      text: 'Saved conclusion.',
      sources: [],
      retrievedAt: '2026-08-20T10:00:00.000Z',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
      action: 'use_as_answer',
      targetQuestionId: 'question_1',
      provenance: 'assistant_web_research_confirmed_by_user',
    }]);

    const response = await GET(new Request('http://localhost/api/ask/chats?userId=demo-user&projectId=project_a'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      research: [{
        assistantMessageId: 'assistant_1',
        action: 'use_as_answer',
        targetQuestionId: 'question_1',
      }],
    });
  });

  it('loads a requested project chat by chatId even when projectId is not sent', async () => {
    storage.getAskChats.mockResolvedValue([
      {
        id: 'chat_project',
        userId: 'demo-user',
        scopeType: 'project',
        projectId: 'project_a',
        title: 'Project chat',
        createdAt: '2026-08-20T10:00:00.000Z',
        updatedAt: '2026-08-20T10:01:00.000Z',
      },
      {
        id: 'chat_other',
        userId: 'demo-user',
        scopeType: 'project',
        projectId: 'project_b',
        title: 'Other project chat',
        createdAt: '2026-08-20T10:00:00.000Z',
        updatedAt: '2026-08-20T10:02:00.000Z',
      },
    ]);
    storage.getAskMessages.mockResolvedValue([
      { id: 'message_project', chatId: 'chat_project', userId: 'demo-user', role: 'user', text: 'Restore me', sources: [], createdAt: '2026-08-20T10:00:00.000Z' },
      { id: 'message_other', chatId: 'chat_other', userId: 'demo-user', role: 'user', text: 'Do not restore me', sources: [], createdAt: '2026-08-20T10:00:00.000Z' },
    ]);
    storage.getAskResearch.mockResolvedValue([]);

    const response = await GET(new Request('http://localhost/api/ask/chats?userId=demo-user&chatId=chat_project'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      chats: [{ id: 'chat_project' }],
      messages: [{ id: 'message_project', chatId: 'chat_project' }],
    });
  });

  it('rejects rewriting an existing chat into another project scope', async () => {
    storage.getAskChats.mockResolvedValue([{
      id: 'chat_1',
      userId: 'demo-user',
      scopeType: 'project',
      projectId: 'project_a',
      title: 'Existing chat',
      adkSessionId: 'session_1',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    }]);

    const response = await POST(new Request('http://localhost/api/ask/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'demo-user',
        chat: {
          id: 'chat_1',
          scopeType: 'project',
          projectId: 'project_b',
          title: 'Moved chat',
        },
      }),
    }));

    expect(response.status).toBe(403);
    expect(storage.saveAskChat).not.toHaveBeenCalled();
  });
});
