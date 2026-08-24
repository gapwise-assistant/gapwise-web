import type { Project, UserMemoryProfile } from '@/types/clarity';
import type { ContextPack } from '@/types/contextPack';
import type { StorageProvider } from '@/lib/storage/types';
import { hashText } from '@/lib/context/ingestion';
import { getStorageProvider } from '@/lib/storage';
import { generateFocusAssessment, type FocusAssessment } from '@/lib/focus/focusAssessment';

const inFlight = new Map<string, Promise<FocusAssessment | null>>();
const FOCUS_CACHE_SCHEMA_VERSION = 5;
const FOCUS_NODE_TYPES = new Set([
  'GOAL',
  'DECISION',
  'UNKNOWN',
  'ASSUMPTION',
  'RISK',
  'CONSTRAINT',
  'PREFERENCE',
  'EVIDENCE',
  'KNOWN',
  'NEXT_ACTION',
]);

export async function focusProjectStateVersion(
  project: Project,
  _contextPack?: ContextPack,
  _profile?: UserMemoryProfile,
): Promise<string> {
  const focusState = {
    goal: project.goal,
    deadline: project.deadline ?? null,
    nodes: project.nodes
      .filter((node) => FOCUS_NODE_TYPES.has(node.type))
      .map((node) => ({
        id: node.id,
        type: node.type,
        text: node.text,
        status: node.status,
        confidence: node.confidence,
        impact: node.impact,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: project.edges
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        confidence: edge.confidence ?? null,
      }))
      .sort((left, right) =>
        `${left.source}\u0000${left.target}\u0000${left.type}\u0000${left.confidence ?? ''}`.localeCompare(
          `${right.source}\u0000${right.target}\u0000${right.type}\u0000${right.confidence ?? ''}`,
        )
      ),
  };

  return hashText(JSON.stringify(focusState));
}

export function focusAssessmentCacheId(projectId: string, projectStateVersion: string): string {
  return `focus_v${FOCUS_CACHE_SCHEMA_VERSION}_${projectId}_${projectStateVersion.slice(0, 24)}`;
}

export async function getCachedFocusAssessment(
  userId: string,
  project: Project,
  contextPack: ContextPack,
  profile?: UserMemoryProfile,
  deps: {
    storage?: StorageProvider;
    generate?: typeof generateFocusAssessment;
  } = {},
): Promise<FocusAssessment | null> {
  const storage = deps.storage ?? getStorageProvider();
  const generate = deps.generate ?? generateFocusAssessment;
  const projectStateVersion = await focusProjectStateVersion(project, contextPack, profile);
  const cacheId = focusAssessmentCacheId(project.id, projectStateVersion);
  const requestKey = `${userId}:${cacheId}`;

  const existingRequest = inFlight.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    try {
      const cached = await storage.getFocusAssessment(userId, cacheId);
      if (cached?.projectStateVersion === projectStateVersion) return cached.assessment;
    } catch {
      // A cache outage must not make Today or Ask unavailable.
    }

    const assessment = await generate(project, contextPack, profile);
    const now = new Date().toISOString();
    try {
      await storage.saveFocusAssessment(userId, {
        id: cacheId,
        userId,
        projectId: project.id,
        projectStateVersion,
        assessment,
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Return the generated assessment even when the cross-request cache is unavailable.
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

export function clearFocusAssessmentInFlightForTests(): void {
  inFlight.clear();
}
