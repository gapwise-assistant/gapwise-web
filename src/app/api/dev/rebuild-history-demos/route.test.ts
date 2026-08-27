import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { requireFirestoreStorage } from '@/lib/storage';
import {
  DESTRUCTIVE_HISTORY_RESET_CONFIRMATION,
  getLocalHistoryResetPreview,
  rebuildHistoryDemosForUser,
} from '@/lib/demo/rebuildHistoryDemos';

vi.mock('@/lib/runtime/demoMode', () => ({ isLocalhostRequest: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireAuthenticatedUserId: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  FIRESTORE_REQUIRED_MESSAGE: 'Harbor History Demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.',
  requireFirestoreStorage: vi.fn(),
}));
vi.mock('@/lib/demo/rebuildHistoryDemos', () => ({
  DESTRUCTIVE_HISTORY_RESET_CONFIRMATION: 'DELETE_MY_LOCAL_DATA_AND_REBUILD_DEMOS',
  getLocalHistoryResetPreview: vi.fn(),
  rebuildHistoryDemosForUser: vi.fn(),
}));

function request(url = 'http://localhost:3000/api/dev/rebuild-history-demos', body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('localhost history rebuild route', () => {
  let storage: { getAppScope: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLocalhostRequest).mockReturnValue(true);
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('local-user');
    storage = {
      getAppScope: vi.fn().mockResolvedValue({ type: 'everything' }),
    };
    vi.mocked(requireFirestoreStorage).mockReturnValue(storage as never);
  });

  it('returns 404 outside localhost before authenticating or mutating', async () => {
    vi.mocked(isLocalhostRequest).mockReturnValue(false);

    const response = await POST(request('https://preview.gapwise.example/api/dev/rebuild-history-demos', {
      confirm: DESTRUCTIVE_HISTORY_RESET_CONFIRMATION,
    }));

    expect(response.status).toBe(404);
    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
    expect(rebuildHistoryDemosForUser).not.toHaveBeenCalled();
  });

  it('requires the exact destructive confirmation', async () => {
    const response = await POST(request(undefined, { confirm: 'DELETE_EVERYTHING' }));

    expect(response.status).toBe(400);
    expect(rebuildHistoryDemosForUser).not.toHaveBeenCalled();
  });

  it('does not accept a target user or any extra reset fields', async () => {
    const response = await POST(request(undefined, {
      confirm: DESTRUCTIVE_HISTORY_RESET_CONFIRMATION,
      userId: 'another-user',
    }));

    expect(response.status).toBe(400);
    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
    expect(rebuildHistoryDemosForUser).not.toHaveBeenCalled();
  });

  it('loads a user-scoped Firestore preview without starting a reset', async () => {
    vi.mocked(getLocalHistoryResetPreview).mockResolvedValue({
      projects: 2,
      snapshots: 8,
      askChats: 1,
      askMessages: 3,
      sources: 5,
      cloudObjects: 5,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ preview: {
      projects: 2,
      snapshots: 8,
      askChats: 1,
      askMessages: 3,
      sources: 5,
      cloudObjects: 5,
    } });
    expect(getLocalHistoryResetPreview).toHaveBeenCalledWith(storage, 'local-user');
    expect(rebuildHistoryDemosForUser).not.toHaveBeenCalled();
  });

  it('passes only the authenticated user and Firestore provider to one rebuild', async () => {
    vi.mocked(rebuildHistoryDemosForUser).mockResolvedValue({
      deleted: { projects: 1, snapshots: 2, askChats: 1, askMessages: 2, sources: 2, cloudObjects: 2, cloudDeletionFailures: [] },
      harbor: null,
      riverside: null,
      projects: [],
      scope: { type: 'everything' },
      partialFailures: [],
    } as never);

    const response = await POST(request(undefined, { confirm: DESTRUCTIVE_HISTORY_RESET_CONFIRMATION }));

    expect(response.status).toBe(200);
    expect(requireAuthenticatedUserId).toHaveBeenCalledWith(expect.any(NextRequest));
    expect(rebuildHistoryDemosForUser).toHaveBeenCalledWith({ storage, userId: 'local-user' });
    expect(rebuildHistoryDemosForUser).toHaveBeenCalledTimes(1);
  });
});
