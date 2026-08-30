import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/google/auth', () => ({
  createDemoConnectedState: vi.fn(),
}));

vi.mock('@/lib/google/state', () => ({
  updateIntegrationState: vi.fn(),
}));

vi.mock('@/lib/google/oauth', () => ({
  exchangeCalendarCode: vi.fn(),
  readOAuthState: vi.fn(),
}));

vi.mock('@/lib/runtime/demoMode', () => ({
  isDemoMode: vi.fn(() => false),
}));

import { GET } from './route';

describe('Google Calendar OAuth callback', () => {
  beforeEach(() => {
    vi.stubEnv('GAPSWISE_PUBLIC_WEB_URL', 'https://gapwise.web.app');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects to the configured public app URL instead of the proxy host', async () => {
    const response = await GET(new NextRequest(
      'https://localhost:8080/api/integrations/google/calendar/callback?error=access_denied',
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://gapwise.web.app/?googleCalendar=access_denied',
    );
  });
});
