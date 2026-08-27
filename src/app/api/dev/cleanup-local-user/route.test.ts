import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { requireFirestoreStorage } from '@/lib/storage';
import {
  cleanupLocalUserData,
  getLocalCleanupPreview,
} from '@/lib/demo/cleanupLocalUserData';

vi.mock('@/lib/runtime/demoMode', () => ({ isLocalhostRequest: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireAuthenticatedUserId: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  FIRESTORE_REQUIRED_MESSAGE: 'Harbor History Demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.',
  requireFirestoreStorage: vi.fn(),
}));
vi.mock('@/lib/demo/cleanupLocalUserData', () => ({
  LOCAL_DATA_CLEANUP_CONFIRMATION: 'DELETE MY LOCAL DATA',
  cleanupLocalUserData: vi.fn(),
  getLocalCleanupPreview: vi.fn(),
}));

function request(url = 'http://localhost:3000/api/dev/cleanup-local-user', body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('localhost cleanup-local-user route', () => {
  const previousFlag = process.env.ENABLE_DESTRUCTIVE_DEV_RESET;
  let storage: { getAppScope: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_DESTRUCTIVE_DEV_RESET = 'true';
    vi.mocked(isLocalhostRequest).mockReturnValue(true);
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('authenticated-user');
    storage = { getAppScope: vi.fn().mockResolvedValue({ type: 'everything' }) };
    vi.mocked(requireFirestoreStorage).mockReturnValue(storage as never);
  });

  afterEach(() => {
    if (previousFlag === undefined) delete process.env.ENABLE_DESTRUCTIVE_DEV_RESET;
    else process.env.ENABLE_DESTRUCTIVE_DEV_RESET = previousFlag;
  });

  it('requires the exact feature flag before authenticating', async () => {
    delete process.env.ENABLE_DESTRUCTIVE_DEV_RESET;

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
  });

  it('rejects non-localhost requests before any user-scoped operation', async () => {
    vi.mocked(isLocalhostRequest).mockReturnValue(false);

    const response = await POST(request('https://preview.gapwise.example/api/dev/cleanup-local-user', {
      confirm: 'DELETE MY LOCAL DATA',
    }));

    expect(response.status).toBe(404);
    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
    expect(cleanupLocalUserData).not.toHaveBeenCalled();
  });

  it('requires the exact confirmation and does not accept a client user id', async () => {
    const response = await POST(request(undefined, {
      confirm: 'DELETE MY LOCAL DATA',
      userId: 'someone-else',
    }));

    expect(response.status).toBe(400);
    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
    expect(cleanupLocalUserData).not.toHaveBeenCalled();
  });

  it('loads a Firestore preview for the authenticated user', async () => {
    vi.mocked(getLocalCleanupPreview).mockResolvedValue({
      projects: 2,
      sources: 4,
      cloudObjects: 3,
      askChats: 1,
      askMessages: 5,
      askResearch: 2,
      snapshots: 8,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ preview: {
      projects: 2,
      sources: 4,
      cloudObjects: 3,
      askChats: 1,
      askMessages: 5,
      askResearch: 2,
      snapshots: 8,
    } });
    expect(getLocalCleanupPreview).toHaveBeenCalledWith(storage, 'authenticated-user');
  });

  it('passes only the authenticated user and Firestore provider to cleanup', async () => {
    vi.mocked(cleanupLocalUserData).mockResolvedValue({
      deleted: {
        projects: 1,
        sources: 1,
        cloudObjects: 1,
        askChats: 1,
        askMessages: 1,
        askResearch: 1,
        snapshots: 1,
        cloudDeletionFailures: [],
      },
      partialFailures: [],
    });

    const response = await POST(request(undefined, { confirm: 'DELETE MY LOCAL DATA' }));

    expect(response.status).toBe(200);
    expect(requireAuthenticatedUserId).toHaveBeenCalledWith(expect.any(NextRequest));
    expect(cleanupLocalUserData).toHaveBeenCalledWith({ storage, userId: 'authenticated-user' });
  });
});
