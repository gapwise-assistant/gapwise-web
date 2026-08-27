import { deleteContextSourceObjectsForUser } from '@/lib/storage/gcsAssets';
import type { StorageProvider } from '@/lib/storage/types';
import { clearTracesForUser } from '@/lib/observability/trace';
import { createHarborHistoryDemoForUser, type HarborHistoryDemoResult } from '@/lib/demo/harborHistory';
import { createRiversideHistoryDemoForUser, type RiversideHistoryDemoResult } from '@/lib/demo/riversideHistory';

export const DESTRUCTIVE_HISTORY_RESET_CONFIRMATION = 'DELETE_MY_LOCAL_DATA_AND_REBUILD_DEMOS';

export interface LocalHistoryResetPreview {
  projects: number;
  snapshots: number;
  askChats: number;
  askMessages: number;
  sources: number;
  cloudObjects: number;
}

export interface RebuildHistoryDemosResult {
  deleted: LocalHistoryResetPreview & { cloudObjects: number; cloudDeletionFailures: Array<{ storageUrl: string; error: string }> };
  harbor: HarborHistoryDemoResult | null;
  riverside: RiversideHistoryDemoResult | null;
  projects: Awaited<ReturnType<StorageProvider['listProjects']>>;
  scope: Awaited<ReturnType<StorageProvider['getAppScope']>>;
  partialFailures: Array<{ stage: 'cloud_cleanup' | 'reset' | 'harbor' | 'riverside'; error: string }>;
}

export async function getLocalHistoryResetPreview(storage: StorageProvider, userId: string): Promise<LocalHistoryResetPreview> {
  const [projects, sources, askChats, askMessages] = await Promise.all([
    storage.listProjects(userId),
    storage.getSources(userId),
    storage.getAskChats(userId),
    storage.getAskMessages(userId),
  ]);
  const snapshotLists = await Promise.all(projects.map((project) => storage.listProjectSnapshots(userId, project.id)));
  const cloudObjects = new Set(
    sources
      .map((source) => source.storage_url)
      .filter((url): url is string => Boolean(url?.startsWith('gs://'))),
  );
  return {
    projects: projects.length,
    snapshots: snapshotLists.reduce((count, snapshots) => count + snapshots.length, 0),
    askChats: askChats.length,
    askMessages: askMessages.length,
    sources: sources.length,
    cloudObjects: cloudObjects.size,
  };
}

export async function rebuildHistoryDemosForUser(params: {
  storage: StorageProvider;
  userId: string;
}): Promise<RebuildHistoryDemosResult> {
  const { storage, userId } = params;
  const preview = await getLocalHistoryResetPreview(storage, userId);
  const sources = await storage.getSources(userId);
  const storageUrls = [...new Set(
    sources
      .map((source) => source.storage_url)
      .filter((url): url is string => Boolean(url?.startsWith('gs://'))),
  )];
  const partialFailures: RebuildHistoryDemosResult['partialFailures'] = [];
  const cloudDeletion = await deleteContextSourceObjectsForUser({ userId, storageUrls });
  if (cloudDeletion.failed.length > 0) {
    partialFailures.push({
      stage: 'cloud_cleanup',
      error: cloudDeletion.failed.map((item) => `${item.storageUrl}: ${item.error}`).join('; '),
    });
  }

  try {
    await storage.resetUserData(userId);
  } catch (error) {
    partialFailures.push({ stage: 'reset', error: error instanceof Error ? error.message : 'User data reset failed.' });
    return {
      deleted: { ...preview, cloudObjects: cloudDeletion.deleted, cloudDeletionFailures: cloudDeletion.failed },
      harbor: null,
      riverside: null,
      projects: await storage.listProjects(userId),
      scope: await storage.getAppScope(userId),
      partialFailures,
    };
  }
  clearTracesForUser(userId);

  let harbor: HarborHistoryDemoResult | null = null;
  try {
    harbor = await createHarborHistoryDemoForUser({ userId, fresh: true });
  } catch (error) {
    partialFailures.push({ stage: 'harbor', error: error instanceof Error ? error.message : 'Harbor history demo failed.' });
  }

  let riverside: RiversideHistoryDemoResult | null = null;
  try {
    riverside = await createRiversideHistoryDemoForUser({ userId, fresh: true });
  } catch (error) {
    partialFailures.push({ stage: 'riverside', error: error instanceof Error ? error.message : 'Riverside history demo failed.' });
  }

  const projects = await storage.listProjects(userId);
  const scope = await storage.getAppScope(userId);
  return {
    deleted: { ...preview, cloudObjects: cloudDeletion.deleted, cloudDeletionFailures: cloudDeletion.failed },
    harbor,
    riverside,
    projects,
    scope,
    partialFailures,
  };
}
