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

const inFlight = new Map<string, Promise<ProjectOverviewAssessment>>();
const OVERVIEW_CACHE_SCHEMA_VERSION = 2;

export async function overviewProjectStateVersion(
  project: Project,
  history: ProjectHistoryEvent[] = project.historyEvents ?? [],
  focusAssessment: FocusAssessment | null = null,
  contextPack?: ContextPack,
): Promise<string> {
  const meaningfulHistory = history
    .filter((event) => Boolean(event.changes?.length || event.affectedNodeIds?.length || event.primaryNodeId))
    .map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      summary: event.summary,
      sourceNodeIds: event.sourceNodeIds ?? [],
      affectedNodeIds: event.affectedNodeIds ?? [],
      changes: event.changes ?? [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

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
        why_it_matters: node.why_it_matters ?? [],
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: project.edges
      .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }))
      .sort((left, right) => `${left.source}:${left.type}:${left.target}`.localeCompare(`${right.source}:${right.type}:${right.target}`)),
    history: meaningfulHistory,
    focus: focusAssessment
      ? {
        kind: focusAssessment.kind,
        title: focusAssessment.title,
        actionNodeId: focusAssessment.actionNodeId ?? null,
        sourceNodeIds: focusAssessment.sourceNodeIds,
      }
      : null,
    commitments: (contextPack?.upcomingCommitments ?? [])
      .map((node) => ({ id: node.id, text: node.text, status: node.status }))
      .sort((left, right) => left.id.localeCompare(right.id)),
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
      if (cached?.projectStateVersion === projectStateVersion) return cached.assessment;
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
    return assessment;
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
