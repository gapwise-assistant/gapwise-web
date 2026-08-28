import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { askSuggestionsProjectStateVersionFromSemanticVersion } from '@/lib/ask/suggestionsCache';
import type { StorageProvider } from '@/lib/storage/types';
import { getStorageProvider } from '@/lib/storage';
import { GET, POST } from './route';

vi.mock('@/lib/storage', () => ({
  getStorageProvider: vi.fn(),
}));

const storage = {
  getProjectSemanticVersion: vi.fn(),
  getLatestAskSuggestionsCache: vi.fn(),
  getUserMemoryProfile: vi.fn(),
  getMemories: vi.fn(),
  getProject: vi.fn(),
};

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/ask/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Ask suggestions read route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStorageProvider).mockReturnValue(storage as unknown as StorageProvider);
    storage.getProjectSemanticVersion.mockResolvedValue('semantic-project-v1');
    storage.getUserMemoryProfile.mockResolvedValue(null);
    storage.getMemories.mockResolvedValue([]);
    storage.getLatestAskSuggestionsCache.mockResolvedValue(null);
  });

  it('returns the saved project assessment without invoking generation', async () => {
    const semanticVersion = await askSuggestionsProjectStateVersionFromSemanticVersion(
      'semantic-project-v1',
      DEFAULT_USER_PROFILE,
      [],
    );
    storage.getLatestAskSuggestionsCache.mockResolvedValue({
      id: 'assessment-1',
      userId: 'demo-user',
      projectId: 'workspace-1',
      scopeKey: 'project:workspace-1',
      projectStateVersion: semanticVersion,
      semanticProjectVersion: 'semantic-project-v1',
      topQuestions: ['Which supplier date is confirmed?'],
      otherQuestions: ['What can wait?'],
      generatedBy: 'gapswise-agent',
      createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-28T10:00:01.000Z',
      status: 'ready',
    });

    const response = await GET(new Request('http://localhost/api/ask/suggestions?userId=demo-user&projectId=workspace-1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      topQuestions: ['Which supplier date is confirmed?'],
      otherQuestions: ['What can wait?'],
      projectId: 'workspace-1',
      semanticVersion,
      generatedAt: '2026-08-28T10:00:01.000Z',
      status: 'ready',
      cached: true,
      generatedBy: 'gapswise-agent',
    });
    expect(storage.getLatestAskSuggestionsCache).toHaveBeenCalledWith('demo-user', 'workspace-1');
    expect(storage.getProject).not.toHaveBeenCalled();
  });

  it('returns a preparing state without a cache and never generates on open', async () => {
    const response = await POST(jsonRequest({ userId: 'demo-user', projectId: 'workspace-1' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      topQuestions: [],
      otherQuestions: [],
      projectId: 'workspace-1',
      status: 'preparing',
      cached: true,
    });
  });

  it('marks an older assessment stale without regenerating it', async () => {
    storage.getLatestAskSuggestionsCache.mockResolvedValue({
      id: 'assessment-old',
      userId: 'demo-user',
      projectId: 'workspace-1',
      scopeKey: 'project:workspace-1',
      projectStateVersion: 'old-version',
      semanticProjectVersion: 'old-project-version',
      topQuestions: ['Old question?'],
      otherQuestions: [],
      generatedBy: 'gapswise-agent',
      createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-28T10:00:01.000Z',
      status: 'ready',
    });

    const response = await POST(jsonRequest({ userId: 'demo-user', projectId: 'workspace-1' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      topQuestions: ['Old question?'],
      status: 'stale',
      cached: true,
    });
  });

  it.each(['preparing', 'failed'] as const)('preserves a matching %s assessment status and previous questions', async (status) => {
    storage.getLatestAskSuggestionsCache.mockResolvedValue({
      id: `assessment-${status}`,
      userId: 'demo-user',
      projectId: 'workspace-1',
      scopeKey: 'project:workspace-1',
      projectStateVersion: 'published-input-v1',
      semanticProjectVersion: 'semantic-project-v1',
      requestedSemanticProjectVersion: 'semantic-project-v1',
      topQuestions: ['Previous question?'],
      otherQuestions: [],
      generatedBy: 'gapswise-agent',
      createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-28T10:00:01.000Z',
      ...(status === 'preparing'
        ? {
          generationStartedAt: new Date().toISOString(),
          generationLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        }
        : {}),
      status,
    });

    const response = await GET(new Request('http://localhost/api/ask/suggestions?userId=demo-user&projectId=workspace-1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      topQuestions: ['Previous question?'],
      status,
    });
  });

  it('reports an expired preparing lease as stale without generating suggestions', async () => {
    storage.getLatestAskSuggestionsCache.mockResolvedValue({
      id: 'assessment-expired',
      userId: 'demo-user',
      projectId: 'workspace-1',
      scopeKey: 'project:workspace-1',
      projectStateVersion: 'published-input-v1',
      semanticProjectVersion: 'semantic-project-v1',
      requestedSemanticProjectVersion: 'semantic-project-v1',
      generationId: 'generation-expired',
      generationLeaseExpiresAt: '2020-01-01T00:00:00.000Z',
      topQuestions: ['Previous question?'],
      otherQuestions: [],
      generatedBy: 'gapswise-agent',
      createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-28T10:00:01.000Z',
      status: 'preparing',
    });

    const response = await GET(new Request('http://localhost/api/ask/suggestions?userId=demo-user&projectId=workspace-1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      topQuestions: ['Previous question?'],
      status: 'stale',
      cached: true,
    });
  });

  it('requires an explicit project id and does not fall back to Everything', async () => {
    const response = await POST(jsonRequest({ userId: 'demo-user' }));

    expect(response.status).toBe(400);
    expect(storage.getProjectSemanticVersion).not.toHaveBeenCalled();
  });

  it('returns not found for a project outside the user scope', async () => {
    storage.getProjectSemanticVersion.mockResolvedValue(null);

    const response = await POST(jsonRequest({ userId: 'demo-user', projectId: 'missing-workspace' }));

    expect(response.status).toBe(404);
    expect(storage.getLatestAskSuggestionsCache).not.toHaveBeenCalled();
  });
});
