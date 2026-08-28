import { randomUUID } from 'node:crypto';
import { askGapswise, type AskFailureStage } from '@/lib/ask/adkClient';
import { generateLocalAskSuggestions } from '@/lib/ask/localDemoAdapter';
import {
  buildSuggestionRequestMessage,
  parseSuggestedQuestions,
} from '@/lib/ask/suggestions';
import {
  getCachedAskSuggestions,
  askSuggestionsProjectStateVersion,
  type CachedAskSuggestions,
} from '@/lib/ask/suggestionsCache';
import { CAREER_CONFLICT_DEMO_ID } from '@/lib/demo/careerConflict';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { getStorageProvider } from '@/lib/storage';
import { loadDurableMemories, loadUserMemoryProfile } from '@/lib/memory/serverStore';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { retrieveProjectReasoningContext, reasoningContextToAskGraphContext } from '@/lib/retrieval/projectReasoningContext';
import type { Project, UserMemoryProfile } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import type { AskSuggestionsCacheRecord, AskSuggestionAssessmentStatus, StorageProvider } from '@/lib/storage/types';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';

function failureStage(error: unknown): AskFailureStage {
  const candidate = error && typeof error === 'object' && 'stage' in error
    ? (error as { stage?: unknown }).stage
    : undefined;
  if (candidate === 'agent-auth' || candidate === 'agent-unavailable' || candidate === 'context-pack' || candidate === 'gemini') {
    return candidate;
  }
  return 'gemini';
}

function graphPrompt(project: Project): string {
  const context = retrieveProjectReasoningContext({
    project,
    query: 'Which open questions, decisions, risks, blockers, and next actions matter most now?',
    mode: 'reasoning',
  });
  const graph = reasoningContextToAskGraphContext(context, project.goal);
  return [
    'PROJECT-SCOPED GRAPH CONTEXT FOR SUGGESTIONS',
    JSON.stringify(graph),
    'Use only this project graph and the normal project context. Do not suggest questions from another project.',
  ].join('\n');
}

export async function refreshAskSuggestionsForProject(params: {
  userId: string;
  project: Project;
  scopeLabel?: string;
  profile?: UserMemoryProfile;
  memories?: DurableMemory[];
  storage?: ReturnType<typeof getStorageProvider>;
}): Promise<CachedAskSuggestions> {
  try {
    const storage = params.storage ?? getStorageProvider();
    if (
      typeof storage.getAskSuggestionsCache !== 'function'
      || typeof storage.saveAskSuggestionsCache !== 'function'
    ) {
      return {
        top: [],
        other: [],
        generatedBy: 'unavailable',
        cached: false,
        warning: 'Suggestions are being prepared.',
      };
    }
    const profile = params.profile ?? await loadUserMemoryProfile(params.userId, DEFAULT_USER_PROFILE);
    const memories = params.memories ?? await loadDurableMemories(params.userId, profile);
    const scopeLabel = params.scopeLabel ?? params.project.title;
    const requestedSemanticProjectVersion = semanticProjectVersion(params.project);
    const publishedInputVersion = await askSuggestionsProjectStateVersion(params.project, profile, memories);
    const scopeKey = `project:${params.project.id}`;
    const currentRecord = async () => storage.getLatestAskSuggestionsCache(params.userId, params.project.id);
    const hasCompareAndSet = typeof storage.beginAskSuggestionsRefresh === 'function'
      && typeof storage.publishAskSuggestionsCache === 'function';

    // Keep compatibility with small test adapters and older non-durable
    // providers. Firestore and the built-in mock use the race-safe path below.
    if (!hasCompareAndSet) {
      return await getCachedAskSuggestions({
        userId: params.userId,
        project: params.project,
        projectId: params.project.id,
        scopeKey,
        profile,
        memories,
        generate: () => generateLegacySuggestions({
          userId: params.userId,
          project: params.project,
          scopeLabel,
        }),
      }, { storage });
    }

    const refreshKey = `${params.userId}:${params.project.id}:${publishedInputVersion}`;
    const existingRefresh = refreshInFlight.get(refreshKey);
    if (existingRefresh) return existingRefresh;
    const refresh = runRaceSafeRefresh({
      ...params,
      storage,
      scopeKey,
      scopeLabel,
      requestedSemanticProjectVersion,
      publishedInputVersion,
      profile,
      memories,
      currentRecord,
    });
    refreshInFlight.set(refreshKey, refresh);
    try {
      return await refresh;
    } finally {
      refreshInFlight.delete(refreshKey);
    }
  } catch (error) {
    // Refresh is an enhancement after a successful semantic mutation. It must
    // never make the underlying project mutation fail.
    console.error('[Gapwise Ask suggestions refresh]', {
      projectId: params.project.id,
      message: error instanceof Error ? error.message : 'unknown-error',
    });
    return {
      top: [],
      other: [],
      generatedBy: 'unavailable',
      cached: false,
      warning: 'Suggestions are being prepared.',
    };
  }
}

