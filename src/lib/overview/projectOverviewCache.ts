import type { ContextPack } from '@/types/contextPack';
import type { Project, ProjectHistoryEvent } from '@/types/clarity';
import type { StorageProvider } from '@/lib/storage/types';
import { hashText } from '@/lib/context/ingestion';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import {
  generateProjectOverviewAssessment,
  type ProjectOverviewAssessment,
} from '@/lib/overview/projectOverviewAssessment';
import { getStorageProvider } from '@/lib/storage';

export type ProjectOverviewCacheStatus = 'hit' | 'generated';

export interface ProjectOverviewAssessmentCacheResult {
  assessment: ProjectOverviewAssessment;
  cache: {
    status: ProjectOverviewCacheStatus;
    projectStateVersion: string;
  };
}

const inFlight = new Map<string, Promise<ProjectOverviewAssessmentCacheResult>>();
const OVERVIEW_CACHE_SCHEMA_VERSION = 3;

function sortedStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function stableHistoryEvent(event: ProjectHistoryEvent) {
  return {
    type: event.type,
    title: event.title,
    summary: event.summary ?? null,
    primarySnapshot: event.primarySnapshot
      ? {
        text: event.primarySnapshot.text,
        type: event.primarySnapshot.type ?? null,
        status: event.primarySnapshot.status ?? null,
      }
      : null,
    affectedNodes: (event.affectedNodes ?? [])
      .map((node) => ({
        text: node.text,
        type: node.type ?? null,
        status: node.status ?? null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    changes: (event.changes ?? [])
      .map((change) => ({
        kind: change.kind,
        text: change.text,
        snapshot: change.snapshot
          ? {
            text: change.snapshot.text,
            type: change.snapshot.type ?? null,
            status: change.snapshot.status ?? null,
          }
          : null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
}

export async function overviewProjectStateVersion(
  project: Project,
  history: ProjectHistoryEvent[] = project.historyEvents ?? [],
  focusAssessment: FocusAssessment | null = null,
  contextPack?: ContextPack,
): Promise<string> {
  const meaningfulHistory = history
    .filter((event) => Boolean(event.changes?.length || event.affectedNodeIds?.length || event.primaryNodeId))
    .map(stableHistoryEvent)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  const confirmedAnswers = project.history
    .map((entry) => ({
      question: entry.question,
      answer: entry.answer,
      graph_diff_summary: entry.graph_diff_summary,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  return hashText(JSON.stringify({
    goal: project.goal,
    title: project.title,
    deadline: project.deadline ?? null,
    nodes: project.nodes
      .filter((node) => node.status !== 'DEPRECATED')
      .map((node) => ({
        id: node.id,
        type: node.type,
        text: node.text,
        status: node.status,
        confidence: node.confidence,
        impact: node.impact,
        why_it_matters: sortedStrings(node.why_it_matters),
        question_role: node.question_role ?? null,
        canonical_question_id: node.canonical_question_id ?? null,
        canonical_node_id: node.canonical_node_id ?? null,
        reconciliation_classification: node.reconciliation_classification ?? null,
        decision_outcome: node.decision_outcome ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: project.edges
      .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }))
      .sort((left, right) => `${left.source}:${left.type}:${left.target}`.localeCompare(`${right.source}:${right.type}:${right.target}`)),
    confirmedAnswers,
    history: meaningfulHistory,
    focus: focusAssessment
      ? {
        kind: focusAssessment.kind,
        title: focusAssessment.title,
        targetNodeId: focusAssessment.targetNodeId ?? null,
        executionNodeId: focusAssessment.executionNodeId ?? null,
        representedNodeIds: sortedStrings(focusAssessment.representedNodeIds),
        actionNodeId: focusAssessment.actionNodeId ?? null,
        sourceNodeIds: sortedStrings(focusAssessment.sourceNodeIds),
      }
      : null,
    commitments: (contextPack?.upcomingCommitments ?? [])
      .map((node) => ({ type: node.type, text: node.text, status: node.status }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  }));
}

export function projectOverviewAssessmentCacheId(
  projectId: string,
  projectStateVersion: string,
): string {
  return `overview_v${OVERVIEW_CACHE_SCHEMA_VERSION}_${projectId}_${projectStateVersion.slice(0, 24)}`;
}

export async function getCachedProjectOverviewAssessment(
  userId: string,
  project: Project,
  history: ProjectHistoryEvent[] = project.historyEvents ?? [],
  focusAssessment: FocusAssessment | null = null,
  contextPack?: ContextPack,
  deps: {
    storage?: StorageProvider;
    generate?: typeof generateProjectOverviewAssessment;
  } = {},
): Promise<ProjectOverviewAssessment> {
  const result = await getProjectOverviewAssessmentWithMetadata(
    userId,
    project,
    history,
    focusAssessment,
    contextPack,
    deps,
  );
  return result.assessment;
}

export async function getProjectOverviewAssessmentWithMetadata(
  userId: string,
  project: Project,
  history: ProjectHistoryEvent[] = project.historyEvents ?? [],
  focusAssessment: FocusAssessment | null = null,
  contextPack?: ContextPack,
  deps: {
    storage?: StorageProvider;
    generate?: typeof generateProjectOverviewAssessment;
  } = {},
): Promise<ProjectOverviewAssessmentCacheResult> {
  const storage = deps.storage ?? getStorageProvider();
  const generate = deps.generate ?? generateProjectOverviewAssessment;
  const projectStateVersion = await overviewProjectStateVersion(
    project,
    history,
    focusAssessment,
    contextPack,
  );
  const cacheId = projectOverviewAssessmentCacheId(project.id, projectStateVersion);
  const requestKey = `${userId}:${cacheId}`;
  const existing = inFlight.get(requestKey);
  if (existing) return existing;

  const request = (async () => {
    try {
      const cached = await storage.getProjectOverviewAssessment(userId, cacheId);
      if (cached?.projectStateVersion === projectStateVersion) {
        return {
          assessment: cached.assessment,
          cache: { status: 'hit' as const, projectStateVersion },
        };
      }
    } catch {
      // Cache failures must not prevent a fresh assessment from being generated.
    }

    const assessment = await generate(project, history, focusAssessment, contextPack);
    const now = new Date().toISOString();
    try {
      await storage.saveProjectOverviewAssessment(userId, {
        id: cacheId,
        userId,
        projectId: project.id,
        projectStateVersion,
        assessment,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // The current response remains useful even if cache persistence fails.
    }
    return {
      assessment,
      cache: { status: 'generated' as const, projectStateVersion },
    };
  })();

  inFlight.set(requestKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(requestKey);
  }
}

export function clearProjectOverviewAssessmentInFlightForTests(): void {
  inFlight.clear();
}
