import { after } from 'next/server';
import { refreshAskSuggestionsForProject } from '@/lib/ask/suggestionsRefresh';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';
import { getStorageProvider } from '@/lib/storage';
import { activeMemories } from '@/lib/memory/store';
import { getIntegrationStates } from '@/lib/google/state';
import { calendarSignalToSafeEvent, retrieveRealCalendarSignals } from '@/lib/google/calendar';
import { refreshCalendarRelevance } from '@/lib/google/calendarRelevance';
import { isDemoMode } from '@/lib/runtime/demoMode';
import type { Project, UserMemoryProfile } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';

type AfterResponse = (work: () => Promise<void>) => void;

const scheduled = new Set<string>();
const scheduledCalendar = new Set<string>();

function personalizationKey(
  profile: UserMemoryProfile | undefined,
  memories: DurableMemory[] | undefined,
): string {
  return JSON.stringify({
    profile: profile
      ? {
        answer_density: profile.answer_density,
        question_frequency: profile.question_frequency,
        challenge_level: profile.challenge_level,
        evidence_preference: profile.evidence_preference,
        brainstorm_style: profile.brainstorm_style,
        uncertainty_style: profile.uncertainty_style,
        durable_notes: [...(profile.durable_notes ?? [])].sort(),
      }
      : null,
    memories: memories
      ? activeMemories(memories).map((memory) => ({
        category: memory.category,
        text: memory.text,
        source: memory.source,
        confidence: memory.confidence,
        why_remembered: memory.why_remembered,
      })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : null,
  });
}

/**
 * Marks one workspace's suggestions stale and schedules the expensive refresh
 * through Next's response lifecycle. The mutation caller never waits for AI.
 */
export async function scheduleAskSuggestionsRefresh(params: {
  userId: string;
  project: Project;
  profile?: UserMemoryProfile;
  memories?: DurableMemory[];
  storage?: ReturnType<typeof getStorageProvider>;
  scheduleAfterResponse?: AfterResponse;
}): Promise<void> {
  let requestedVersion: string;
  let key: string;
  try {
    requestedVersion = semanticProjectVersion(params.project);
    key = `${params.userId}:${params.project.id}:${requestedVersion}:${personalizationKey(params.profile, params.memories)}`;
  } catch (error) {
    console.error('[Gapwise Ask suggestions scheduling]', {
      projectId: params.project?.id,
      message: error instanceof Error ? error.message : 'unknown-error',
    });
    return;
  }
  if (scheduled.has(key)) return;
  scheduled.add(key);

  try {
    const storage = params.storage ?? getStorageProvider();
    await storage.markAskSuggestionsStale?.(params.userId, params.project.id, requestedVersion);
    const run = async () => {
      try {
        await refreshAskSuggestionsForProject(params);
      } catch (error) {
        // Refresh is an enhancement after a successful mutation. The complete
        // diagnostic remains in server logs, never in the mutation response.
        console.error('[Gapwise Ask suggestions scheduled refresh]', {
          projectId: params.project.id,
          message: error instanceof Error ? error.message : 'unknown-error',
        });
      }
      try {
        await refreshCalendarRelevanceAfterMutation(params);
      } catch (error) {
        console.error('[Gapwise Calendar relevance scheduled refresh]', {
          projectId: params.project.id,
          message: error instanceof Error ? error.message : 'unknown-error',
        });
      } finally {
        scheduled.delete(key);
      }
    };
    (params.scheduleAfterResponse ?? after)(run);
  } catch (error) {
    scheduled.delete(key);
    console.error('[Gapwise Ask suggestions scheduling]', {
      projectId: params.project.id,
      message: error instanceof Error ? error.message : 'unknown-error',
    });
  }
}

async function refreshCalendarRelevanceAfterMutation(params: {
  userId: string;
  project: Project;
  storage?: ReturnType<typeof getStorageProvider>;
}): Promise<void> {
  if (isDemoMode()) return;

  // A supplied storage adapter is authoritative for the mutation. Small
  // adapters used by tests may not implement integrations; in that case do
  // not reach into the process-wide provider.
  const integrations = params.storage?.getGoogleIntegrations
    ? await params.storage.getGoogleIntegrations(params.userId)
    : params.storage
      ? []
      : await getIntegrationStates(params.userId);
  const calendar = integrations.find((integration) => integration.name === 'calendar');
  if (calendar?.status !== 'connected') return;

  const signals = await retrieveRealCalendarSignals(params.userId, calendar);
  await refreshCalendarRelevance({
    userId: params.userId,
    project: params.project,
    events: signals.events.map(calendarSignalToSafeEvent),
    storage: params.storage,
  });
}

/** Schedules one non-blocking refresh when a cached assessment has expired. */
export async function scheduleCalendarRelevanceRefresh(params: {
  userId: string;
  project: Project;
  storage?: ReturnType<typeof getStorageProvider>;
  scheduleAfterResponse?: AfterResponse;
}): Promise<void> {
  if (isDemoMode()) return;
  const key = `${params.userId}:${params.project.id}:${semanticProjectVersion(params.project)}`;
  if (scheduledCalendar.has(key)) return;
  scheduledCalendar.add(key);

  const run = async () => {
    try {
      await refreshCalendarRelevanceAfterMutation(params);
    } catch (error) {
      console.error('[Gapwise Calendar relevance scheduled refresh]', {
        projectId: params.project.id,
        message: error instanceof Error ? error.message : 'unknown-error',
      });
    } finally {
      scheduledCalendar.delete(key);
    }
  };

  try {
    (params.scheduleAfterResponse ?? after)(run);
  } catch (error) {
    scheduledCalendar.delete(key);
    console.error('[Gapwise Calendar relevance scheduling]', {
      projectId: params.project.id,
      message: error instanceof Error ? error.message : 'unknown-error',
    });
  }
}

export function clearAskSuggestionsScheduledForTests(): void {
  scheduled.clear();
  scheduledCalendar.clear();
}
