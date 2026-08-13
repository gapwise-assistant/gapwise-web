import { NextRequest, NextResponse } from 'next/server';
import { listUpcomingCalendarEvents } from '@/lib/google/calendar';
import { demoCalendarEvents } from '@/lib/demo/localFixtures';
import { isDemoMode } from '@/lib/runtime/demoMode';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
    }

    const events = isDemoMode() ? demoCalendarEvents() : await listUpcomingCalendarEvents(userId);
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google Calendar events request failed.' },
      { status: 503 }
    );
  }
}
