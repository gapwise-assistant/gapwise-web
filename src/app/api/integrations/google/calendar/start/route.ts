import { NextRequest, NextResponse } from 'next/server';
import { buildCalendarAuthUrl, createOAuthState } from '@/lib/google/oauth';
import { isDemoMode } from '@/lib/runtime/demoMode';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
    }
    if (isDemoMode()) {
      return NextResponse.json({ error: 'Google Calendar OAuth is disabled in local demo mode.' }, { status: 409 });
    }

    const state = createOAuthState(userId);
    const response = NextResponse.redirect(buildCalendarAuthUrl(state));
    response.cookies.set('gapswise_google_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google Calendar OAuth start failed.' },
      { status: 500 }
    );
  }
}
