import { askGapswise, type AskFailureStage } from '@/lib/ask/adkClient';
import { generateLocalAskSuggestions } from '@/lib/ask/localDemoAdapter';
import {
  buildSuggestionRequestMessage,
  parseSuggestedQuestions,
} from '@/lib/ask/suggestions';
import {
  getCachedAskSuggestions,
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
    return await getCachedAskSuggestions({
      userId: params.userId,
      project: params.project,
      projectId: params.project.id,
      scopeKey: `project:${params.project.id}`,
      profile,
      memories,
      generate: async () => {
        if (isDemoMode() || params.project.id === CAREER_CONFLICT_DEMO_ID) {
          const suggestions = await generateLocalAskSuggestions({
            userId: params.userId,
            projectId: params.project.id,
          });
          return { suggestions, generatedBy: 'local-context', cacheable: true };
        }

        try {
          const result = await askGapswise({
            userId: params.userId,
            projectId: params.project.id,
            message: `${buildSuggestionRequestMessage(scopeLabel)}\n\n${graphPrompt(params.project)}`,
            structuredResponse: false,
          });
          const suggestions = parseSuggestedQuestions(result.answer);
          if (!suggestions.top.length && !suggestions.other.length) {
            const error = new Error('Gemini returned no structured contextual suggestions.') as Error & { stage: AskFailureStage };
            error.stage = 'gemini';
            throw error;
          }
          return { suggestions, generatedBy: 'gapswise-agent', cacheable: true };
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
      },
    }, { storage });
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
