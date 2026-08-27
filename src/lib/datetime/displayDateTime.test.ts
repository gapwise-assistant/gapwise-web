import { describe, expect, it } from 'vitest';
import { formatCompactDateTime, formatDateHeading, formatDateOnly, formatDateTime, parseDisplayDateTime } from '@/lib/datetime/displayDateTime';

const options = { locale: 'en-US', timeZone: 'America/Mexico_City' };

describe('display date and time formatting', () => {
  it('formats ISO timestamps with a readable date and time', () => {
    expect(formatDateTime('2026-08-27T04:53:35.306Z', options)).toBe('Aug 26, 2026 · 10:53 PM');
    expect(formatCompactDateTime('2026-08-27T04:53:35.306Z', options)).toBe('Aug 26 · 10:53 PM');
    expect(formatDateHeading('2026-08-27T04:53:35.306Z', options)).toBe('AUG 26, 2026');
  });

  it('parses filename-safe ISO timestamps', () => {
    expect(parseDisplayDateTime('2026-08-27T04-53-35-306Z')?.toISOString()).toBe('2026-08-27T04:53:35.306Z');
  });

  it('supports an explicit timezone and date-only values', () => {
    expect(formatDateTime('2026-08-27T04:53:35.306Z', { locale: 'en-US', timeZone: 'UTC' })).toBe('Aug 27, 2026 · 4:53 AM');
    expect(formatDateOnly('2026-08-27', { locale: 'en-US', timeZone: 'UTC' })).toBe('Aug 27, 2026');
  });

  it('handles missing and invalid values safely', () => {
    expect(formatDateTime(undefined, options)).toBe('Unknown time');
    expect(formatDateHeading('not-a-date', options)).toBe('UNKNOWN DATE');
  });
});
