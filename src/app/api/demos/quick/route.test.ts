import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { createQuickDemoForUser } from '@/lib/demo/quickDemo';
import { requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { POST } from './route';

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/demo/quickDemo', () => ({
  createQuickDemoForUser: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  requireFirestoreStorage: vi.fn(),
}));

const storage = {
  getAppScope: vi.fn(),
};

describe('POST /api/demos/quick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('authenticated-user');
    vi.mocked(requireFirestoreStorage).mockReturnValue(storage as never);
    storage.getAppScope.mockResolvedValue({ type: 'project', projectId: 'existing-project' });
    vi.mocked(createQuickDemoForUser).mockResolvedValue({
      project: { id: 'quick-project' },
      projects: [],
      activeProjectId: 'quick-project',
      scope: { type: 'project', projectId: 'quick-project' },
      created: true,
      snapshotCount: 2,
      historyEventCount: 2,
      finalNodeCount: 10,
      finalEdgeCount: 9,
      assessmentStatus: { focus: 'ready', overview: 'ready', askSuggestions: 'ready' },
    } as never);
  });

  it('uses the authenticated user and the Firestore provider', async () => {
    const response = await POST(new Request('https://gapwise.web.app/api/demos/quick', {
      method: 'POST',
      headers: { authorization: 'Bearer firebase-token', 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'untrusted-client-value' }),
    }));

    expect(response.status).toBe(201);
    expect(requireAuthenticatedUserId).toHaveBeenCalledWith(expect.any(Request), 'untrusted-client-value');
    expect(createQuickDemoForUser).toHaveBeenCalledWith({ userId: 'authenticated-user', storage });
  });

  it('does not create a demo when durable Firestore storage is unavailable', async () => {
    vi.mocked(requireFirestoreStorage).mockImplementation(() => {
      throw new StorageError('mock storage', 'CONFIGURATION_ERROR');
    });

    const response = await POST(new Request('https://gapwise.web.app/api/demos/quick', { method: 'POST' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Quick Gapwise demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.',
      code: 'CONFIGURATION_ERROR',
    });
    expect(createQuickDemoForUser).not.toHaveBeenCalled();
  });
});