async function generateLegacySuggestions(params: {
  userId: string;
  project: Project;
  scopeLabel: string;
}) {
  try {
    return await generateSuggestions(params);
  } catch (error) {
    const stage = failureStage(error);
    console.error('[Gapwise Ask suggestions]', {
      stage,
      fallback: 'local-context',
      projectId: params.project.id,
      message: error instanceof Error ? error.message : 'unknown-error',
    });
    const suggestions = await generateLocalAskSuggestions({
      userId: params.userId,
      projectId: params.project.id,
    });
    return {
      suggestions,
      generatedBy: 'local-fallback',
      cacheable: false,
      warning: 'Using saved context for these suggestions while AI is unavailable.',
      stage,
    };
  }
}

const refreshInFlight = new Map<string, Promise<CachedAskSuggestions>>();

async function generateSuggestions(params: {
  userId: string;
  project: Project;
  scopeLabel: string;
}): Promise<{
  suggestions: { top: string[]; other: string[] };
  generatedBy: string;
  cacheable: boolean;
}> {
  if (isDemoMode() || params.project.id === CAREER_CONFLICT_DEMO_ID) {
    const suggestions = await generateLocalAskSuggestions({
      userId: params.userId,
      projectId: params.project.id,
    });
    return { suggestions, generatedBy: 'local-context', cacheable: true };
  }

  const result = await askGapswise({
    userId: params.userId,
    projectId: params.project.id,
    message: `${buildSuggestionRequestMessage(params.scopeLabel)}\n\n${graphPrompt(params.project)}`,
    structuredResponse: false,
  });
  const suggestions = parseSuggestedQuestions(result.answer);
  if (!suggestions.top.length && !suggestions.other.length) {
    const error = new Error('Gemini returned no structured contextual suggestions.') as Error & { stage: AskFailureStage };
    error.stage = 'gemini';
    throw error;
  }
  return { suggestions, generatedBy: 'gapswise-agent', cacheable: true };
}

function resultFromRecord(
  record: AskSuggestionsCacheRecord,
  status?: AskSuggestionAssessmentStatus,
  warning?: string,
  stage?: string,
): CachedAskSuggestions {
  return {
    top: record.topQuestions,
    other: record.otherQuestions,
    generatedBy: record.generatedBy,
    cached: true,
    ...(status ? { status } : {}),
    ...(warning ? { warning } : {}),
    ...(stage ? { stage } : {}),
  } as CachedAskSuggestions;
}

