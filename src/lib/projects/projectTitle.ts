import { normalizeDisplayDateTimeValue, parseDisplayDateTime } from '@/lib/datetime/displayDateTime';

export interface ProjectTitlePresentation {
  title: string;
  legacyCreatedAt?: string;
}

const TRAILING_TIMESTAMP = /^(.*?)\s+(?:[·•|—–-]\s*)?(\d{4}-\d{2}-\d{2}T\d{2}(?:[-:]\d{2}){2}(?:[.-]\d{1,3})?Z)\s*$/;

/**
 * Removes only a trailing machine timestamp from a legacy title for
 * presentation. The stored title and project ID are never changed.
 */
export function projectTitlePresentation(value: string): ProjectTitlePresentation {
  const match = value.trim().match(TRAILING_TIMESTAMP);
  if (!match) return { title: value };
  const timestamp = normalizeDisplayDateTimeValue(match[2]);
  if (!timestamp || !parseDisplayDateTime(timestamp)) return { title: value };
  return {
    title: match[1].trim(),
    legacyCreatedAt: typeof timestamp === 'string' ? timestamp : undefined,
  };
}
