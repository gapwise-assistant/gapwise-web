import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumeOAuthState: vi.fn(),
  createDemoConnectedState: vi.fn(),
  exchangeCalendarCode: vi.fn(),
  readOAuthState: vi.fn(),
  updateIntegrationState: vi.fn(),
}));

vi.mock('@/lib/google/auth', () => ({
  createDemoConnectedState: mocks.createDemoConnectedState,
}));

vi.mock('@/lib/google/state', () => ({
  updateIntegrationState: mocks.updateIntegrationState,
}));

vi.mock('@/lib/google/oauth', () => ({
  consumeOAuthState: mocks.consumeOAuthState,
  exchangeCalendarCode: mocks.exchangeCalendarCode,
  readOAuthState: mocks.readOAuthState,
}));

vi.mock('@/lib/runtime/demoMode', () => ({
  isDemoMode: vi.fn(() => false),
}));

import { GET } from './route';

describe('Google Calendar OAuth callback', () => {
  beforeEach(() => {
    vi.stubEnv('GAPSWISE_PUBLIC_WEB_URL', 'https://gapwise.web.app');
    mocks.consumeOAuthState.mockResolvedValue(true);
    mocks.createDemoConnectedState.mockReturnValue({ name: 'calendar', status: 'connected' });
    mocks.exchangeCalendarCode.mockResolvedValue(undefined);
    mocks.readOAuthState.mockReturnValue({ userId: 'oauth-user', nonce: 'nonce' });
    mocks.updateIntegrationState.mockResolvedValue([]);
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

  it('accepts a server-validated state when the hosting proxy omits the cookie', async () => {
    const state = 'oauth-state';
    const response = await GET(new NextRequest(
      `https://localhost:8080/api/integrations/google/calendar/callback?code=synthetic-code&state=${state}`,
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://gapwise.web.app/?googleCalendar=connected',
    );
    expect(mocks.consumeOAuthState).toHaveBeenCalledWith(state);
    expect(mocks.exchangeCalendarCode).toHaveBeenCalledWith('oauth-user', 'synthetic-code');
    expect(mocks.updateIntegrationState).toHaveBeenCalledWith(
      'oauth-user',
      expect.objectContaining({ name: 'calendar', status: 'connected' }),
    );
  });
});