async function runRaceSafeRefresh(params: {
  userId: string;
  project: Project;
  scopeKey: string;
  scopeLabel: string;
  requestedSemanticProjectVersion: string;
  publishedInputVersion: string;
  profile?: UserMemoryProfile;
  memories?: DurableMemory[];
  storage: StorageProvider;
  currentRecord: () => Promise<AskSuggestionsCacheRecord | null>;
}): Promise<CachedAskSuggestions> {
  const now = new Date().toISOString();
  const generationId = randomUUID();
  const requestRecord: AskSuggestionsCacheRecord = {
    id: '',
    userId: params.userId,
    projectId: params.project.id,
    scopeKey: params.scopeKey,
    projectStateVersion: params.publishedInputVersion,
    semanticProjectVersion: params.requestedSemanticProjectVersion,
    requestedSemanticProjectVersion: params.requestedSemanticProjectVersion,
    publishedInputVersion: params.publishedInputVersion,
    generationId,
    topQuestions: [],
    otherQuestions: [],
    generatedBy: 'pending',
    createdAt: now,
    updatedAt: now,
    requestedAt: now,
    status: 'preparing',
  };

  const started = await params.storage.beginAskSuggestionsRefresh?.(params.userId, requestRecord);
  if (!started) {
    const current = await params.currentRecord();
    return current
      ? resultFromRecord(current, current.status ?? 'preparing')
      : { top: [], other: [], generatedBy: 'preparing', cached: true, status: 'preparing' } as CachedAskSuggestions;
  }

  try {
    const generated = await generateSuggestions({
      userId: params.userId,
      project: params.project,
      scopeLabel: params.scopeLabel,
    });
    const persistedVersion = await params.storage.getProjectSemanticVersion(params.userId, params.project.id);
    if (persistedVersion === null || persistedVersion !== params.requestedSemanticProjectVersion) {
      const current = await params.currentRecord();
      return current
        ? resultFromRecord(current, current.status ?? 'stale')
        : { top: [], other: [], generatedBy: 'stale', cached: true, status: 'stale' } as CachedAskSuggestions;
    }

    const completedAt = new Date().toISOString();
    const readyRecord: AskSuggestionsCacheRecord = {
      ...requestRecord,
      topQuestions: generated.suggestions.top,
      otherQuestions: generated.suggestions.other,
      generatedBy: generated.generatedBy,
      status: 'ready',
      generatedAt: completedAt,
      updatedAt: completedAt,
    };
    const published = await params.storage.publishAskSuggestionsCache?.(
      params.userId,
      readyRecord,
      generationId,
    );
    if (!published) {
      const current = await params.currentRecord();
      return current
        ? resultFromRecord(current, current.status ?? 'stale')
        : { top: [], other: [], generatedBy: 'stale', cached: true, status: 'stale' } as CachedAskSuggestions;
    }
    return {
      top: generated.suggestions.top,
      other: generated.suggestions.other,
      generatedBy: generated.generatedBy,
      cached: false,
      status: 'ready',
    } as CachedAskSuggestions;
  } catch (error) {
    const stage = failureStage(error);
    console.error('[Gapwise Ask suggestions]', {
      stage,
      projectId: params.project.id,
      message: error instanceof Error ? error.message : 'unknown-error',
    });
    const current = await params.currentRecord();
    const failedRecord: AskSuggestionsCacheRecord = {
      ...requestRecord,
      topQuestions: current?.topQuestions ?? [],
      otherQuestions: current?.otherQuestions ?? [],
      generatedBy: current?.generatedBy ?? 'gapswise-agent',
      status: 'failed',
      failureStage: stage,
      generatedAt: current?.generatedAt,
      updatedAt: new Date().toISOString(),
    };
    const failedPublished = await params.storage.publishAskSuggestionsCache?.(
      params.userId,
      failedRecord,
      generationId,
    );
    const failed = await params.currentRecord();
    if (failedPublished === false && failed && failed.generationId !== generationId) {
      return resultFromRecord(failed, failed.status ?? 'stale');
    }
    return failed
      ? resultFromRecord(failed, 'failed', 'Suggestions could not be updated. Retry when you are ready.', stage)
      : { top: [], other: [], generatedBy: 'failed', cached: false, status: 'failed', warning: 'Suggestions could not be updated.', stage } as CachedAskSuggestions;
  }
}

export async function refreshAskSuggestionsForProjects(params: {
  userId: string;
  projects: Project[];
  profile?: UserMemoryProfile;
  memories?: DurableMemory[];
}): Promise<void> {
  await Promise.all(params.projects.map((project) => refreshAskSuggestionsForProject({
    ...params,
    project,
  })));
}
