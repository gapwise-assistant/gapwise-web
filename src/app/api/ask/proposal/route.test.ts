import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { getStorageProvider } from '@/lib/storage';
import { persistAskProposal } from '@/lib/ask/conversationContext';
import { StorageProvider } from '@/lib/storage/types';

vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn() }));
vi.mock('@/lib/ask/conversationContext', () => ({ persistAskProposal: vi.fn() }));

const storage = {
  getAskChats: vi.fn(),
  getAskMessages: vi.fn(),
  saveAskMessage: vi.fn(),
};

const proposal = {
  id: 'proposal_1',
  type: 'UNKNOWN' as const,
  text: 'Whether the supplier can deliver the materials by Friday.',
  reasoning: 'This missing confirmation could change the project schedule.',
  status: 'OPEN' as const,
  sourceMessageId: 'assistant_1',
  confirmationStatus: 'proposed' as const,
};

function request(body: unknown): Request {
  return new Request('http://localhost/api/ask/proposal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ask/proposal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getStorageProvider).mockReturnValue(storage as unknown as StorageProvider);
    storage.getAskChats.mockResolvedValue([{
      id: 'chat_1',
      userId: 'demo-user',
      scopeType: 'project',
      projectId: 'project_1',
      title: 'Project chat',
      createdAt: '2026-08-24T10:00:00.000Z',
      updatedAt: '2026-08-24T10:00:00.000Z',
    }]);
    storage.getAskMessages.mockResolvedValue([{
      id: 'assistant_1',
      chatId: 'chat_1',
      userId: 'demo-user',
      projectId: 'project_1',
      role: 'assistant',
      text: 'There is a missing supplier confirmation.',
      sources: [],
      createdAt: '2026-08-24T10:01:00.000Z',
      proposals: [proposal],
    }]);
    storage.saveAskMessage.mockResolvedValue(undefined);
    vi.mocked(persistAskProposal).mockResolvedValue({} as never);
  });

  it('does not persist an AI-derived proposal until Add is selected', async () => {
    const response = await POST(request({
      userId: 'demo-user',
      action: 'dismiss',
      chatId: 'chat_1',
      projectId: 'project_1',
      assistantMessageId: 'assistant_1',
      proposalId: 'proposal_1',
    }));

    expect(response.status).toBe(200);
    expect(persistAskProposal).not.toHaveBeenCalled();
    expect(storage.saveAskMessage).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      proposal: expect.objectContaining({ id: 'proposal_1', confirmationStatus: 'proposed' }),
    });
  });

  it('persists the exact typed proposal only after Add is selected', async () => {
    const response = await POST(request({
      userId: 'demo-user',
      action: 'add',
      chatId: 'chat_1',
      projectId: 'project_1',
      assistantMessageId: 'assistant_1',
      proposalId: 'proposal_1',
    }));

    expect(response.status).toBe(200);
    expect(persistAskProposal).toHaveBeenCalledWith({
      userId: 'demo-user',
      projectId: 'project_1',
      assistantMessageId: 'assistant_1',
      proposal: expect.objectContaining({
        type: 'UNKNOWN',
        text: 'Whether the supplier can deliver the materials by Friday.',
        status: 'OPEN',
        confirmationStatus: 'added',
      }),
    });
    expect(storage.saveAskMessage).toHaveBeenCalledWith('demo-user', expect.objectContaining({
      contextProposals: [expect.objectContaining({ id: 'proposal_1', confirmationStatus: 'added' })],
    }));
  });
});
