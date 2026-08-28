import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DEFAULT_USER_PROFILE, createGoldenDemoProject } from '@/lib/demo/seed';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUserId: vi.fn(),
  loadUserMemoryProfile: vi.fn(),
  loadDurableMemories: vi.fn(),
  replaceDurableMemories: vi.fn(),
  saveUserMemoryProfile: vi.fn(),
  getStorageProvider: vi.fn(),
  scheduleAskSuggestionsRefresh: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedUserId: mocks.requireAuthenticatedUserId,
}));
vi.mock('@/lib/memory/serverStore', () => ({
  loadUserMemoryProfile: mocks.loadUserMemoryProfile,
  loadDurableMemories: mocks.loadDurableMemories,
  replaceDurableMemories: mocks.replaceDurableMemories,
  saveUserMemoryProfile: mocks.saveUserMemoryProfile,
}));
vi.mock('@/lib/storage', () => ({
  getStorageProvider: mocks.getStorageProvider,
}));
vi.mock('@/lib/ask/suggestionsScheduler', () => ({
  scheduleAskSuggestionsRefresh: mocks.scheduleAskSuggestionsRefresh,
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/memory', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedUserId.mockResolvedValue('memory-user');
    mocks.loadUserMemoryProfile.mockResolvedValue(DEFAULT_USER_PROFILE);
    mocks.loadDurableMemories.mockResolvedValue([]);
    mocks.saveUserMemoryProfile.mockImplementation(async (_userId: string, profile: typeof DEFAULT_USER_PROFILE) => profile);
    mocks.replaceDurableMemories.mockResolvedValue([]);
    mocks.scheduleAskSuggestionsRefresh.mockResolvedValue(undefined);
  });

  it('marks all workspaces stale but schedules one nonblocking refresh for the active workspace', async () => {
    const active = createGoldenDemoProject();
    active.id = 'active-workspace';
    active.semantic_version = 'active-v1';
    const other = createGoldenDemoProject();
    other.id = 'other-workspace';
    other.semantic_version = 'other-v1';
    const markAskSuggestionsStale = vi.fn().mockResolvedValue(undefined);
    mocks.getStorageProvider.mockReturnValue({
      listProjects: vi.fn().mockResolvedValue([active, other]),
      getActiveProjectId: vi.fn().mockResolvedValue(active.id),
      markAskSuggestionsStale,
    });

    const response = await POST(request({
      userId: 'memory-user',
      memories: [],
      profile: { answer_density: 'detailed' },
    }));

    expect(response.status).toBe(200);
    expect(markAskSuggestionsStale).toHaveBeenCalledTimes(2);
    expect(markAskSuggestionsStale).toHaveBeenCalledWith('memory-user', active.id, 'active-v1');
    expect(markAskSuggestionsStale).toHaveBeenCalledWith('memory-user', other.id, 'other-v1');
    expect(mocks.scheduleAskSuggestionsRefresh).toHaveBeenCalledOnce();
    expect(mocks.scheduleAskSuggestionsRefresh).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'memory-user',
      project: active,
      profile: expect.objectContaining({ answer_density: 'detailed' }),
    }));
  });

  it('does not schedule a refresh when the saved profile and memories are unchanged', async () => {
    const response = await POST(request({
      userId: 'memory-user',
      memories: [],
    }));

    expect(response.status).toBe(200);
    expect(mocks.getStorageProvider).not.toHaveBeenCalled();
    expect(mocks.scheduleAskSuggestionsRefresh).not.toHaveBeenCalled();
  });
});
