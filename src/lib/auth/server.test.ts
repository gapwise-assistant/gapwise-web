import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageError } from '@/lib/storage/types';
import { getFirebaseAdminAuth } from '@/lib/firebase-admin';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

vi.mock('@/lib/firebase-admin', () => ({
  getFirebaseAdminAuth: vi.fn(),
}));

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const originalInternalSecret = process.env.GAPSWISE_INTERNAL_API_SECRET;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('GAPSWISE_DEMO_MODE', originalDemoMode);
  restore('GAPSWISE_INTERNAL_API_SECRET', originalInternalSecret);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('server authentication boundary', () => {
  it('uses only the local demo identity in demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';

    await expect(requireAuthenticatedUserId(
      new Request('http://localhost/api/projects'),
      'arbitrary-client-user'
    )).resolves.toBe('demo-user');
  });

  it('accepts the private server-to-server secret for an ADK request', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    process.env.GAPSWISE_INTERNAL_API_SECRET = 'internal-test-secret';

    await expect(requireAuthenticatedUserId(
      new Request('http://localhost/api/internal/context-pack', {
        headers: { 'x-gapswise-internal-secret': 'internal-test-secret' },
      }),
      'firebase-user-123'
    )).resolves.toBe('firebase-user-123');
  });

  it('rejects a request without a verified token', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    vi.stubEnv('NODE_ENV', 'production');

    await expect(requireAuthenticatedUserId(
      new Request('http://localhost/api/projects'),
      'firebase-user-123'
    )).rejects.toMatchObject({ code: 'UNAUTHENTICATED' } satisfies Partial<StorageError>);
  });

  it('derives the UID from the verified Firebase token and rejects mismatches', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(getFirebaseAdminAuth).mockReturnValue({
      verifyIdToken: vi.fn().mockResolvedValue({ uid: 'verified-user-123', email: 'user@example.com' }),
    } as never);

    await expect(requireAuthenticatedUserId(
      new Request('http://localhost/api/projects', {
        headers: { authorization: 'Bearer firebase-id-token' },
      }),
      'different-client-user'
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' } satisfies Partial<StorageError>);

    await expect(requireAuthenticatedUserId(
      new Request('http://localhost/api/projects', {
        headers: { authorization: 'Bearer firebase-id-token' },
      })
    )).resolves.toBe('verified-user-123');
  });
});
