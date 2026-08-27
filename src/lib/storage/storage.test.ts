import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadGoldenDemoForUser } from '@/lib/demo/bootstrap';
import { getFirestoreClient } from '@/lib/firebase-admin';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import {
  FIRESTORE_REQUIRED_MESSAGE,
  getStorageMode,
  getStorageProvider,
  listProjects as listUserProjects,
  loadProjectState,
  requireFirestoreStorage,
  resetStorageProviderForTests,
} from '@/lib/storage';
import { MockStorageProvider } from '@/lib/storage/mock';
import { StorageError } from '@/lib/storage/types';
import { collectionsToGeneralContext, generalContextToCollections } from '@/lib/storage/projectMapper';
import { emptyGeneralContext } from '@/lib/scope/projectScope';
import { resolveGap } from '@/lib/tools/graphTools';

const tempDirs: string[] = [];
const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const originalStorageMode = process.env.USE_FIRESTORE;
const originalMockStoragePath = process.env.GAPSWISE_MOCK_STORAGE_PATH;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function makeProvider() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-storage-'));
  tempDirs.push(dir);
  return new MockStorageProvider(path.join(dir, 'db.json'));
}

afterEach(async () => {
  resetStorageProviderForTests();
  restoreEnv('GAPSWISE_DEMO_MODE', originalDemoMode);
  restoreEnv('USE_FIRESTORE', originalStorageMode);
  restoreEnv('GAPSWISE_MOCK_STORAGE_PATH', originalMockStoragePath);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Project bootstrap', () => {
  async function useIsolatedMockStorage(): Promise<MockStorageProvider> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-project-bootstrap-'));
    tempDirs.push(dir);
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(dir, 'db.json');
    resetStorageProviderForTests();
    return getStorageProvider() as MockStorageProvider;
  }

  it('keeps a new authenticated user empty outside demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    const storage = await useIsolatedMockStorage();

    await expect(listUserProjects('firebase-user')).resolves.toEqual([]);
    await expect(loadProjectState('firebase-user')).resolves.toEqual({
      projects: [],
      activeProjectId: null,
      scope: { type: 'everything' },
    });
    await expect(storage.listProjects('firebase-user')).resolves.toEqual([]);
  });

  it('loads the Golden Demo only after an explicit request and keeps it user-scoped', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    const storage = await useIsolatedMockStorage();

    await expect(listUserProjects('firebase-user')).resolves.toEqual([]);
    await expect(loadProjectState('firebase-user')).resolves.toMatchObject({
      projects: [],
      activeProjectId: null,
      scope: { type: 'everything' },
    });

    const firstLoad = await loadGoldenDemoForUser('firebase-user');
    expect(firstLoad.created).toBe(true);
    expect(firstLoad.project.id).toBe(createGoldenDemoProject().id);
    expect(firstLoad.scope).toEqual({ type: 'project', projectId: 'hackathon_demo' });
    expect(firstLoad.project.sources.length).toBeGreaterThan(0);
    expect(firstLoad.project.nodes.length).toBeGreaterThan(0);

    const secondLoad = await loadGoldenDemoForUser('firebase-user');
    expect(secondLoad.created).toBe(false);
    expect((await storage.listProjects('firebase-user'))).toHaveLength(1);
    await expect(storage.getAppScope('firebase-user')).resolves.toEqual({
      type: 'project',
      projectId: 'hackathon_demo',
    });
    await expect(storage.listProjects('demo-user')).resolves.toEqual([]);
  });
});

