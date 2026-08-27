import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { FIRESTORE_REQUIRED_MESSAGE, requireFirestoreStorage } from '@/lib/storage';
import { createRiversideHistoryDemoForUser } from '@/lib/demo/riversideHistory';

vi.mock('@/lib/runtime/demoMode', () => ({ isLocalhostRequest: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireAuthenticatedUserId: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  FIRESTORE_REQUIRED_MESSAGE: 'Harbor History Demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.',
  requireFirestoreStorage: vi.fn(),
}));
vi.mock('@/lib/demo/riversideHistory', () => ({ createRiversideHistoryDemoForUser: vi.fn() }));

function request(body: unknown = { fresh: true }, url = 'http://localhost/api/dev/riverside-history'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dev/riverside-history', () => {
  let storage: { getAppScope: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    storage = { getAppScope: vi.fn().mockResolvedValue({ type: 'everything' }) };
    vi.mocked(isLocalhostRequest).mockReturnValue(true);
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('local-user');
    vi.mocked(requireFirestoreStorage).mockReturnValue(storage as never);
  });

  it('rejects non-localhost requests', async () => {
    vi.mocked(isLocalhostRequest).mockReturnValue(false);

    const response = await POST(request(undefined, 'https://preview.gapwise.example/api/dev/riverside-history'));

    expect(response.status).toBe(404);
    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
    expect(createRiversideHistoryDemoForUser).not.toHaveBeenCalled();
  });

  it('fails before generation when Firestore is unavailable', async () => {
    vi.mocked(requireFirestoreStorage).mockImplementation(() => {
      throw new Error(FIRESTORE_REQUIRED_MESSAGE);
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: FIRESTORE_REQUIRED_MESSAGE });
    expect(createRiversideHistoryDemoForUser).not.toHaveBeenCalled();
  });

  it('authenticates and verifies Firestore before starting Riverside', async () => {
    vi.mocked(createRiversideHistoryDemoForUser).mockResolvedValue({ created: true } as never);

    const response = await POST(request({ userId: 'ignored-user', fresh: true }));

    expect(response.status).toBe(201);
    expect(requireAuthenticatedUserId).toHaveBeenCalledWith(expect.any(NextRequest), 'ignored-user');
    expect(storage.getAppScope).toHaveBeenCalledWith('local-user');
    expect(createRiversideHistoryDemoForUser).toHaveBeenCalledWith({ userId: 'local-user', fresh: true });
  });
});
