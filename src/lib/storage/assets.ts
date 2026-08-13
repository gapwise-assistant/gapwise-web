import { StorageError } from '@/lib/storage/types';

export function getContextAssetsBucket(): string {
  const bucket = process.env.CLOUD_STORAGE_BUCKET?.trim();
  if (!bucket) {
    throw new StorageError(
      'Binary context storage requires CLOUD_STORAGE_BUCKET when Cloud Storage mode is enabled.',
      'CONFIGURATION_ERROR'
    );
  }
  return bucket;
}

export function makeLocalDemoStorageUrl(filename: string): string {
  return `local-demo://${encodeURIComponent(filename)}`;
}
