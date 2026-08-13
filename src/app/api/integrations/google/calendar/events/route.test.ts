import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listUpcomingCalendarEvents } from '@/lib/google/calendar';
import { GET } from './route';

vi.mock('@/lib/google/calendar', () => ({
  listUpcomingCalendarEvents: vi.fn(),
}));

describe('GET /api/integrations/google/calendar/events', () => {
  const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
  beforeEach(() => {
    vi.clearAllMocks();
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
    vi.mocked(listUpcomingCalendarEvents).mockResolvedValue([
      {
        id: 'event_1',
        summary: 'Upcoming planning meeting',
        description: 'Discuss Calendar integration.',
        start: '2026-08-12T10:00:00Z',
        end: '2026-08-12T10:30:00Z',
        location: 'Remote',
      },
    ]);
  });

  it('returns fixtures and never calls Calendar API in demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const response = await GET(new NextRequest('http://localhost/api/integrations/google/calendar/events?userId=demo-user'));
    expect(response.status).toBe(200);
    expect(listUpcomingCalendarEvents).not.toHaveBeenCalled();
    expect((await response.json()).events.map((event: { summary: string }) => event.summary)).toContain('Gapswise Demo Review');
  });

  it('returns safe upcoming Calendar event fields for the requested user', async () => {
    const response = await GET(new NextRequest('http://localhost/api/integrations/google/calendar/events?userId=demo-user'));

    expect(response.status).toBe(200);
    expect(listUpcomingCalendarEvents).toHaveBeenCalledWith('demo-user');

    const body = await response.json();
    expect(body.events).toEqual([
      {
        id: 'event_1',
        summary: 'Upcoming planning meeting',
        description: 'Discuss Calendar integration.',
        start: '2026-08-12T10:00:00Z',
        end: '2026-08-12T10:30:00Z',
        location: 'Remote',
      },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/access_token|refresh_token/i);
  });

  it('rejects missing user id', async () => {
    const response = await GET(new NextRequest('http://localhost/api/integrations/google/calendar/events'));

    expect(response.status).toBe(400);
    expect(listUpcomingCalendarEvents).not.toHaveBeenCalled();
  });
});
