import { Project } from '@/types/clarity';
import { AppScope, EVERYTHING_SCOPE, WorkspaceScope } from '@/types/scope';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { FirestoreStorageProvider } from '@/lib/storage/firestore';
import { MockStorageProvider } from '@/lib/storage/mock';
import { StorageError, StorageMode, StorageProvider } from '@/lib/storage/types';
import { collectionsToGeneralContext, generalContextToCollections } from '@/lib/storage/projectMapper';
import { emptyGeneralContext, mergeProjectsForEverything, resolveScope } from '@/lib/scope/projectScope';
import { createLocalDemoProjects } from '@/lib/demo/localFixtures';
import { isDemoMode } from '@/lib/runtime/demoMode';

let provider: StorageProvider | null = null;

export const FIRESTORE_REQUIRED_MESSAGE =
  'Harbor History Demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.';

export function getStorageMode(): StorageMode {
  if (isDemoMode()) return 'mock';
  return process.env.USE_FIRESTORE === 'false' ? 'mock' : 'firestore';
}

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;
  provider = getStorageMode() === 'firestore' ? new FirestoreStorageProvider() : new MockStorageProvider();
  return provider;
}

export function requireFirestoreStorage(): StorageProvider {
  try {
    const storage = getStorageProvider();
    if (
      storage.kind !== 'firestore'
      || !storage.capabilities.durableProjectState
      || !storage.capabilities.durableSnapshots
    ) {
      throw new Error(FIRESTORE_REQUIRED_MESSAGE);
    }
    return storage;
  } catch (error) {
    if (error instanceof StorageError && error.message === FIRESTORE_REQUIRED_MESSAGE) throw error;
    throw new StorageError(FIRESTORE_REQUIRED_MESSAGE, 'CONFIGURATION_ERROR');
  }
}

export function resetStorageProviderForTests(): void {
  provider = null;
}

export async function listProjects(userId: string): Promise<Project[]> {
  const storage = getStorageProvider();
  const stored = await storage.listProjects(userId);
  if (stored.length) return stored;

  if (!isDemoMode()) return [];

  const seeded = createLocalDemoProjects();
  for (const project of seeded) {
    await storage.saveProject(userId, project);
  }
  return seeded;
}

export async function getActiveProjectId(userId: string): Promise<string | null> {
  return getStorageProvider().getActiveProjectId(userId);
}

export async function setActiveProjectId(userId: string, projectId: string): Promise<void> {
  await getStorageProvider().setActiveProjectId(userId, projectId);
}

export async function getAppScope(userId: string): Promise<AppScope> {
  return getStorageProvider().getAppScope(userId);
}

export async function setAppScope(userId: string, scope: AppScope): Promise<void> {
  await getStorageProvider().setAppScope(userId, scope);
}

export async function loadProjectState(userId: string): Promise<{ projects: Project[]; activeProjectId: string | null; scope: WorkspaceScope | null }> {
  const projects = await listProjects(userId);
  const storedActiveProjectId = await getActiveProjectId(userId);
  const storedScope = await getAppScope(userId);
  const scope = resolveScope(storedScope, projects, storedActiveProjectId);

  if (!scope) return { projects, activeProjectId: null, scope: null };

  const storedScopeProjectId = storedScope.type === 'project' ? storedScope.projectId : null;
  if (storedScopeProjectId !== scope.projectId || storedActiveProjectId !== scope.projectId) {
    // This also migrates legacy `{ type: 'everything' }` preferences to the
    // selected real workspace without rebuilding or merging project data.
    await setAppScope(userId, scope);
  }

  return { projects, activeProjectId: scope.projectId, scope };
}

export async function loadGeneralContext(userId: string): Promise<Project> {
  const storage = getStorageProvider();
  const [nodes, sources, edges] = await Promise.all([
    storage.getNodes(userId),
    storage.getSources(userId),
    storage.getEdges(userId),
  ]);
  return collectionsToGeneralContext({ nodes, sources, edges });
}

export async function loadProjectForScope(userId: string, projectId?: string): Promise<{ project: Project; scope: AppScope }> {
  const projects = await listProjects(userId);
  if (projectId) {
    const selected = projects.find((project) => project.id === projectId);
    if (selected) return { project: selected, scope: { type: 'project', projectId } };
  }
  const generalContext = await loadGeneralContext(userId);
  return { project: mergeProjectsForEverything(projects, generalContext), scope: EVERYTHING_SCOPE };
}

export async function saveGeneralContext(userId: string, project: Project): Promise<Project> {
  const storage = getStorageProvider();
  const collections = generalContextToCollections(userId, project);
  const [existingNodes, existingSources, existingEdges] = await Promise.all([
    storage.getNodes(userId),
    storage.getSources(userId),
    storage.getEdges(userId),
  ]);
  const nextNodeIds = new Set(collections.nodes.map((node) => node.id));
  const nextSourceIds = new Set(collections.sources.map((source) => source.id));
  const nextEdgeIds = new Set(collections.edges.map((edge) => edge.id));

  await Promise.all([
    ...existingNodes
      .filter((node) => node.scope === 'global' && !node.projectId && !nextNodeIds.has(node.id))
      .map((node) => storage.deleteNode(userId, node.id)),
    ...existingSources
      .filter((source) => source.scope === 'global' && !source.projectId && !nextSourceIds.has(source.id))
      .map((source) => storage.deleteSource(userId, source.id)),
    ...existingEdges
      .filter((edge) => edge.scope === 'global' && !edge.projectId && !nextEdgeIds.has(edge.id))
      .map((edge) => storage.deleteEdge(userId, edge.id)),
    ...collections.nodes.map((node) => storage.saveNode(userId, node)),
    ...collections.edges.map((edge) => storage.saveEdge(userId, edge)),
    ...collections.sources.map((source) => storage.saveSource(userId, source)),
  ]);
  return project;
}

export async function loadProject(userId: string, projectId?: string): Promise<Project> {
  const projects = await listProjects(userId);
  const existing = projectId
    ? projects.find((project) => project.id === projectId)
    : projects.find((project) => project.status !== 'archived') ?? projects[0];
  if (existing) return existing;

  if (!isDemoMode()) return emptyGeneralContext();

  const seeded = createGoldenDemoProject();
  await getStorageProvider().saveProject(userId, seeded);
  return seeded;
}

export async function saveProject(userId: string, project: Project): Promise<Project> {
  await getStorageProvider().saveProject(userId, project);
  return project;
}

export async function resetDemoProject(userId: string): Promise<Project> {
  if (!isDemoMode()) {
    throw new StorageError('Golden Demo reset is available only in demo mode.', 'VALIDATION_ERROR');
  }
  await getStorageProvider().resetDemoData(userId);
  return loadProject(userId);
}
