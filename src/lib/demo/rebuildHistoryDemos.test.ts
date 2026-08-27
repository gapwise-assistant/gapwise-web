import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from '@/lib/storage/types';

const mocks = vi.hoisted(() => ({
  deleteContextSourceObjectsForUser: vi.fn(),
  clearTracesForUser: vi.fn(),
  createHarborHistoryDemoForUser: vi.fn(),
  createRiversideHistoryDemoForUser: vi.fn(),
}));

vi.mock('@/lib/storage/gcsAssets', () => ({ deleteContextSourceObjectsForUser: mocks.deleteContextSourceObjectsForUser }));
vi.mock('@/lib/observability/trace', () => ({ clearTracesForUser: mocks.clearTracesForUser }));
vi.mock('@/lib/demo/harborHistory', () => ({ createHarborHistoryDemoForUser: mocks.createHarborHistoryDemoForUser }));
vi.mock('@/lib/demo/riversideHistory', () => ({ createRiversideHistoryDemoForUser: mocks.createRiversideHistoryDemoForUser }));

import { getLocalHistoryResetPreview, rebuildHistoryDemosForUser } from '@/lib/demo/rebuildHistoryDemos';

function provider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    kind: 'firestore',
    capabilities: { durableProjectState: true, durableSnapshots: true },
    listProjects: vi.fn().mockResolvedValue([{ id: 'project-one' }, { id: 'project-two' }]),
    getSources: vi.fn().mockResolvedValue([
      { id: 'source-one', storage_url: 'gs://configured/users/local-user/sources/source-one/a.pdf' },
      { id: 'source-two', storage_url: 'https://drive.google.com/file/foreign' },
    ]),
    getAskChats: vi.fn().mockResolvedValue([{ id: 'chat-one' }]),
    getAskMessages: vi.fn().mockResolvedValue([{ id: 'message-one' }]),
    listProjectSnapshots: vi.fn().mockResolvedValue([{ id: 'snapshot-one' }]),
    resetUserData: vi.fn().mockResolvedValue(undefined),
    getAppScope: vi.fn().mockResolvedValue({ type: 'everything' }),
    ...overrides,
  } as unknown as StorageProvider;
}

describe('history demo reset orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteContextSourceObjectsForUser.mockResolvedValue({ deleted: 1, failed: [] });
    mocks.createHarborHistoryDemoForUser.mockResolvedValue({ project: { id: 'harbor' }, projects: [{ id: 'harbor' }] });
    mocks.createRiversideHistoryDemoForUser.mockResolvedValue({ project: { id: 'riverside' }, projects: [{ id: 'harbor' }, { id: 'riverside' }] });
  });

  it('counts only user-scoped stored records and GCS source candidates', async () => {
    const storage = provider();

    await expect(getLocalHistoryResetPreview(storage, 'local-user')).resolves.toEqual({
      projects: 2,
      snapshots: 2,
      askChats: 1,
      askMessages: 1,
      sources: 2,
      cloudObjects: 1,
    });
  });

  it('deletes only GCS sources, resets once, then runs both fresh generators', async () => {
    const storage = provider();

    const result = await rebuildHistoryDemosForUser({ storage, userId: 'local-user' });

    expect(mocks.deleteContextSourceObjectsForUser).toHaveBeenCalledWith({
      userId: 'local-user',
      storageUrls: ['gs://configured/users/local-user/sources/source-one/a.pdf'],
    });
    expect(storage.resetUserData).toHaveBeenCalledTimes(1);
    expect(storage.resetUserData).toHaveBeenCalledWith('local-user');
    expect(mocks.clearTracesForUser).toHaveBeenCalledTimes(1);
    expect(mocks.clearTracesForUser).toHaveBeenCalledWith('local-user');
    expect(mocks.createHarborHistoryDemoForUser).toHaveBeenCalledWith({ userId: 'local-user', fresh: true });
    expect(mocks.createRiversideHistoryDemoForUser).toHaveBeenCalledWith({ userId: 'local-user', fresh: true });
    expect(result.partialFailures).toEqual([]);
    expect(result.projects).toEqual([{ id: 'project-one' }, { id: 'project-two' }]);
  });

  it('returns a partial failure when one generator fails while preserving the successful result', async () => {
    const storage = provider();
    mocks.createHarborHistoryDemoForUser.mockRejectedValue(new Error('Harbor failed'));

    const result = await rebuildHistoryDemosForUser({ storage, userId: 'local-user' });

    expect(result.harbor).toBeNull();
    expect(result.riverside).not.toBeNull();
    expect(result.partialFailures).toEqual([{ stage: 'harbor', error: 'Harbor failed' }]);
  });
});
