import { Storage } from '@google-cloud/storage';
import { getContextAssetsBucket } from '@/lib/storage/assets';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

interface ContextSourceObjectInput {
  userId: string;
  sourceId: string;
  filename: string;
}

export interface UploadContextSourceAssetInput extends ContextSourceObjectInput {
  bytes: Buffer;
  contentType: string;
  storage?: Storage;
}

/** @deprecated Use UploadContextSourceAssetInput for non-PDF Context files. */
export type UploadContextSourcePdfInput = UploadContextSourceAssetInput;

interface DeleteContextSourceObjectInput {
  storageUrl: string;
  storage?: Storage;
}

export interface DeleteContextSourceObjectsForUserResult {
  deleted: number;
  failed: Array<{ storageUrl: string; error: string }>;
}

function assertPathPart(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new StorageError(`${label} is required for Cloud Storage context assets.`, 'VALIDATION_ERROR');
  }
  return trimmed;
}

export function sanitizeObjectFilename(filename: string): string {
  const trimmed = assertPathPart(filename, 'filename');
  const withoutPath = trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? 'source';
  return withoutPath.replace(/[^a-zA-Z0-9._ -]/g, '_');
}

export function buildContextSourceObjectName(input: ContextSourceObjectInput): string {
  const userId = encodeURIComponent(assertPathPart(input.userId, 'userId'));
  const sourceId = encodeURIComponent(assertPathPart(input.sourceId, 'sourceId'));
  return `users/${userId}/sources/${sourceId}/${sanitizeObjectFilename(input.filename)}`;
}

export function makeGsUrl(bucket: string, objectName: string): string {
  return `gs://${bucket}/${objectName}`;
}

export function parseGsUrl(storageUrl: string): { bucket: string; objectName: string } {
  if (!storageUrl.startsWith('gs://')) {
    throw new StorageError('Only gs:// Cloud Storage URLs can be deleted as context assets.', 'VALIDATION_ERROR');
  }

  const withoutScheme = storageUrl.slice('gs://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) {
    throw new StorageError('Invalid Cloud Storage URL for context asset.', 'VALIDATION_ERROR');
  }

  return {
    bucket: withoutScheme.slice(0, slashIndex),
    objectName: withoutScheme.slice(slashIndex + 1),
  };
}

function assertUserObjectName(objectName: string, userId: string): void {
  const encodedUserId = encodeURIComponent(assertPathPart(userId, 'userId'));
  const expectedPrefix = `users/${encodedUserId}/sources/`;
  if (!objectName.startsWith(expectedPrefix)) {
    throw new StorageError(
      'Context asset object does not belong to the authenticated user.',
      'PERMISSION_DENIED',
    );
  }
}

export async function uploadContextSourceAsset(input: UploadContextSourceAssetInput): Promise<{
  bucket: string;
  objectName: string;
  storageUrl: string;
}> {
  assertExternalServicesAllowed('Google Cloud Storage');
  const bucket = getContextAssetsBucket();
  const objectName = buildContextSourceObjectName(input);
  const storage = input.storage ?? new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT });

  try {
    await storage.bucket(bucket).file(objectName).save(input.bytes, {
      contentType: input.contentType || 'application/pdf',
      resumable: false,
      metadata: {
        cacheControl: 'private, max-age=0, no-store',
      },
      public: false,
    });
  } catch (error) {
    throw new StorageError(
      error instanceof Error ? `Cloud Storage context asset upload failed: ${error.message}` : 'Cloud Storage context asset upload failed.',
      'UNAVAILABLE'
    );
  }

  return {
    bucket,
    objectName,
    storageUrl: makeGsUrl(bucket, objectName),
  };
}

/**
 * Compatibility name retained for the legacy PDF-only storage endpoint and
 * existing demo generators. The Context ingest route uses the generic asset
 * function above for every uploaded attachment.
 */
export async function uploadContextSourcePdf(input: UploadContextSourcePdfInput): Promise<{
  bucket: string;
  objectName: string;
  storageUrl: string;
}> {
  return uploadContextSourceAsset(input);
}

export async function deleteContextSourceObject(input: DeleteContextSourceObjectInput): Promise<void> {
  assertExternalServicesAllowed('Google Cloud Storage');
  const expectedBucket = getContextAssetsBucket();
  const { bucket, objectName } = parseGsUrl(input.storageUrl);
  if (bucket !== expectedBucket) {
    throw new StorageError('Context asset bucket does not match configured CLOUD_STORAGE_BUCKET.', 'VALIDATION_ERROR');
  }

  const storage = input.storage ?? new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT });
  try {
    await storage.bucket(bucket).file(objectName).delete({ ignoreNotFound: true });
  } catch (error) {
    throw new StorageError(
      error instanceof Error ? `Cloud Storage context asset delete failed: ${error.message}` : 'Cloud Storage context asset delete failed.',
      'UNAVAILABLE'
    );
  }
}

/**
 * Deletes only the authenticated user's source objects. Invalid, foreign, or
 * non-GCS URLs are reported individually so a reset can finish while making
 * any cleanup problem explicit.
 */
export async function deleteContextSourceObjectsForUser(input: {
  userId: string;
  storageUrls: string[];
  storage?: Storage;
}): Promise<DeleteContextSourceObjectsForUserResult> {
  assertExternalServicesAllowed('Google Cloud Storage');
  const expectedBucket = getContextAssetsBucket();
  const storage = input.storage ?? new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT });
  const result: DeleteContextSourceObjectsForUserResult = { deleted: 0, failed: [] };

  for (const storageUrl of input.storageUrls) {
    try {
      const { bucket, objectName } = parseGsUrl(storageUrl);
      if (bucket !== expectedBucket) {
        throw new StorageError('Context asset bucket does not match configured CLOUD_STORAGE_BUCKET.', 'VALIDATION_ERROR');
      }
      assertUserObjectName(objectName, input.userId);
      await storage.bucket(bucket).file(objectName).delete({ ignoreNotFound: true });
      result.deleted += 1;
    } catch (error) {
      result.failed.push({
        storageUrl,
        error: error instanceof Error ? error.message : 'Cloud Storage object deletion failed.',
      });
    }
  }

  return result;
}
