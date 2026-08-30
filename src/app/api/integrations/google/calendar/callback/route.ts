import { NextRequest, NextResponse } from 'next/server';
import { createDemoConnectedState } from '@/lib/google/auth';
import { updateIntegrationState } from '@/lib/google/state';
import { exchangeCalendarCode, readOAuthState } from '@/lib/google/oauth';
import { isDemoMode } from '@/lib/runtime/demoMode';

export const runtime = 'nodejs';

function getPublicAppUrl(): URL {
  const configuredUrl = process.env.GAPSWISE_PUBLIC_WEB_URL?.trim();
  if (configuredUrl) {
    return new URL(configuredUrl);
  }

  return new URL(
    process.env.NODE_ENV === 'production'
      ? 'https://gapwise.web.app'
      : 'http://localhost:3000',
  );
}

export async function GET(request: NextRequest) {
  const appUrl = getPublicAppUrl();
  if (isDemoMode()) {
    appUrl.searchParams.set('googleCalendar', 'demo_mode');
    return NextResponse.redirect(appUrl);
  }
  try {
    const error = request.nextUrl.searchParams.get('error');
    if (error) {
      appUrl.searchParams.set('googleCalendar', error);
      return NextResponse.redirect(appUrl);
    }

    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const cookieState = request.cookies.get('gapswise_google_oauth_state')?.value;
    if (!code || !state || state !== cookieState) {
      appUrl.searchParams.set('googleCalendar', 'invalid_state');
      return NextResponse.redirect(appUrl);
    }

    const { userId } = readOAuthState(state);
    await exchangeCalendarCode(userId, code);
    await updateIntegrationState(userId, createDemoConnectedState('calendar'));

    appUrl.searchParams.set('googleCalendar', 'connected');
    const response = NextResponse.redirect(appUrl);
    response.cookies.delete('gapswise_google_oauth_state');
    return response;
  } catch {
    appUrl.searchParams.set('googleCalendar', 'failed');
    return NextResponse.redirect(appUrl);
  }
}
