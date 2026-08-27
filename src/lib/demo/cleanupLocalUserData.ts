import { deleteContextSourceObjectsForUser } from '@/lib/storage/gcsAssets';
import type { StorageProvider } from '@/lib/storage/types';
import { clearTracesForUser } from '@/lib/observability/trace';

export const LOCAL_DATA_CLEANUP_CONFIRMATION = 'DELETE MY LOCAL DATA';

export interface LocalCleanupPreview {
  projects: number;
  sources: number;
  cloudObjects: number;
  askChats: number;
  askMessages: number;
  askResearch: number;
  snapshots: number;
}

export interface CleanupLocalUserDataResult {
  deleted: LocalCleanupPreview & {
    cloudObjects: number;
    cloudDeletionFailures: Array<{ storageUrl: string; error: string }>;
  };
  partialFailures: Array<{ stage: 'cloud_cleanup' | 'reset'; error: string }>;
}

export async function getLocalCleanupPreview(
  storage: StorageProvider,
  userId: string,
): Promise<LocalCleanupPreview> {
  const [projects, sources, askChats, askMessages, askResearch] = await Promise.all([
    storage.listProjects(userId),
    storage.getSources(userId),
    storage.getAskChats(userId),
    storage.getAskMessages(userId),
    storage.getAskResearch(userId),
  ]);
  const snapshotLists = await Promise.all(
    projects.map((project) => storage.listProjectSnapshots(userId, project.id)),
  );
  const storageUrls = new Set(
    sources
      .map((source) => source.storage_url)
      .filter((url): url is string => Boolean(url?.startsWith('gs://'))),
  );

  return {
    projects: projects.length,
    sources: sources.length,
    cloudObjects: storageUrls.size,
    askChats: askChats.length,
    askMessages: askMessages.length,
    askResearch: askResearch.length,
    snapshots: snapshotLists.reduce((count, snapshots) => count + snapshots.length, 0),
  };
}

export async function cleanupLocalUserData(params: {
  storage: StorageProvider;
  userId: string;
}): Promise<CleanupLocalUserDataResult> {
  const { storage, userId } = params;
  const preview = await getLocalCleanupPreview(storage, userId);
  const sources = await storage.getSources(userId);
  const storageUrls = [...new Set(
    sources
      .map((source) => source.storage_url)
      .filter((url): url is string => Boolean(url?.startsWith('gs://'))),
  )];
  const partialFailures: CleanupLocalUserDataResult['partialFailures'] = [];
  let cloudDeletion = { deleted: 0, failed: [] as Array<{ storageUrl: string; error: string }> };

  try {
    cloudDeletion = await deleteContextSourceObjectsForUser({ userId, storageUrls });
    if (cloudDeletion.failed.length > 0) {
      partialFailures.push({
        stage: 'cloud_cleanup',
        error: cloudDeletion.failed
          .map((item) => `${item.storageUrl}: ${item.error}`)
          .join('; '),
      });
    }
  } catch (error) {
    partialFailures.push({
      stage: 'cloud_cleanup',
      error: error instanceof Error ? error.message : 'Cloud Storage cleanup failed.',
    });
  }

  try {
    // resetUserData is the single Firestore cleanup implementation. It clears
    // all user-scoped project, graph, Ask, history, snapshot, cache, memory,
    // feedback, and app-scope records without touching Auth or other users.
    await storage.resetUserData(userId);
  } catch (error) {
    partialFailures.push({
      stage: 'reset',
      error: error instanceof Error ? error.message : 'User data reset failed.',
    });
    return {
      deleted: {
        ...preview,
        cloudObjects: cloudDeletion.deleted,
        cloudDeletionFailures: cloudDeletion.failed,
      },
      partialFailures,
    };
  }

  clearTracesForUser(userId);

  return {
    deleted: {
      ...preview,
      cloudObjects: cloudDeletion.deleted,
      cloudDeletionFailures: cloudDeletion.failed,
    },
    partialFailures,
  };
}
