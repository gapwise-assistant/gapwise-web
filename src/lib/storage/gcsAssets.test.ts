import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildContextSourceObjectName,
  deleteContextSourceObject,
  deleteContextSourceObjectsForUser,
  makeGsUrl,
  sanitizeObjectFilename,
  uploadContextSourceAsset,
  uploadContextSourcePdf,
} from '@/lib/storage/gcsAssets';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('Cloud Storage context assets', () => {
  const originalBucket = process.env.CLOUD_STORAGE_BUCKET;
  const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

  afterEach(() => {
    restoreEnv('CLOUD_STORAGE_BUCKET', originalBucket);
    restoreEnv('GAPSWISE_DEMO_MODE', originalDemoMode);
  });

  it('blocks Cloud Storage before an injected client can run in demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    process.env.CLOUD_STORAGE_BUCKET = 'gapwise-505217-context';
    const bucket = vi.fn();
    await expect(uploadContextSourcePdf({
      userId: 'demo-user', sourceId: 'src_pdf', filename: 'brief.pdf',
      contentType: 'application/pdf', bytes: Buffer.from('pdf'), storage: { bucket } as any,
    })).rejects.toThrow(/disabled/);
    expect(bucket).not.toHaveBeenCalled();
  });

  it('generates user-scoped object paths with sanitized filenames', () => {
    expect(sanitizeObjectFilename('../Pitch Deck #1.pdf')).toBe('Pitch Deck _1.pdf');
    expect(
      buildContextSourceObjectName({
        userId: 'demo-user',
        sourceId: 'src_123',
        filename: '../Pitch Deck #1.pdf',
      })
    ).toBe('users/demo-user/sources/src_123/Pitch Deck _1.pdf');
  });

  it('uploads PDF bytes to the configured private object path', async () => {
    process.env.CLOUD_STORAGE_BUCKET = 'gapwise-505217-context';
    const save = vi.fn().mockResolvedValue(undefined);
    const file = vi.fn(() => ({ save }));
    const bucket = vi.fn(() => ({ file }));
    const storage = { bucket };

    const result = await uploadContextSourcePdf({
      userId: 'demo-user',
      sourceId: 'src_pdf',
      filename: 'brief.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('pdf bytes'),
      storage: storage as any,
    });

    expect(bucket).toHaveBeenCalledWith('gapwise-505217-context');
    expect(file).toHaveBeenCalledWith('users/demo-user/sources/src_pdf/brief.pdf');
    expect(save).toHaveBeenCalledWith(Buffer.from('pdf bytes'), {
      contentType: 'application/pdf',
      resumable: false,
      metadata: {
        cacheControl: 'private, max-age=0, no-store',
      },
      public: false,
    });
    expect(result).toEqual({
      bucket: 'gapwise-505217-context',
      objectName: 'users/demo-user/sources/src_pdf/brief.pdf',
      storageUrl: makeGsUrl('gapwise-505217-context', 'users/demo-user/sources/src_pdf/brief.pdf'),
    });
  });

  it('uploads non-PDF context assets with their original bytes and content type', async () => {
    process.env.CLOUD_STORAGE_BUCKET = 'gapwise-505217-context';
    const save = vi.fn().mockResolvedValue(undefined);
    const file = vi.fn(() => ({ save }));
    const bucket = vi.fn(() => ({ file }));
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

    await uploadContextSourceAsset({
      userId: 'demo-user',
      sourceId: 'src_voice',
      filename: 'note.webm',
      contentType: 'audio/webm',
      bytes,
      storage: { bucket } as any,
    });

    expect(file).toHaveBeenCalledWith('users/demo-user/sources/src_voice/note.webm');
    expect(save).toHaveBeenCalledWith(bytes, expect.objectContaining({
      contentType: 'audio/webm',
      public: false,
    }));
  });

  it('deletes only objects from the configured bucket', async () => {
    process.env.CLOUD_STORAGE_BUCKET = 'gapwise-505217-context';
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const file = vi.fn(() => ({ delete: deleteObject }));
    const bucket = vi.fn(() => ({ file }));
    const storage = { bucket };

    await deleteContextSourceObject({
      storageUrl: 'gs://gapwise-505217-context/users/demo-user/sources/src_pdf/brief.pdf',
      storage: storage as any,
    });

    expect(bucket).toHaveBeenCalledWith('gapwise-505217-context');
    expect(file).toHaveBeenCalledWith('users/demo-user/sources/src_pdf/brief.pdf');
    expect(deleteObject).toHaveBeenCalledWith({ ignoreNotFound: true });

    await expect(
      deleteContextSourceObject({
        storageUrl: 'gs://other-bucket/users/demo-user/sources/src_pdf/brief.pdf',
        storage: storage as any,
      })
    ).rejects.toThrow(/bucket does not match/);
  });

  it('deletes only configured-bucket objects in the authenticated user path', async () => {
    process.env.CLOUD_STORAGE_BUCKET = 'gapwise-505217-context';
    process.env.GAPSWISE_DEMO_MODE = 'false';
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const file = vi.fn(() => ({ delete: deleteObject }));
    const bucket = vi.fn(() => ({ file }));
    const storage = { bucket };

    const result = await deleteContextSourceObjectsForUser({
      userId: 'demo-user',
      storageUrls: [
        'gs://gapwise-505217-context/users/demo-user/sources/src-1/brief.pdf',
        'gs://gapwise-505217-context/users/another-user/sources/src-2/brief.pdf',
        'gs://other-bucket/users/demo-user/sources/src-3/brief.pdf',
      ],
      storage: storage as any,
    });

    expect(result.deleted).toBe(1);
    expect(result.failed).toHaveLength(2);
    expect(file).toHaveBeenCalledTimes(1);
    expect(file).toHaveBeenCalledWith('users/demo-user/sources/src-1/brief.pdf');
  });
});