describe('MockStorageProvider', () => {
  it('keeps projects scoped by userId', async () => {
    const storage = await makeProvider();
    const userOneProject = createGoldenDemoProject();
    const userTwoProject = createGoldenDemoProject();
    userTwoProject.title = 'Other User Project';

    await storage.saveProject('user-one', userOneProject);
    await storage.saveProject('user-two', userTwoProject);

    await expect(storage.getProject('user-one')).resolves.toMatchObject({
      title: 'Gapwise Hackathon Submission',
    });
    await expect(storage.getProject('user-two')).resolves.toMatchObject({
      title: 'Other User Project',
    });
  });

  it('round-trips graph nodes and edges', async () => {
    const storage = await makeProvider();
    const project = createGoldenDemoProject();
    project.nodes.push({
      id: 'node_roundtrip',
      type: 'KNOWN',
      text: 'Round-trip persistence keeps derived graph facts.',
      status: 'RESOLVED',
      confidence: 0.9,
      impact: 0.6,
      source_refs: ['src_1'],
      created_by: 'agent',
      created_at: '2026-08-10T12:00:00Z',
      updated_at: '2026-08-10T12:00:00Z',
    });
    project.edges.push({
      id: 'edge_roundtrip',
      source: 'node_roundtrip',
      target: 'node_goal',
      type: 'supports',
    });

    await storage.saveProject('demo-user', project);
    const loaded = await storage.getProject('demo-user');

    expect(loaded?.nodes.some((node) => node.id === 'node_roundtrip')).toBe(true);
    expect(loaded?.edges.some((edge) => edge.id === 'edge_roundtrip')).toBe(true);
  });

  it('keeps two projects for one user without mixing graph records', async () => {
    const storage = await makeProvider();
    const golden = createGoldenDemoProject();
    const second = createProjectFromInput(
      {
        name: 'Find a new job',
        goal: 'Find a higher-paying backend/AI role by November.',
      },
      '2026-08-11T12:00:00.000Z'
    );

    await storage.saveProject('demo-user', golden);
    await storage.saveProject('demo-user', second);

    const projects = await storage.listProjects('demo-user');
    expect(projects.map((item) => item.title)).toEqual(
      expect.arrayContaining(['Gapwise Hackathon Submission', 'Find a new job'])
    );

    const loadedSecond = await storage.getProject('demo-user', second.id);
    expect(loadedSecond?.nodes).toHaveLength(1);
    expect(loadedSecond?.nodes[0]).toMatchObject({
      type: 'GOAL',
      text: 'Find a higher-paying backend/AI role by November.',
    });
    expect(loadedSecond?.sources).toEqual([]);
  });

  it('keeps user projects isolated when listing multiple projects', async () => {
    const storage = await makeProvider();
    const userOneProject = createProjectFromInput(
      { name: 'User one project', goal: 'User one private goal.' },
      '2026-08-11T12:00:00.000Z'
    );
    const userTwoProject = createProjectFromInput(
      { name: 'User two project', goal: 'User two private goal.' },
      '2026-08-11T13:00:00.000Z'
    );

    await storage.saveProject('user-one', userOneProject);
    await storage.saveProject('user-two', userTwoProject);

    await expect(storage.listProjects('user-one')).resolves.toEqual([
      expect.objectContaining({ title: 'User one project' }),
    ]);
    await expect(storage.listProjects('user-two')).resolves.toEqual([
      expect.objectContaining({ title: 'User two project' }),
    ]);
  });

  it('persists projects across a file-backed provider restart', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-storage-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'db.json');
    const firstProvider = new MockStorageProvider(filePath);
    const project = createProjectFromInput(
      { name: 'Restart-safe project', goal: 'Survive the next provider instance.' },
      '2026-08-11T12:00:00.000Z'
    );

    await firstProvider.saveProject('demo-user', project);
    const restartedProvider = new MockStorageProvider(filePath);

    await expect(restartedProvider.getProject('demo-user', project.id)).resolves.toMatchObject({
      title: 'Restart-safe project',
      nodes: [expect.objectContaining({ type: 'GOAL' })],
    });
  });

  it('persists an answered question, conversation, and user provenance across a provider restart', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-storage-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'db.json');
    const firstProvider = new MockStorageProvider(filePath);
    const project = createGoldenDemoProject();
    const updated = resolveGap(
      project,
      'unknown_target_user',
      'The primary user is an independent hackathon builder.',
      DEFAULT_USER_PROFILE
    );
    const answerNode = updated.nodes.find((node) =>
      node.type === 'KNOWN' && node.text === 'The primary user is an independent hackathon builder.'
    )!;
    answerNode.created_by = 'user';

    await firstProvider.saveProject('demo-user', updated);
    const restartedProvider = new MockStorageProvider(filePath);
    const loaded = await restartedProvider.getProject('demo-user', project.id);

    expect(loaded?.nodes.find((node) => node.id === 'unknown_target_user')).toMatchObject({
      status: 'RESOLVED',
      confidence: 1,
    });
    expect(loaded?.nodes.find((node) => node.id === answerNode.id)).toMatchObject({
      text: 'The primary user is an independent hackathon builder.',
      created_by: 'user',
    });
    expect(loaded?.history.at(-1)).toMatchObject({
      answer: 'The primary user is an independent hackathon builder.',
    });
  });

  it('persists active project selection across a provider restart', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-storage-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'db.json');
    const firstProvider = new MockStorageProvider(filePath);
    const first = createGoldenDemoProject();
    const second = createProjectFromInput(
      { name: 'Learn ADK', goal: 'Become comfortable building ADK agents.' },
      '2026-08-11T12:00:00.000Z'
    );

    await firstProvider.saveProject('demo-user', first);
    await firstProvider.saveProject('demo-user', second);
    await firstProvider.setActiveProjectId('demo-user', second.id);

    const restartedProvider = new MockStorageProvider(filePath);

    await expect(restartedProvider.getActiveProjectId('demo-user')).resolves.toBe(second.id);
    await expect(restartedProvider.getProject('demo-user', second.id)).resolves.toMatchObject({
      title: 'Learn ADK',
    });
  });

  it('defaults scope to Everything and persists project scope across a provider restart', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-storage-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'db.json');
    const firstProvider = new MockStorageProvider(filePath);
    const project = createProjectFromInput(
      { name: 'Learn ADK', goal: 'Become comfortable building ADK agents.' },
      '2026-08-12T12:00:00.000Z'
    );

    await expect(firstProvider.getAppScope('demo-user')).resolves.toEqual({ type: 'everything' });
    await firstProvider.saveProject('demo-user', project);
    await firstProvider.setAppScope('demo-user', { type: 'project', projectId: project.id });

    const restartedProvider = new MockStorageProvider(filePath);
    await expect(restartedProvider.getAppScope('demo-user')).resolves.toEqual({
      type: 'project',
      projectId: project.id,
    });
  });

  it('maps general context into unassigned global records', () => {
    const context = emptyGeneralContext('2026-08-12T12:00:00.000Z');
    context.edges.push({
      id: 'edge_general_supports',
      source: 'node_general_fact',
      target: 'node_general_goal',
      type: 'supports',
      confidence: 0.9,
    });
    context.sources.push({
      id: 'src_general_note',
      filename: 'general-note.txt',
      type: 'note',
      content: 'A general preference without a project.',
      extracted_at: '2026-08-12T12:00:00.000Z',
      derived_node_ids: [],
    });

    const collections = generalContextToCollections('demo-user', context);
    expect(collections.sources[0]).toMatchObject({ scope: 'global' });
    expect(collections.sources[0].projectId).toBeUndefined();
    expect(collections.edges[0]).toMatchObject({ scope: 'global', type: 'supports' });
    expect(collections.edges[0].projectId).toBeUndefined();
    expect(collectionsToGeneralContext(collections).sources[0].id).toBe('src_general_note');
    expect(collectionsToGeneralContext(collections).edges).toEqual([
      expect.objectContaining({ id: 'edge_general_supports', type: 'supports' }),
    ]);
  });

  it('keeps general context isolated when the Golden Demo project is updated', async () => {
    const storage = await makeProvider();
    const project = createGoldenDemoProject();
    const context = emptyGeneralContext('2026-08-12T12:00:00.000Z');
    context.sources.push({
      id: 'src_general_survives', filename: 'general-survives.txt', type: 'note',
      content: 'This source belongs to general context.', extracted_at: '2026-08-12T12:00:00.000Z',
      derived_node_ids: [], processing_status: 'completed',
    });
    await storage.saveProject('demo-user', project);
    const collections = generalContextToCollections('demo-user', context);
    await storage.saveSource('demo-user', collections.sources[0]);
    project.updated_at = '2026-08-12T13:00:00.000Z';
    await storage.saveProject('demo-user', project);

    expect((await storage.getSources('demo-user')).find((source) => source.id === 'src_general_survives')).toMatchObject({ scope: 'global' });
    expect((await storage.getProject('demo-user', project.id))?.sources.some((source) => source.id === 'src_general_survives')).toBe(false);
    expect(collectionsToGeneralContext({ nodes: await storage.getNodes('demo-user'), sources: await storage.getSources('demo-user') }).sources)
      .toEqual([expect.objectContaining({ id: 'src_general_survives' })]);
  });

  it('keeps active project selection isolated by userId', async () => {
    const storage = await makeProvider();
    const userOneProject = createProjectFromInput(
      { name: 'User one active', goal: 'Private active project.' },
      '2026-08-11T12:00:00.000Z'
    );
    const userTwoProject = createProjectFromInput(
      { name: 'User two active', goal: 'Separate private project.' },
      '2026-08-11T13:00:00.000Z'
    );

    await storage.saveProject('user-one', userOneProject);
    await storage.saveProject('user-two', userTwoProject);
    await storage.setActiveProjectId('user-one', userOneProject.id);
    await storage.setActiveProjectId('user-two', userTwoProject.id);

    await expect(storage.getActiveProjectId('user-one')).resolves.toBe(userOneProject.id);
    await expect(storage.getActiveProjectId('user-two')).resolves.toBe(userTwoProject.id);
  });

  it('persists archived project status without removing the project', async () => {
    const storage = await makeProvider();
    const project = createProjectFromInput(
      { name: 'Archive me', goal: 'Move this out of active work.' },
      '2026-08-11T12:00:00.000Z'
    );
    project.status = 'archived';

    await storage.saveProject('demo-user', project);

    await expect(storage.listProjects('demo-user')).resolves.toEqual([
      expect.objectContaining({
        title: 'Archive me',
        status: 'archived',
      }),
    ]);
  });

  it('resets to the same Golden Demo seed every time', async () => {
    const storage = await makeProvider();
    const changed = createGoldenDemoProject();
    changed.title = 'Mutated Title';

    await storage.saveProject('demo-user', changed);
    await storage.resetDemoData('demo-user');
    const firstReset = await storage.getProject('demo-user');
    await storage.resetDemoData('demo-user');
    const secondReset = await storage.getProject('demo-user');

    expect(firstReset?.title).toBe('Gapwise Hackathon Submission');
    expect(secondReset).toEqual(firstReset);
  });

  it('clears all persisted user data when preparing a fresh demo seed', async () => {
    const storage = await makeProvider();
    const project = createProjectFromInput(
      { name: 'Old project', goal: 'This should be removed before the career demo.' },
      '2026-08-11T12:00:00.000Z'
    );
    await storage.saveProject('demo-user', project);
    await storage.saveFeedback('demo-user', {
      id: 'old_feedback',
      userId: 'demo-user',
      question_id: 'old_question',
      node_id: 'old_question',
      rating: 'helpful',
      createdAt: '2026-08-11T12:00:00.000Z',
      updatedAt: '2026-08-11T12:00:00.000Z',
      status: 'active',
    });

    await storage.resetUserData('demo-user');

    await expect(storage.listProjects('demo-user')).resolves.toEqual([]);
    await expect(storage.getMemories('demo-user')).resolves.toEqual([]);
    await expect(storage.getFeedback('demo-user')).resolves.toEqual([]);
    await expect(storage.getAppScope('demo-user')).resolves.toEqual({ type: 'everything' });
  });

  it('retrieves persisted raw Context Source evidence in a Context Pack', async () => {
    const storage = await makeProvider();
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_google_adk_learning',
      filename: 'learning-note.txt',
      type: 'text',
      content: 'I want to learn more about Google ADK this week.',
      extracted_at: '2026-08-11T19:30:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });

    await storage.saveProject('demo-user', project);
    const loaded = await storage.getProject('demo-user');
    expect(loaded).toBeTruthy();

    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'What am I trying to learn?',
      project: loaded!,
      profile: DEFAULT_USER_PROFILE,
    });

    expect(pack.relevantEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: 'src_google_adk_learning',
          excerpt: expect.stringContaining('Google ADK'),
        }),
      ])
    );
    expect(pack.includedContextIds).toContain('src_google_adk_learning');
  });
});

