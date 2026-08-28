import type { Project, UserMemoryProfile } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import type { SuggestedQuestionGroups } from '@/lib/ask/suggestions';
import type { StorageProvider } from '@/lib/storage/types';
import { getStorageProvider } from '@/lib/storage';
import { hashText } from '@/lib/context/ingestion';
import { activeMemories } from '@/lib/memory/store';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';

const ASK_SUGGESTIONS_CACHE_SCHEMA_VERSION = 2;
const inFlight = new Map<string, Promise<CachedAskSuggestions>>();

export interface AskSuggestionsGeneration {
  suggestions: SuggestedQuestionGroups;
  generatedBy: string;
  cacheable: boolean;
  warning?: string;
  stage?: string;
}

export interface CachedAskSuggestions extends SuggestedQuestionGroups {
  generatedBy: string;
  cached: boolean;
  warning?: string;
  stage?: string;
}

export async function askSuggestionsProjectStateVersion(
  project: Project,
  profile?: UserMemoryProfile,
  memories: DurableMemory[] = [],
): Promise<string> {
  return askSuggestionsProjectStateVersionFromSemanticVersion(
    semanticProjectVersion(project),
    profile,
    memories,
  );
}

export async function askSuggestionsProjectStateVersionFromSemanticVersion(
  projectSemanticVersion: string,
  profile?: UserMemoryProfile,
  memories: DurableMemory[] = [],
): Promise<string> {
  return hashText(JSON.stringify({
    projectSemanticVersion,
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
    memories: activeMemories(memories)
      .map((memory) => ({
        category: memory.category,
        text: memory.text,
        source: memory.source,
        confidence: memory.confidence,
        why_remembered: memory.why_remembered,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  }));
}

export function askSuggestionsCacheId(scopeKey: string, projectStateVersion: string): string {
  const safeScopeKey = encodeURIComponent(scopeKey);
  return `ask_suggestions_v${ASK_SUGGESTIONS_CACHE_SCHEMA_VERSION}_${safeScopeKey}_${projectStateVersion.slice(0, 24)}`;
}

export async function getCachedAskSuggestions(
  params: {
    userId: string;
    project: Project;
    projectId?: string;
    scopeKey: string;
    profile?: UserMemoryProfile;
    memories?: DurableMemory[];
    generate: () => Promise<AskSuggestionsGeneration>;
  },
  deps: { storage?: StorageProvider } = {},
): Promise<CachedAskSuggestions> {
  const storage = deps.storage ?? getStorageProvider();
  const projectStateVersion = await askSuggestionsProjectStateVersion(
    params.project,
    params.profile,
    params.memories,
  );
  const cacheId = askSuggestionsCacheId(params.scopeKey, projectStateVersion);
  const requestKey = `${params.userId}:${cacheId}`;
  const existingRequest = inFlight.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    try {
      const cached = await storage.getAskSuggestionsCache(params.userId, cacheId);
      if (cached?.projectStateVersion === projectStateVersion && cached.scopeKey === params.scopeKey) {
        return {
          top: cached.topQuestions,
          other: cached.otherQuestions,
          generatedBy: cached.generatedBy,
          cached: true,
        };
      }
    } catch {
      // A cache outage must not make Ask unavailable.
    }

    const generated = await params.generate();
    const now = new Date().toISOString();
    if (generated.cacheable) {
      try {
        await storage.saveAskSuggestionsCache(params.userId, {
          id: cacheId,
          userId: params.userId,
          ...(params.projectId ? { projectId: params.projectId } : {}),
          scopeKey: params.scopeKey,
          projectStateVersion,
          semanticProjectVersion: semanticProjectVersion(params.project),
          topQuestions: generated.suggestions.top,
          otherQuestions: generated.suggestions.other,
          generatedBy: generated.generatedBy,
          createdAt: now,
          updatedAt: now,
          status: 'ready',
        });
      } catch {
        // Return generated suggestions even when cache persistence is unavailable.
      }
    }
    return {
      ...generated.suggestions,
      generatedBy: generated.generatedBy,
      cached: false,
      ...(generated.warning ? { warning: generated.warning } : {}),
      ...(generated.stage ? { stage: generated.stage } : {}),
    };
  })();

  inFlight.set(requestKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(requestKey);
  }
}

export function clearAskSuggestionsInFlightForTests(): void {
  inFlight.clear();
}
