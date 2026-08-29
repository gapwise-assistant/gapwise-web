import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageError } from '@/lib/storage/types';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { createSoftwareReleaseDemoForUser } from '@/lib/demo/softwareReleaseDemo';
import { POST } from './route';

vi.mock('@/lib/auth/server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/server')>('@/lib/auth/server');
  return {
    ...actual,
    requireAuthenticatedPrincipal: vi.fn(),
  };
});

vi.mock('@/lib/demo/softwareReleaseDemo', () => ({
  createSoftwareReleaseDemoForUser: vi.fn(),
}));

function request(): NextRequest {
  return new NextRequest('https://gapwise.web.app/api/demos/software-release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'client-value' }),
  });
}

describe('POST /api/demos/software-release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSoftwareReleaseDemoForUser).mockResolvedValue({ project: { id: 'relaydesk-project' } } as never);
  });

  it('allows the verified owner and uses the authenticated UID', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'owner-uid',
      email: 'martelaxe@gmail.com',
      emailVerified: true,
      provider: 'google',
      accessTier: 'owner',
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(createSoftwareReleaseDemoForUser).toHaveBeenCalledWith({ userId: 'owner-uid' });
  });

  it('allows local development access', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'local-user',
      emailVerified: false,
      provider: 'local',
      accessTier: 'local_development',
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(createSoftwareReleaseDemoForUser).toHaveBeenCalledWith({ userId: 'local-user' });
  });

  it('rejects public-demo accounts', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockResolvedValue({
      uid: 'public-user',
      emailVerified: false,
      provider: 'anonymous',
      accessTier: 'public_demo',
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(createSoftwareReleaseDemoForUser).not.toHaveBeenCalled();
  });

  it('rejects guests before demo creation', async () => {
    vi.mocked(requireAuthenticatedPrincipal).mockRejectedValue(
      new StorageError('Sign in is required.', 'UNAUTHENTICATED'),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(createSoftwareReleaseDemoForUser).not.toHaveBeenCalled();
  });
});
