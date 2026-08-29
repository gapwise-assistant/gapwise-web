import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requirePublicDemoAppCheck } from './appCheck';
import { getAppCheck } from 'firebase-admin/app-check';

vi.mock('firebase-admin/app-check', () => ({
  getAppCheck: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  getFirebaseAdminApp: vi.fn(() => ({})),
}));

const originalEnabled = process.env.FIREBASE_APPCHECK_ENABLED;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.FIREBASE_APPCHECK_ENABLED;
  else process.env.FIREBASE_APPCHECK_ENABLED = originalEnabled;
});

describe('public-demo App Check boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows public-demo requests when App Check is disabled or missing', async () => {
    delete process.env.FIREBASE_APPCHECK_ENABLED;
    await expect(requirePublicDemoAppCheck(new Request('https://gapwise.web.app/api/ask')))
      .resolves.toBeUndefined();

    process.env.FIREBASE_APPCHECK_ENABLED = 'false';
    await expect(requirePublicDemoAppCheck(new Request('https://gapwise.web.app/api/ask')))
      .resolves.toBeUndefined();
    expect(getAppCheck).not.toHaveBeenCalled();
  });

  it('rejects a missing token when App Check is enabled', async () => {
    process.env.FIREBASE_APPCHECK_ENABLED = 'true';

    await expect(requirePublicDemoAppCheck(new Request('https://gapwise.web.app/api/ask')))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(getAppCheck).not.toHaveBeenCalled();
  });

  it('rejects an invalid token when App Check is enabled', async () => {
    process.env.FIREBASE_APPCHECK_ENABLED = 'true';
    vi.mocked(getAppCheck).mockReturnValue({
      verifyToken: vi.fn().mockRejectedValue(new Error('invalid token')),
    } as never);

    await expect(requirePublicDemoAppCheck(new Request('https://gapwise.web.app/api/ask', {
      headers: { 'x-firebase-appcheck': 'invalid-token' },
    }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('accepts a valid token when App Check is enabled', async () => {
    process.env.FIREBASE_APPCHECK_ENABLED = 'true';
    const verifyToken = vi.fn().mockResolvedValue({ appId: 'public-demo' });
    vi.mocked(getAppCheck).mockReturnValue({ verifyToken } as never);

    await expect(requirePublicDemoAppCheck(new Request('https://gapwise.web.app/api/ask', {
      headers: { 'x-firebase-appcheck': 'valid-token' },
    }))).resolves.toBeUndefined();
    expect(verifyToken).toHaveBeenCalledWith('valid-token');
  });
});
