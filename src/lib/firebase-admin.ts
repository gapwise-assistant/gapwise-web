import { applicationDefault, getApp, initializeApp, type App } from 'firebase-admin/app';
import { Firestore, getFirestore, initializeFirestore } from 'firebase-admin/firestore';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

let firebaseApp: App | null = null;
let firestoreClient: Firestore | null = null;
const FIREBASE_ADMIN_APP_NAME = 'gapswise-admin';

function getGoogleCloudProjectId(): string {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new StorageError(
      'Firestore mode requires GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT.',
      'CONFIGURATION_ERROR'
    );
  }
  return projectId;
}

export function getFirebaseAdminApp(): App {
  if (firebaseApp) return firebaseApp;

  const projectId = getGoogleCloudProjectId();
  try {
    const existingApp = getApp(FIREBASE_ADMIN_APP_NAME);
    if (existingApp.options.projectId !== projectId) {
      throw new StorageError(
        `Firebase Admin app project mismatch: expected ${projectId}, got ${existingApp.options.projectId ?? 'unknown'}.`,
        'CONFIGURATION_ERROR'
      );
    }
    firebaseApp = existingApp;
    return firebaseApp;
  } catch (error) {
    if (error instanceof StorageError) throw error;
  }

  firebaseApp = initializeApp({
    credential: applicationDefault(),
    projectId,
  }, FIREBASE_ADMIN_APP_NAME);

  return firebaseApp;
}

export function getFirestoreClient(): Firestore {
  assertExternalServicesAllowed('Firestore');
  if (firestoreClient) return firestoreClient;

  const app = getFirebaseAdminApp();
  const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';

  try {
    firestoreClient = initializeFirestore(app, {}, databaseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('already exists')) {
      throw error;
    }
    firestoreClient = getFirestore(app, databaseId);
  }

  return firestoreClient;
}
