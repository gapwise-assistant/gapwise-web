import type { Project, UserMemoryProfile } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import type { SuggestedQuestionGroups } from '@/lib/ask/suggestions';
import type { StorageProvider } from '@/lib/storage/types';
import { getStorageProvider } from '@/lib/storage';
import { hashText } from '@/lib/context/ingestion';
import { activeMemories } from '@/lib/memory/store';

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

function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return values.slice().sort((left, right) => key(left).localeCompare(key(right)));
}

function stableSnapshot(snapshot: {
  text: string;
  type?: string;
  status?: string;
} | undefined) {
  return snapshot
    ? {
      text: snapshot.text,
      type: snapshot.type ?? null,
      status: snapshot.status ?? null,
    }
    : null;
}

function stableHistoryEvent(event: NonNullable<Project['historyEvents']>[number]) {
  return {
    type: event.type,
    title: event.title,
    summary: event.summary ?? null,
    primarySnapshot: stableSnapshot(event.primarySnapshot),
    affectedNodes: (event.affectedNodes ?? [])
      .map((node) => stableSnapshot(node))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    changes: (event.changes ?? [])
      .map((change) => ({
        kind: change.kind,
        text: change.text,
        snapshot: stableSnapshot(change.snapshot),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    focusBefore: event.focusBefore?.title ?? null,
    focusAfter: event.focusAfter?.title ?? null,
  };
}

function isAskConversationSource(source: Project['sources'][number]): boolean {
  return /^ask\s/i.test(source.filename.trim());
}

function semanticProjectState(
  project: Project,
  profile?: UserMemoryProfile,
  memories: DurableMemory[] = [],
) {
  const activeNodes = project.nodes.filter((node) => node.status !== 'DEPRECATED');

  return {
    id: project.id,
    title: project.title,
    goal: project.goal,
    deadline: project.deadline ?? null,
    nodes: sorted(
      activeNodes
        .map((node) => ({
          id: node.id,
          type: node.type,
          text: node.text,
          status: node.status,
          confidence: node.confidence,
          impact: node.impact,
          decision_outcome: node.decision_outcome ?? null,
        })),
      (node) => node.id,
    ),
    edges: sorted(
      project.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        type: edge.type,
      })),
      (edge) => `${edge.source}\u0000${edge.target}\u0000${edge.type}`,
    ),
    sources: [...new Set(
      project.sources
        // Content from a source that already has derived canonical nodes is
        // represented by those nodes. Only retain source content when it is
        // the remaining semantic state for an unrepresented source.
        .filter((source) => source.derived_node_ids.length === 0 && !isAskConversationSource(source))
        .map((source) => source.content),
    )].sort((left, right) => left.localeCompare(right)),
    history: sorted(
      project.history.map((entry) => ({
        question: entry.question,
        answer: entry.answer,
        graph_diff_summary: entry.graph_diff_summary,
      })),
      (entry) => `${entry.question}\u0000${entry.answer}\u0000${entry.graph_diff_summary}`,
    ),
    historyEvents: sorted(
      (project.historyEvents ?? []).map(stableHistoryEvent),
      (event) => JSON.stringify(event),
    ),
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
  };
}

export async function askSuggestionsProjectStateVersion(
  project: Project,
  profile?: UserMemoryProfile,
  memories: DurableMemory[] = [],
): Promise<string> {
  return hashText(JSON.stringify(semanticProjectState(project, profile, memories)));
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
          topQuestions: generated.suggestions.top,
          otherQuestions: generated.suggestions.other,
          generatedBy: generated.generatedBy,
          createdAt: now,
          updatedAt: now,
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
