import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, initializeFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';

if (!projectId) {
  throw new Error('Set GOOGLE_CLOUD_PROJECT=gapwise-505217 before running the Firestore smoke test.');
}

const app = initializeApp({
  credential: applicationDefault(),
  projectId,
});

let db;
try {
  db = initializeFirestore(app, {}, databaseId);
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('already exists')) {
    throw error;
  }
  db = getFirestore(app, databaseId);
}

const smokeRef = db.collection('_smoke').doc(`smoke_${Date.now()}`);
const payload = {
  product: 'Gapswise',
  status: 'ok',
  createdAt: new Date().toISOString(),
};

try {
  await smokeRef.set(payload);
  const snapshot = await smokeRef.get();

  if (!snapshot.exists) {
    throw new Error('Smoke document was not found after write.');
  }

  const data = snapshot.data();
  if (data?.product !== payload.product || data?.status !== payload.status) {
    throw new Error(`Smoke document contents did not round-trip: ${JSON.stringify(data)}`);
  }

  await smokeRef.delete();
  const deleted = await smokeRef.get();
  if (deleted.exists) {
    throw new Error('Smoke document still exists after delete.');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId,
        databaseId,
        collection: '_smoke',
        documentId: smokeRef.id,
      },
      null,
      2
    )
  );
} catch (error) {
  await smokeRef.delete().catch(() => undefined);
  throw error;
}
