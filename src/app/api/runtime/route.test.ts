import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/runtime', () => {
  it('advertises the hardcoded local identity on the development localhost origin', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('GAPSWISE_DEMO_MODE', 'false');

    const response = await GET(new Request('http://localhost:3000/api/runtime'));

    await expect(response.json()).resolves.toEqual({ demoMode: false, localAuth: true });
  });

  it('does not enable local auth for production requests', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GAPSWISE_DEMO_MODE', 'false');

    const response = await GET(new Request('http://localhost:3000/api/runtime'));

    await expect(response.json()).resolves.toEqual({ demoMode: false, localAuth: false });
  });
});
