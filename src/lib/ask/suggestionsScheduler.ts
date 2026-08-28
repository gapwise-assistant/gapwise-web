import { after } from 'next/server';
import { refreshAskSuggestionsForProject } from '@/lib/ask/suggestionsRefresh';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';
import { getStorageProvider } from '@/lib/storage';
import { activeMemories } from '@/lib/memory/store';
import type { Project, UserMemoryProfile } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';

type AfterResponse = (work: () => Promise<void>) => void;

const scheduled = new Set<string>();

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

export function clearAskSuggestionsScheduledForTests(): void {
  scheduled.clear();
}
