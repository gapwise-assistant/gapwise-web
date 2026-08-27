import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupLocalUserData, getLocalCleanupPreview } from '@/lib/demo/cleanupLocalUserData';

const mocks = vi.hoisted(() => ({
  deleteContextSourceObjectsForUser: vi.fn(),
  clearTracesForUser: vi.fn(),
}));

vi.mock('@/lib/storage/gcsAssets', () => ({
  deleteContextSourceObjectsForUser: mocks.deleteContextSourceObjectsForUser,
}));
vi.mock('@/lib/observability/trace', () => ({
  clearTracesForUser: mocks.clearTracesForUser,
}));

function makeStorage() {
  return {
    listProjects: vi.fn().mockResolvedValue([
      { id: 'project-one' },
      { id: 'project-two' },
    ]),
    getSources: vi.fn().mockResolvedValue([
      { id: 'source-one', storage_url: 'gs://bucket/users/local-user/sources/source-one/file.pdf' },
      { id: 'source-two', storage_url: 'local-demo://file.txt' },
    ]),
    getAskChats: vi.fn().mockResolvedValue([{ id: 'chat-one' }]),
    getAskMessages: vi.fn().mockResolvedValue([{ id: 'message-one' }, { id: 'message-two' }]),
    getAskResearch: vi.fn().mockResolvedValue([{ id: 'research-one' }]),
    listProjectSnapshots: vi.fn().mockResolvedValue([{ id: 'snapshot-one' }]),
    resetUserData: vi.fn().mockResolvedValue(undefined),
  };
}

describe('cleanupLocalUserData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteContextSourceObjectsForUser.mockResolvedValue({ deleted: 1, failed: [] });
  });

  it('builds a user-scoped preview without changing data', async () => {
    const storage = makeStorage();

    await expect(getLocalCleanupPreview(storage as never, 'local-user')).resolves.toEqual({
      projects: 2,
      sources: 2,
      cloudObjects: 1,
      askChats: 1,
      askMessages: 2,
      askResearch: 1,
      snapshots: 2,
    });
    expect(storage.resetUserData).not.toHaveBeenCalled();
  });

  it('deletes only referenced user assets before reusing the Firestore reset path', async () => {
    const storage = makeStorage();

    const result = await cleanupLocalUserData({ storage: storage as never, userId: 'local-user' });

    expect(mocks.deleteContextSourceObjectsForUser).toHaveBeenCalledWith({
      userId: 'local-user',
      storageUrls: ['gs://bucket/users/local-user/sources/source-one/file.pdf'],
    });
    expect(storage.resetUserData).toHaveBeenCalledWith('local-user');
    expect(mocks.clearTracesForUser).toHaveBeenCalledWith('local-user');
    expect(result.partialFailures).toEqual([]);
    expect(result.deleted.cloudObjects).toBe(1);
  });

  it('keeps the database cleanup moving and reports a Cloud Storage failure', async () => {
    const storage = makeStorage();
    mocks.deleteContextSourceObjectsForUser.mockRejectedValueOnce(new Error('bucket unavailable'));

    const result = await cleanupLocalUserData({ storage: storage as never, userId: 'local-user' });

    expect(storage.resetUserData).toHaveBeenCalledWith('local-user');
    expect(result.partialFailures).toEqual([{ stage: 'cloud_cleanup', error: 'bucket unavailable' }]);
  });
});
