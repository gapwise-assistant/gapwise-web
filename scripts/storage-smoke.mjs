import { randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const bucketName = process.env.CLOUD_STORAGE_BUCKET;

if (!projectId) {
  throw new Error('Set GOOGLE_CLOUD_PROJECT=gapwise-505217 before running the Cloud Storage smoke test.');
}

if (!bucketName) {
  throw new Error('Set CLOUD_STORAGE_BUCKET=gapwise-505217-context before running the Cloud Storage smoke test.');
}

const storage = new Storage({ projectId });
const bucket = storage.bucket(bucketName);
const objectName = `_smoke/${randomUUID()}.txt`;
const file = bucket.file(objectName);
const contents = `Gapswise Cloud Storage smoke test ${objectName}`;

try {
  await file.save(contents, {
    contentType: 'text/plain; charset=utf-8',
    resumable: false,
    metadata: {
      cacheControl: 'no-store',
    },
  });

  const [existsAfterUpload] = await file.exists();
  if (!existsAfterUpload) {
    throw new Error(`Smoke object was not found after upload: gs://${bucketName}/${objectName}`);
  }

  const [downloaded] = await file.download();
  const downloadedText = downloaded.toString('utf8');
  if (downloadedText !== contents) {
    throw new Error(
      `Smoke object contents did not match. Expected ${JSON.stringify(contents)}, got ${JSON.stringify(downloadedText)}.`
    );
  }

  await file.delete();

  const [existsAfterDelete] = await file.exists();
  if (existsAfterDelete) {
    throw new Error(`Smoke object still exists after delete: gs://${bucketName}/${objectName}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId,
        bucket: `gs://${bucketName}`,
        objectName,
      },
      null,
      2
    )
  );
} catch (error) {
  await file.delete({ ignoreNotFound: true }).catch(() => undefined);
  throw error;
}
