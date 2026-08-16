import { describe, expect, it } from 'vitest';
import {
  calendarTimestampFromText,
  formatCalendarCommitmentText,
  formatCalendarDateTime,
  formatCalendarSchedule,
  formatCalendarTimeUntil,
} from '@/lib/google/calendarFormatting';

describe('Calendar display formatting', () => {
  const start = '2026-08-16T21:17:00.000Z';
  const end = '2026-08-16T21:47:00.000Z';

  it('keeps the complete timestamp available for correct parsing', () => {
    expect(calendarTimestampFromText(`Google Calendar event: Prep. Starts ${start}. Ends ${end}.`, 'Starts'))
      .toBe(start);
    expect(calendarTimestampFromText(`Google Calendar event: Prep. Starts ${start}. Ends ${end}.`, 'Ends'))
      .toBe(end);
  });

  it('renders ISO timestamps without machine-readable separators', () => {
    const readable = formatCalendarDateTime(start);
    expect(readable).toBeTruthy();
    expect(readable).not.toContain('T');
    expect(readable).not.toContain('.000Z');
    expect(readable).toContain('2026');
  });

  it('formats both timestamps in stored Calendar evidence text', () => {
    const formatted = formatCalendarCommitmentText(
      `Google Calendar event: Career decision prep. Starts ${start}. Ends ${end}.`
    );

    expect(formatted).toContain(`Starts ${formatCalendarDateTime(start)}.`);
    expect(formatted).toContain(`Ends ${formatCalendarDateTime(end)}.`);
    expect(formatted).not.toContain(start);
    expect(formatted).not.toContain(end);
  });

  it('shows a compact live countdown before and during an event', () => {
    const now = new Date('2026-08-16T20:00:00.000Z');
    expect(formatCalendarTimeUntil('2026-08-16T21:30:00.000Z', '2026-08-16T22:00:00.000Z', now))
      .toBe('In 1h 30m');
    expect(formatCalendarTimeUntil('2026-08-16T19:30:00.000Z', '2026-08-16T20:30:00.000Z', now))
      .toBe('In progress · ends in 30m');
    expect(formatCalendarTimeUntil('2026-08-16T20:00:30.000Z', '2026-08-16T20:30:00.000Z', now))
      .toBe('Starting now');
    expect(formatCalendarTimeUntil('2026-08-16T20:08:00.000Z', '2026-08-16T20:30:00.000Z', now))
      .toBe('In 8m');
    expect(formatCalendarTimeUntil('2026-08-17T02:00:00.000Z', '2026-08-17T02:30:00.000Z', now))
      .toBe('In 6h');
    expect(formatCalendarTimeUntil('2026-08-16T22:00:00.000Z', '2026-08-16T22:30:00.000Z', now))
      .toBe('In 2h');
    expect(formatCalendarTimeUntil('2026-08-17T15:00:00.000Z', '2026-08-17T15:30:00.000Z', now))
      .toBe('Tomorrow · 9:00 AM');
    expect(formatCalendarTimeUntil('2026-08-21T15:00:00.000Z', '2026-08-21T15:30:00.000Z', now))
      .toBe('Aug 21 · 9:00 AM');
    expect(formatCalendarTimeUntil('2026-08-16T19:48:00.000Z', '2026-08-16T19:58:00.000Z', now))
      .toBe('12m overdue');
    expect(formatCalendarSchedule('2026-08-16T21:30:00.000Z', '2026-08-16T22:00:00.000Z', now))
      .toMatch(/^Today · /);
    expect(formatCalendarSchedule('2026-08-17T15:00:00.000Z', '2026-08-17T15:30:00.000Z', now))
      .toMatch(/^Tomorrow · .*–/);
    expect(formatCalendarSchedule('2026-08-21T15:00:00.000Z', '2026-08-21T15:30:00.000Z', now))
      .toMatch(/^Aug 21 · .*–/);
    expect(formatCalendarSchedule('2027-01-21T15:00:00.000Z', '2027-01-21T15:30:00.000Z', now))
      .toMatch(/2027/);
  });
});
