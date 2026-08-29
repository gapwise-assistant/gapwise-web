import { afterEach, describe, expect, it } from 'vitest';
import { requirePublicDemoAppCheck } from './appCheck';

const originalEnabled = process.env.FIREBASE_APPCHECK_ENABLED;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.FIREBASE_APPCHECK_ENABLED;
  else process.env.FIREBASE_APPCHECK_ENABLED = originalEnabled;
});

describe('public-demo App Check boundary', () => {
  it('fails closed when server App Check is not explicitly enabled', async () => {
    delete process.env.FIREBASE_APPCHECK_ENABLED;

    await expect(requirePublicDemoAppCheck(new Request('https://gapwise.web.app/api/ask')))
      .rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});
