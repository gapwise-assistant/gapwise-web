import { NextRequest, NextResponse } from 'next/server';
import { listUpcomingCalendarEvents } from '@/lib/google/calendar';
import { demoCalendarEvents } from '@/lib/demo/localFixtures';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const userId = await requireAuthenticatedUserId(request, request.nextUrl.searchParams.get('userId')?.trim());

    const events = isDemoMode() ? demoCalendarEvents() : await listUpcomingCalendarEvents(userId);
    return NextResponse.json({ events });
  } catch (error) {
    const status = error instanceof StorageError && error.code === 'UNAUTHENTICATED' ? 400 : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google Calendar events request failed.' },
      { status }
    );
  }
}
