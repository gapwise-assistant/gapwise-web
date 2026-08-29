import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { createOrReuseQuickDemoForUser, createQuickDemoForUser } from '@/lib/demo/quickDemo';
import { getStorageProvider, requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { POST } from './route';
import { requirePublicDemoAppCheck } from '@/lib/auth/appCheck';

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedPrincipal: vi.fn(),
}));

vi.mock('@/lib/demo/quickDemo', () => ({
  createOrReuseQuickDemoForUser: vi.fn(),
  createQuickDemoForUser: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getStorageProvider: vi.fn(),
  requireFirestoreStorage: vi.fn(),
}));

vi.mock('@/lib/auth/appCheck', () => ({
  requirePublicDemoAppCheck: vi.fn(),
  PUBLIC_DEMO_APPCHECK_ERROR: 'The public demo is temporarily unavailable.',
}));

const storage = {
  getAppScope: vi.fn(),
};

describe('POST /api/demos/quick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'authenticated-user',
      emailVerified: true,
      provider: 'google',
      accessTier: 'owner',
    });
    vi.mocked(getStorageProvider).mockReturnValue(storage as never);
    vi.mocked(requireFirestoreStorage).mockReturnValue(storage as never);
    storage.getAppScope.mockResolvedValue({ type: 'project', projectId: 'existing-project' });
    vi.mocked(requirePublicDemoAppCheck).mockResolvedValue(undefined);
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
    expect(requireAuthenticatedPrincipal).toHaveBeenCalledWith(expect.any(Request), 'untrusted-client-value');
    expect(createQuickDemoForUser).toHaveBeenCalledWith({ userId: 'authenticated-user', storage });
  });

  it('requires durable Firestore storage for public-demo creation', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'public-user',
      emailVerified: false,
      provider: 'anonymous',
      accessTier: 'public_demo',
    });
    vi.mocked(requireFirestoreStorage).mockImplementation(() => {
      throw new StorageError('mock storage', 'CONFIGURATION_ERROR');
    });

    const response = await POST(new Request('https://gapwise.web.app/api/demos/quick', { method: 'POST' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Quick Gapwise demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.',
      code: 'CONFIGURATION_ERROR',
    });
    expect(createOrReuseQuickDemoForUser).not.toHaveBeenCalled();
    expect(createQuickDemoForUser).not.toHaveBeenCalled();
  });

  it('requires App Check before public-demo creation', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'public-user',
      emailVerified: false,
      provider: 'anonymous',
      accessTier: 'public_demo',
    });
    vi.mocked(requirePublicDemoAppCheck).mockRejectedValue(
      new StorageError('The public demo is temporarily unavailable.', 'PERMISSION_DENIED'),
    );

    const response = await POST(new Request('https://gapwise.web.app/api/demos/quick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(403);
    expect(createOrReuseQuickDemoForUser).not.toHaveBeenCalled();
  });
});
