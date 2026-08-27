import { formatDateOnly, formatDateTime, formatTime } from '@/lib/datetime/displayDateTime';

/** Extracts the complete ISO timestamp from a mapped Calendar commitment. */
export function calendarTimestampFromText(
  text: string,
  label: 'Starts' | 'Ends'
): string | undefined {
  return text.match(new RegExp(`${label} (\\S+)\\.`))?.[1];
}

/** Formats Calendar timestamps for people while leaving stored graph text unchanged. */
export function formatCalendarDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const hasTime = /T\d{2}:\d{2}/.test(value);
  return hasTime ? formatDateTime(value) : formatDateOnly(value);
}

function compactDuration(milliseconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / (60 * 1000)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  return `${minutes}m`;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isTomorrow(date: Date, now: Date): boolean {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return localDateKey(date) === localDateKey(tomorrow);
}

function formatClockTime(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return formatTime(value);
}

function formatClockRange(startValue: string, endValue: string | undefined): string | undefined {
  const startTime = formatClockTime(startValue);
  if (!startTime) return undefined;
  const endTime = endValue ? formatClockTime(endValue) : undefined;
  if (!endTime) return startTime;
  const startPeriod = startTime.match(/\s(AM|PM)$/i)?.[1];
  const endPeriod = endTime.match(/\s(AM|PM)$/i)?.[1];
  const compactStart = startPeriod && endPeriod && startPeriod.toLowerCase() === endPeriod.toLowerCase()
    ? startTime.slice(0, -(startPeriod.length + 1))
    : startTime;
  return `${compactStart}–${endTime}`;
}

/** Formats the compact schedule line shown beneath a Calendar reminder. */
export function formatCalendarSchedule(
  startValue: string | undefined,
  endValue: string | undefined,
  now = new Date()
): string | undefined {
  if (!startValue) return undefined;
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime())) return undefined;
  const end = endValue ? new Date(endValue) : undefined;
  const dateLabel = localDateKey(start) === localDateKey(now)
    ? 'Today'
    : isTomorrow(start, now)
      ? 'Tomorrow'
      : formatDateOnly(start, { includeYear: start.getFullYear() !== now.getFullYear() });
  const timeLabel = end && !Number.isNaN(end.getTime()) && localDateKey(end) === localDateKey(start)
    ? formatClockRange(startValue, endValue)
    : formatClockTime(startValue);
  return timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel;
}

/** Describes a Calendar reminder in the compact language used on the card. */
export function formatCalendarTimeUntil(
  startValue: string | undefined,
  endValue: string | undefined,
  now = new Date()
): string | undefined {
  if (!startValue) return undefined;
  const start = new Date(startValue).getTime();
  const end = endValue ? new Date(endValue).getTime() : start;
  const nowTime = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(nowTime)) return undefined;

  const startDate = new Date(start);
  if (start > nowTime) {
    if (start - nowTime < 60 * 1000) return 'Starting now';
    if (localDateKey(startDate) === localDateKey(new Date(nowTime))) {
      return `In ${compactDuration(start - nowTime)}`;
    }
    return formatCalendarSchedule(startValue, undefined, now);
  }
  if (nowTime - start < 60 * 1000) return 'Starting now';
  if (end > nowTime) {
    return `In progress · ends in ${compactDuration(end - nowTime)}`;
  }
  return `${compactDuration(nowTime - start)} overdue`;
}

/** Makes a stored Calendar commitment readable in evidence and detail views. */
export function formatCalendarCommitmentText(text: string): string {
  return (['Starts', 'Ends'] as const).reduce((formatted, label) => {
    const timestamp = calendarTimestampFromText(text, label);
    const readable = formatCalendarDateTime(timestamp);
    return timestamp && readable
      ? formatted.replace(`${label} ${timestamp}.`, `${label} ${readable}.`)
      : formatted;
  }, text);
}
