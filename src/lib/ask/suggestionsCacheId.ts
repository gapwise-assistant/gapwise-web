import { boundedId } from '@/lib/ids/boundedId';

/** The one bounded document ID used for the current assessment of a workspace. */
export function askSuggestionsCurrentCacheId(projectId: string): string {
  return boundedId('ask_suggestions_current', projectId);
}
