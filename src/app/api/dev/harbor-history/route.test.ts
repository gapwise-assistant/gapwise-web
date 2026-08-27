import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createHarborHistoryDemoForUser } from '@/lib/demo/harborHistory';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { FIRESTORE_REQUIRED_MESSAGE, requireFirestoreStorage } from '@/lib/storage';

vi.mock('@/lib/runtime/demoMode', () => ({
  isLocalhostRequest: vi.fn(() => true),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  FIRESTORE_REQUIRED_MESSAGE: 'Harbor History Demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.',
  requireFirestoreStorage: vi.fn(),
}));

vi.mock('@/lib/demo/harborHistory', () => ({
  createHarborHistoryDemoForUser: vi.fn(),
}));

function request(body: unknown = { userId: 'harbor-user' }): NextRequest {
  return new NextRequest('http://localhost/api/dev/harbor-history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dev/harbor-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('harbor-user');
  });

  it('fails clearly without Firestore and does not start the generator', async () => {
    vi.mocked(requireFirestoreStorage).mockImplementation(() => {
      throw new Error(FIRESTORE_REQUIRED_MESSAGE);
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: FIRESTORE_REQUIRED_MESSAGE });
    expect(createHarborHistoryDemoForUser).not.toHaveBeenCalled();
  });

  it('starts the generator only after the Firestore capability check succeeds', async () => {
    vi.mocked(requireFirestoreStorage).mockReturnValue({
      getAppScope: vi.fn().mockResolvedValue({ type: 'everything' }),
    } as never);
    vi.mocked(createHarborHistoryDemoForUser).mockResolvedValue({ created: true } as never);

    const response = await POST(request({ userId: 'harbor-user', fresh: true }));

    expect(response.status).toBe(201);
    expect(createHarborHistoryDemoForUser).toHaveBeenCalledWith({ userId: 'harbor-user', fresh: true });
  });
});
