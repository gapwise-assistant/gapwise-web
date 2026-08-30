import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageError } from '@/lib/storage/types';

const { requireAuthenticatedUserId } = vi.hoisted(() => ({
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedPrincipal: vi.fn(),
  requireAuthenticatedUserId,
}));

import { PATCH } from './route';

describe('/api/projects public-demo mutation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps workspace selection PATCH forbidden for public-demo users', async () => {
    requireAuthenticatedUserId.mockRejectedValue(
      new StorageError('This account cannot manage workspaces.', 'PERMISSION_DENIED'),
    );

    const response = await PATCH(new NextRequest('http://localhost/api/projects', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'public-demo-user', activeProjectId: 'quick-demo' }),
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
