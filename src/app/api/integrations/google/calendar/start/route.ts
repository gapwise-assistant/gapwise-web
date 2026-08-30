import { NextRequest, NextResponse } from 'next/server';
import { buildCalendarAuthUrl, createOAuthState, saveOAuthState } from '@/lib/google/oauth';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const userId = await requireAuthenticatedUserId(request, request.nextUrl.searchParams.get('userId')?.trim());
    if (isDemoMode()) {
      return NextResponse.json({ error: 'Google Calendar OAuth is disabled in local demo mode.' }, { status: 409 });
    }

    const state = createOAuthState(userId);
    const authUrl = buildCalendarAuthUrl(state);
    await saveOAuthState(state);
    const response = request.headers.get('accept')?.includes('application/json')
      ? NextResponse.json({ url: authUrl })
      : NextResponse.redirect(authUrl);
    response.cookies.set('gapswise_google_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    const status = error instanceof StorageError
      ? error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'UNAUTHENTICATED' ? 401 : 400
      : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google Calendar OAuth start failed.' },
      { status }
    );
  }
}
