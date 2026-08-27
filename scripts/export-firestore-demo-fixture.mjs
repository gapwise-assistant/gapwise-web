#!/usr/bin/env node

/**
 * Export one user's project-shaped Firestore records into a deterministic,
 * sanitized fixture. This script is intentionally read-only: it only calls
 * Firestore reads and writes the requested local JSON file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, initializeFirestore } from 'firebase-admin/firestore';

const FIXTURE_USER_ID = 'fixture-user';
const BASE_TIMESTAMP_MS = Date.parse('2026-01-01T00:00:00.000Z');
const TIMESTAMP_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'startedAt',
  'completedAt',
  'timestamp',
  'created_at',
  'updated_at',
  'extracted_at',
  'processed_at',
  'discarded_at',
]);
const OMIT_KEYS = new Set([
  'storage_url',
  'storageUrl',
  'signed_url',
  'signedUrl',
  'privateKey',
  'clientEmail',
  'credentials',
  'accessToken',
  'refreshToken',
  'serverUpdatedAt',
  'server_updated_at',
]);

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node scripts/export-firestore-demo-fixture.mjs --user-id USER_ID --project-id PROJECT_ID --output FIXTURE_PATH');
  process.exitCode = 1;
}

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return usage(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  if (!values['user-id'] || !values['project-id'] || !values.output) {
    return usage('All of --user-id, --project-id, and --output are required.');
  }
  return values;
}

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return;
  for (const rawLine of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value.replace(/\\n/g, '\n');
  }
}

function firebaseCredential(projectId) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (!clientEmail && !privateKey) return applicationDefault();
  if (!clientEmail || !privateKey) {
    throw new Error('FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be configured together.');
  }
  return cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') });
}

function toPlainValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return undefined;
  if (Array.isArray(value)) return value.map(toPlainValue).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, toPlainValue(item)])
        .filter(([, item]) => item !== undefined),
    );
  }
  return value;
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 100000000000) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function collectTimestampMs(value, key, output) {
  if (TIMESTAMP_KEYS.has(key)) {
    const parsed = timestampMs(value);
    if (parsed !== undefined) output.push(parsed);
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectTimestampMs(item, '', output));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, childValue]) => collectTimestampMs(childValue, childKey, output));
  }
}

function normalizeTimestamp(value, minimumTimestampMs) {
  const parsed = timestampMs(value);
  if (parsed === undefined) return value;
  return new Date(BASE_TIMESTAMP_MS + parsed - minimumTimestampMs).toISOString();
}

function compactProcessingLog(value) {
  if (!value || typeof value !== 'object') return value;
  const stages = Array.isArray(value.stages)
    ? value.stages.map((stage) => {
        if (!stage || typeof stage !== 'object') return stage;
        const allowed = [
          'name', 'status', 'durationMs', 'startedAt', 'completedAt', 'modelUsed',
          'changedNodeIds', 'candidatePairs', 'classifications',
          'acceptedRelationships', 'rejectedRelationships', 'error',
          'truncated', 'original_size_bytes',
        ];
        return Object.fromEntries(allowed.filter((key) => stage[key] !== undefined).map((key) => [key, stage[key]]));
      })
    : undefined;
  const compact = {
    ...(value.sourceId ? { sourceId: value.sourceId } : {}),
    ...(value.filename ? { filename: value.filename } : {}),
    ...(value.status ? { status: value.status } : {}),
    ...(value.modelUsed ? { modelUsed: value.modelUsed } : {}),
    ...(value.error ? { error: value.error } : {}),
    ...(stages ? { stages } : {}),
    ...(value.project_snapshot ? { project_snapshot: value.project_snapshot } : {}),
    ...(value.projectSnapshot ? { projectSnapshot: value.projectSnapshot } : {}),
  };
  const serialized = JSON.stringify(compact);
  if (Buffer.byteLength(serialized, 'utf8') <= 120000) return compact;
  const shortened = {
    ...compact,
    stages: stages?.map((stage) => ({
      name: stage.name,
      status: stage.status,
      durationMs: stage.durationMs,
      modelUsed: stage.modelUsed,
      changedNodeIds: stage.changedNodeIds,
      acceptedRelationships: stage.acceptedRelationships,
      rejectedRelationships: stage.rejectedRelationships,
      error: stage.error,
    })),
    truncated: true,
    original_size_bytes: Buffer.byteLength(serialized, 'utf8'),
  };
  delete shortened.project_snapshot;
  delete shortened.projectSnapshot;
  return shortened;
}

function sanitizeValue(value, minimumTimestampMs, key = '') {
  if (OMIT_KEYS.has(key)) return undefined;
  if (TIMESTAMP_KEYS.has(key)) return normalizeTimestamp(value, minimumTimestampMs);
  if (typeof value === 'string') return value.length > 8000 ? `${value.slice(0, 8000)}…` : value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, minimumTimestampMs)).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, minimumTimestampMs, childKey)])
      .filter(([, childValue]) => childValue !== undefined),
  );
}

function replaceProjectIdentity(value, fixtureProjectId, key = '') {
  if (Array.isArray(value)) return value.map((item) => replaceProjectIdentity(item, fixtureProjectId, key));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (childKey === 'userId' || childKey === 'user_id') result[childKey] = FIXTURE_USER_ID;
    else if (childKey === 'projectId' || childKey === 'project_id' || childKey === 'sourceProjectId') result[childKey] = fixtureProjectId;
    else if (childKey === 'id' && (key === 'context' || key === 'project' || key === 'projectState')) result[childKey] = fixtureProjectId;
    else result[childKey] = replaceProjectIdentity(childValue, fixtureProjectId, childKey);
  }
  return result;
}

function sanitizeRecord(record, minimumTimestampMs, fixtureProjectId, collectionName) {
  let result = sanitizeValue(record, minimumTimestampMs);
  result = replaceProjectIdentity(result, fixtureProjectId);
  if (collectionName === 'contexts') result.id = fixtureProjectId;
  if (collectionName === 'sources') {
    result.content = '';
    delete result.storage_url;
    delete result.storageUrl;
    if (result.processing_log) result.processing_log = compactProcessingLog(result.processing_log);
  }
  if (collectionName === 'projectSnapshots' && result.execution) {
    result.execution = result.execution.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const copy = { ...item };
      delete copy.prompt;
      delete copy.rawResponse;
      delete copy.response;
      return copy;
    });
  }
  return result;
}

function compactSnapshotRecord(record, minimumTimestampMs, fixtureProjectId) {
  const sanitized = sanitizeRecord(record, minimumTimestampMs, fixtureProjectId, 'projectSnapshots');
  const references = sanitized.references ?? {
    sourceIds: sanitized.project?.sources?.map((source) => source.id) ?? [],
    chatIds: sanitized.ask?.chats?.map((chat) => chat.id) ?? [],
    messageIds: sanitized.ask?.messages?.map((message) => message.id) ?? [],
    researchIds: sanitized.ask?.research?.map((item) => item.id) ?? [],
    traceIds: [],
  };
  return {
    id: sanitized.id,
    userId: sanitized.userId,
    projectId: sanitized.projectId,
    sequence: sanitized.sequence,
    createdAt: sanitized.createdAt,
    schemaVersion: sanitized.schemaVersion,
    trigger: sanitized.trigger,
    label: sanitized.label,
    ...(sanitized.summary ? { summary: sanitized.summary } : {}),
    references,
    proposalStates: sanitized.proposalStates ?? [],
    listSummary: sanitized.listSummary,
  };
}

function fixtureProjectId(originalProjectId) {
  const readable = originalProjectId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `fixture-project-${readable || 'project'}`;
}

async function readCollection(userRef, name) {
  const snapshot = await userRef.collection(name).get();
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.data().id ?? doc.id }));
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
  const args = readArguments(process.argv.slice(2));
  if (!args) return;
  const googleProjectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!googleProjectId) throw new Error('Firestore project configuration is missing.');
  const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
  const appName = `fixture-export-${process.pid}`;
  const app = getApps().find((candidate) => candidate.name === appName)
    || initializeApp({ credential: firebaseCredential(googleProjectId), projectId: googleProjectId }, appName);
  let db;
  try {
    db = initializeFirestore(app, {}, databaseId);
  } catch (error) {
    if (!String(error?.message ?? error).includes('already exists')) throw error;
    db = getFirestore(app, databaseId);
  }

  const userRef = db.collection('users').doc(args['user-id']);
  const collectionNames = [
    'contexts', 'nodes', 'edges', 'sources', 'conversations', 'askChats',
    'askMessages', 'askResearch', 'projectSnapshots', 'developerGenerationRuns',
    'developerGenerationSteps',
  ];
  const records = Object.fromEntries(await Promise.all(collectionNames.map(async (name) => [name, await readCollection(userRef, name)])));
  const context = records.contexts.find((item) => item.id === args['project-id'] || item.projectId === args['project-id']);
  if (!context) throw new Error(`Project ${args['project-id']} was not found for the requested user.`);

  const belongs = (record) => record.projectId === args['project-id'] || record.project_id === args['project-id'];
  const scoped = {};
  for (const name of collectionNames) {
    if (name === 'contexts') scoped[name] = [context];
    else scoped[name] = records[name].filter(belongs);
  }
  const allValues = Object.values(scoped).flat();
  const timestamps = [];
  allValues.forEach((value) => collectTimestampMs(value, '', timestamps));
  const minimumTimestampMs = timestamps.length ? Math.min(...timestamps) : BASE_TIMESTAMP_MS;
  const targetProjectId = fixtureProjectId(args['project-id']);
  const collections = Object.fromEntries(Object.entries(scoped).slice(0, 5).map(([name, values]) => [
    name,
    values.map((value) => sanitizeRecord(toPlainValue(value), minimumTimestampMs, targetProjectId, name)),
  ]));
  const ask = Object.fromEntries(Object.entries(scoped).slice(5, 8).map(([name, values]) => [
    name.replace(/^ask/, '').replace(/^./, (character) => character.toLowerCase()),
    values.map((value) => sanitizeRecord(toPlainValue(value), minimumTimestampMs, targetProjectId, name)),
  ]));
  const snapshots = scoped.projectSnapshots.map((value) => compactSnapshotRecord(toPlainValue(value), minimumTimestampMs, targetProjectId));
  const generationRuns = scoped.developerGenerationRuns.map((value) => sanitizeRecord(toPlainValue(value), minimumTimestampMs, targetProjectId, 'developerGenerationRuns'));
  const generationSteps = scoped.developerGenerationSteps.map((value) => sanitizeRecord(toPlainValue(value), minimumTimestampMs, targetProjectId, 'developerGenerationSteps'));
  const failedRun = generationRuns.find((run) => run.status === 'failed');
  const completeRun = generationRuns.find((run) => run.status === 'completed');
  const originalStatus = failedRun ? 'failed' : completeRun ? 'complete' : 'available_without_generation_run';
  const fixture = {
    fixtureVersion: 1,
    generator: completeRun?.generator ?? failedRun?.generator ?? context.title,
    originalStatus,
    originalFailure: failedRun?.error ?? null,
    original: { userId: args['user-id'], projectId: args['project-id'], title: context.title },
    userId: FIXTURE_USER_ID,
    projectId: targetProjectId,
    collections,
    ask: {
      chats: ask.chats ?? [],
      messages: ask.messages ?? [],
      research: ask.research ?? [],
    },
    snapshots,
    developerGeneration: { runs: generationRuns, steps: generationSteps },
    manifest: {
      fixtureVersion: 1,
      generator: completeRun?.generator ?? failedRun?.generator ?? context.title,
      originalStatus,
      originalFailure: failedRun?.error ?? null,
      counts: {
        nodes: collections.nodes.length,
        edges: collections.edges.length,
        sources: collections.sources.length,
        historyEvents: Array.isArray(context.historyEvents) ? context.historyEvents.length : 0,
        chats: ask.chats?.length ?? 0,
        messages: ask.messages?.length ?? 0,
        snapshots: snapshots.length,
      },
    },
  };
  const outputPath = path.resolve(process.cwd(), args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    output: args.output,
    capturedProjectId: args['project-id'],
    fixtureProjectId: targetProjectId,
    originalStatus,
    counts: fixture.manifest.counts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
