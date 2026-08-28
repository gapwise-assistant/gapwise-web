import type { AskSuggestionsCacheRecord } from '@/lib/storage/types';

/**
 * A refresh lease prevents a crashed worker from leaving the current
 * assessment permanently owned by an abandoned generation.
 */
export const ASK_SUGGESTIONS_GENERATION_LEASE_MS = 60_000;

export function askSuggestionsInputVersion(record: AskSuggestionsCacheRecord): string {
  return record.publishedInputVersion ?? record.projectStateVersion;
}

export function hasValidAskSuggestionsLease(
  record: Pick<AskSuggestionsCacheRecord, 'generationLeaseExpiresAt'>,
  now = Date.now(),
): boolean {
  if (!record.generationLeaseExpiresAt) return false;
  const expiresAt = Date.parse(record.generationLeaseExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function createAskSuggestionsLease(now: string): {
  generationStartedAt: string;
  generationLeaseExpiresAt: string;
} {
  const startedAt = Date.parse(now);
  const base = Number.isFinite(startedAt) ? startedAt : Date.now();
  return {
    generationStartedAt: new Date(base).toISOString(),
    generationLeaseExpiresAt: new Date(base + ASK_SUGGESTIONS_GENERATION_LEASE_MS).toISOString(),
  };
}
