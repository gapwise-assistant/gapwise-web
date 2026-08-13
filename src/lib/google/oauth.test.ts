import { describe, expect, it, vi } from 'vitest';
import { buildCalendarAuthUrl, createOAuthState, readOAuthState } from '@/lib/google/oauth';

describe('Google OAuth helpers', () => {
  it('round-trips OAuth state with the Gapswise user id', () => {
    const state = createOAuthState('demo-user');

    expect(readOAuthState(state).userId).toBe('demo-user');
    expect(readOAuthState(state).nonce).toBeTruthy();
  });

  it('builds a Calendar readonly OAuth URL from environment configuration', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-id.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:3000/api/integrations/google/calendar/callback');

    const url = new URL(buildCalendarAuthUrl('state_123'));

    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/integrations/google/calendar/callback');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBe('state_123');

    vi.unstubAllEnvs();
  });
});
