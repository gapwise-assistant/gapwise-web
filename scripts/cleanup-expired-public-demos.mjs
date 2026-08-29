import { applicationDefault, getApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, initializeFirestore } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';

const CONFIRM_FLAG = '--confirm';
const now = new Date();
const confirmed = process.argv.includes(CONFIRM_FLAG);
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
const bucketName = process.env.CLOUD_STORAGE_BUCKET;
const configuredOwners = new Set(
  (process.env.GAPSWISE_FULL_ACCESS_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

if (!projectId) throw new Error('Set FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT before running cleanup.');
if (configuredOwners.size === 0) {
  throw new Error('Set GAPSWISE_FULL_ACCESS_EMAILS before running cleanup so owner data can be protected.');
}
if (!bucketName) throw new Error('Set CLOUD_STORAGE_BUCKET before running cleanup.');

let app;
try {
  app = getApp('gapswise-cleanup');
} catch {
  app = initializeApp({ credential: applicationDefault(), projectId }, 'gapswise-cleanup');
}

let db;
try {
  db = initializeFirestore(app, {}, databaseId);
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('already exists')) throw error;
  db = getFirestore(app, databaseId);
}

const auth = getAuth(app);
const cloudStorage = new Storage({ projectId });
const userCollections = [
  'contexts',
  'nodes',
  'edges',
  'sources',
  'conversations',
  'feedback',
  'events',
  'memories',
  'askChats',
  'askMessages',
  'askResearch',
  'focusAssessments',
  'projectOverviewAssessments',
  'askSuggestionAssessments',
  'projectSnapshots',
  'developerGenerationRuns',
  'developerGenerationSteps',
  'googleIntegrations',
];

async function listFirebaseUsers() {
  const users = new Map();
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    page.users.forEach((user) => users.set(user.uid, user));
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

function isConfiguredOwner(user) {
  return Boolean(
    user
    && user.emailVerified === true
    && user.email
    && configuredOwners.has(user.email.trim().toLowerCase()),
  );
}

async function sourceFilesForUser(userId) {
  const prefix = `users/${encodeURIComponent(userId)}/sources/`;
  const [files] = await cloudStorage.bucket(bucketName).getFiles({ prefix });
  return files;
}

async function inspectUser(userRef, usage, userRecord) {
  const counts = { projects: 0, sources: 0, askChats: 0, askMessages: 0, snapshots: 0, files: 0, otherRecords: 0 };
  for (const collectionName of userCollections) {
    const snapshot = await userRef.collection(collectionName).get();
    const count = snapshot.size;
    if (collectionName === 'contexts') counts.projects = count;
    else if (collectionName === 'sources') counts.sources = count;
    else if (collectionName === 'askChats') counts.askChats = count;
    else if (collectionName === 'askMessages') counts.askMessages = count;
    else if (collectionName === 'projectSnapshots') counts.snapshots = count;
    else counts.otherRecords += count;
  }
  counts.files = (await sourceFilesForUser(userRecord.uid)).length;
  return {
    userId: userRecord.uid,
    email: userRecord.email || null,
    quickDemoProjectId: usage.quickDemoProjectId || null,
    expiresAt: usage.expiresAt,
    counts,
  };
}

async function deleteCollectionInBatches(userRef, collectionName) {
  const snapshot = await userRef.collection(collectionName).get();
  for (let start = 0; start < snapshot.docs.length; start += 450) {
    const batch = db.batch();
    snapshot.docs.slice(start, start + 450).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function deleteUserData(candidate) {
  const userRef = db.collection('users').doc(candidate.userId);
  for (const collectionName of userCollections) {
    await deleteCollectionInBatches(userRef, collectionName);
  }

  const preferences = await userRef.collection('preferences').get();
  for (let start = 0; start < preferences.docs.length; start += 450) {
    const batch = db.batch();
    preferences.docs.slice(start, start + 450).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  const files = await sourceFilesForUser(candidate.userId);
  for (const file of files) await file.delete({ ignoreNotFound: true });
}

const firebaseUsers = await listFirebaseUsers();
const usersSnapshot = await db.collection('users').get();
const candidates = [];

for (const userDoc of usersSnapshot.docs) {
  const userRecord = firebaseUsers.get(userDoc.id);
  // A local-development user has no Firebase user record. Requiring a
  // matching Auth record keeps this cleanup limited to real public accounts.
  if (!userRecord || isConfiguredOwner(userRecord)) continue;
  const usageSnapshot = await userDoc.ref.collection('preferences').doc('publicDemoUsage').get();
  if (!usageSnapshot.exists) continue;
  const usage = usageSnapshot.data() || {};
  const expiresAt = typeof usage.expiresAt === 'string' ? Date.parse(usage.expiresAt) : NaN;
  if (!usage.quickDemoProjectId || !Number.isFinite(expiresAt) || expiresAt > now.getTime()) continue;
  candidates.push(await inspectUser(userDoc.ref, usage, userRecord));
}

console.log(JSON.stringify({
  mode: confirmed ? 'delete' : 'dry-run',
  now: now.toISOString(),
  candidateCount: candidates.length,
  candidates,
}, null, 2));

if (!confirmed) {
  console.log(`Dry run only. Re-run with ${CONFIRM_FLAG} to permanently delete these expired public-demo records.`);
} else {
  for (const candidate of candidates) {
    await deleteUserData(candidate);
    console.log(`Deleted expired public-demo data for ${candidate.userId} (project ${candidate.quickDemoProjectId}).`);
  }
  console.log(`Deleted ${candidates.length} expired public-demo account(s).`);
}