describe('Firestore configuration', () => {
  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  it('reports a clear development error when project configuration is missing', () => {
    const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
    const originalGcloudProject = process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    try {
      expect(() => getFirestoreClient()).toThrow(StorageError);
      expect(() => getFirestoreClient()).toThrow(/GOOGLE_CLOUD_PROJECT/);
    } finally {
      restoreEnv('GOOGLE_CLOUD_PROJECT', originalProject);
      restoreEnv('GCLOUD_PROJECT', originalGcloudProject);
    }
  });

  it('does not fall back to mock storage when Firestore mode is explicitly enabled', () => {
    const originalMode = process.env.USE_FIRESTORE;
    const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
    const originalGcloudProject = process.env.GCLOUD_PROJECT;
    delete process.env.USE_FIRESTORE;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    resetStorageProviderForTests();

    try {
      expect(getStorageMode()).toBe('firestore');
      expect(() => getStorageProvider()).toThrow(StorageError);
      expect(() => getStorageProvider()).toThrow(/GOOGLE_CLOUD_PROJECT/);
    } finally {
      restoreEnv('USE_FIRESTORE', originalMode);
      restoreEnv('GOOGLE_CLOUD_PROJECT', originalProject);
      restoreEnv('GCLOUD_PROJECT', originalGcloudProject);
    }
  });

  it('rejects the Harbor history workflow when durable Firestore is disabled', () => {
    const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
    const originalMode = process.env.USE_FIRESTORE;
    process.env.GAPSWISE_DEMO_MODE = 'false';
    process.env.USE_FIRESTORE = 'false';
    resetStorageProviderForTests();

    try {
      expect(() => requireFirestoreStorage()).toThrow(FIRESTORE_REQUIRED_MESSAGE);
    } finally {
      restoreEnv('GAPSWISE_DEMO_MODE', originalDemoMode);
      restoreEnv('USE_FIRESTORE', originalMode);
    }
  });

  it('uses mock storage only when explicitly disabled', () => {
    const originalMode = process.env.USE_FIRESTORE;
    process.env.USE_FIRESTORE = 'false';
    resetStorageProviderForTests();

    try {
      expect(getStorageMode()).toBe('mock');
      expect(getStorageProvider()).toBeInstanceOf(MockStorageProvider);
    } finally {
      restoreEnv('USE_FIRESTORE', originalMode);
    }
  });
});
