export type DisplayDateTimeValue = string | number | Date | null | undefined;

export interface DisplayDateTimeOptions {
  locale?: string | string[];
  timeZone?: string;
  includeYear?: boolean;
  month?: 'short' | 'long';
}

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

const DEFAULT_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
};

const FILENAME_SAFE_ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z$/;

/**
 * Converts the filename-safe ISO form used by older demo titles back to an
 * ISO value before Date/Intl handle timezone conversion.
 */
export function normalizeDisplayDateTimeValue(value: DisplayDateTimeValue): string | number | Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date || typeof value === 'number') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const safeMatch = trimmed.match(FILENAME_SAFE_ISO);
  if (!safeMatch) return trimmed;
  const [, date, hour, minute, second, milliseconds] = safeMatch;
  return `${date}T${hour}:${minute}:${second}${milliseconds ? `.${milliseconds.padEnd(3, '0')}` : ''}Z`;
}

export function parseDisplayDateTime(value: DisplayDateTimeValue): Date | null {
  const normalized = normalizeDisplayDateTimeValue(value);
  if (normalized === null) return null;
  const date = normalized instanceof Date ? new Date(normalized.getTime()) : new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatterOptions(options: DisplayDateTimeOptions, values: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  return options.timeZone ? { ...values, timeZone: options.timeZone } : values;
}

function localeFor(options: DisplayDateTimeOptions): string | string[] | undefined {
  return options.locale;
}

function formatParts(
  value: DisplayDateTimeValue,
  options: DisplayDateTimeOptions,
  dateOptions: Intl.DateTimeFormatOptions,
  invalid: string,
): string {
  const date = parseDisplayDateTime(value);
  if (!date) return invalid;
  return new Intl.DateTimeFormat(localeFor(options), formatterOptions(options, dateOptions)).format(date);
}

/** Formats an instant as `Aug 27, 2026 · 4:53 AM`. */
export function formatDateTime(value: DisplayDateTimeValue, options: DisplayDateTimeOptions = {}): string {
  const date = parseDisplayDateTime(value);
  if (!date) return 'Unknown time';
  const datePart = new Intl.DateTimeFormat(localeFor(options), formatterOptions(options, DEFAULT_DATE_OPTIONS)).format(date);
  const timePart = new Intl.DateTimeFormat(localeFor(options), formatterOptions(options, DEFAULT_TIME_OPTIONS)).format(date);
  return `${datePart} · ${timePart}`;
}

/** Formats an instant as `Aug 27 · 4:53 AM`. */
export function formatCompactDateTime(value: DisplayDateTimeValue, options: DisplayDateTimeOptions = {}): string {
  const date = parseDisplayDateTime(value);
  if (!date) return 'Unknown time';
  const datePart = new Intl.DateTimeFormat(localeFor(options), formatterOptions(options, { month: 'short', day: 'numeric' })).format(date);
  const timePart = new Intl.DateTimeFormat(localeFor(options), formatterOptions(options, DEFAULT_TIME_OPTIONS)).format(date);
  return `${datePart} · ${timePart}`;
}

/** Formats a date heading as `AUG 27, 2026`. */
export function formatDateHeading(value: DisplayDateTimeValue, options: DisplayDateTimeOptions = {}): string {
  return formatParts(value, options, DEFAULT_DATE_OPTIONS, 'UNKNOWN DATE').toUpperCase();
}

/** Formats a date-only value without introducing a time into the UI. */
export function formatDateOnly(value: DisplayDateTimeValue, options: DisplayDateTimeOptions = {}): string {
  const dateOptions = {
    month: options.month ?? 'short',
    day: 'numeric',
    ...(options.includeYear === false ? {} : { year: 'numeric' }),
  } satisfies Intl.DateTimeFormatOptions;
  return formatParts(value, options, dateOptions, 'Unknown date');
}

/** Formats only the local clock portion of an instant. */
export function formatTime(value: DisplayDateTimeValue, options: DisplayDateTimeOptions = {}): string {
  return formatParts(value, options, DEFAULT_TIME_OPTIONS, 'Unknown time');
}
