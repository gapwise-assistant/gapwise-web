import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarSyncTraceView, selectCalendarTraceViews } from './TracePanel';
import type { TraceEvent } from '@/types/observability';

function trace(id: string, extra: Partial<TraceEvent> = {}): TraceEvent {
  return {
    id,
    userId: 'trace-user',
    route: '/test',
    label: id,
    started_at: '2026-08-29T12:00:00.000Z',
    duration_ms: 0,
    agentNames: [],
    contextIds: [],
    scores: [],
    toolCalls: [],
    ...extra,
  };
}

describe('TracePanel Calendar diagnostics', () => {
  it('retains the latest Calendar sync outside the eight-trace activity cap', () => {
    const calendar = trace('calendar-sync', {
      calendarSync: {
        runId: 'calendar_sync_1',
        projectId: 'relaydesk',
        status: 'completed',
        steps: [],
      },
    });
    const views = selectCalendarTraceViews([
      ...Array.from({ length: 10 }, (_, index) => trace(`generic-${index}`)),
      calendar,
    ]);

    expect(views.latestCalendarSyncTrace?.id).toBe('calendar-sync');
    expect(views.recentTraces).toHaveLength(8);
    expect(views.recentTraces.some((item) => item.id === 'calendar-sync')).toBe(false);
  });

  it('renders the ordered Calendar pipeline and safe stage details', () => {
    const html = renderToStaticMarkup(<CalendarSyncTraceView trace={trace('calendar-sync', {
      calendarSync: {
        runId: 'calendar_sync_1',
        projectId: 'relaydesk',
        status: 'completed',
        steps: [{
          name: 'Google Calendar retrieval',
          status: 'completed',
          startedAt: '2026-08-29T12:00:00.000Z',
          durationMs: 12,
          details: { rawResultCount: 1, eventIds: ['event-1'] },
        }],
      },
    })} />);

    expect(html).toContain('Calendar sync pipeline');
    expect(html).toContain('calendar_sync_1');
    expect(html).toContain('Google events retrieved');
    expect(html).toContain('event-1');
  });
});
