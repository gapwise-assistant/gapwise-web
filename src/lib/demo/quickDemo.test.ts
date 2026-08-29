import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOrReuseQuickDemoForUser,
  createQuickDemoForUser,
  QUICK_DEMO_GOAL,
  QUICK_DEMO_TITLE,
} from '@/lib/demo/quickDemo';
import { getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';
import { focusAssessmentCacheId, focusProjectStateVersion } from '@/lib/focus/focusCache';
import { overviewProjectStateVersion, projectOverviewAssessmentCacheId } from '@/lib/overview/projectOverviewCache';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { createProjectFromInput } from '@/lib/projects/createProject';

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const originalStorageMode = process.env.USE_FIRESTORE;
const originalStoragePath = process.env.GAPSWISE_MOCK_STORAGE_PATH;
const originalDailyDemoLimit = process.env.GAPSWISE_PUBLIC_DAILY_DEMO_LIMIT;
const temporaryDirectories: string[] = [];

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(async () => {
  resetStorageProviderForTests();
  restoreEnv('GAPSWISE_DEMO_MODE', originalDemoMode);
  restoreEnv('USE_FIRESTORE', originalStorageMode);
  restoreEnv('GAPSWISE_MOCK_STORAGE_PATH', originalStoragePath);
  restoreEnv('GAPSWISE_PUBLIC_DAILY_DEMO_LIMIT', originalDailyDemoLimit);
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function isolatedStorage() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-quick-demo-'));
  temporaryDirectories.push(directory);
  process.env.GAPSWISE_DEMO_MODE = 'true';
  process.env.USE_FIRESTORE = 'false';
  process.env.GAPSWISE_PUBLIC_DAILY_DEMO_LIMIT = '50';
  process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(directory, 'storage.json');
  resetStorageProviderForTests();
  return getStorageProvider();
}

describe('quick Gapwise demo', () => {
  it('creates a small two-moment workspace with grounded assessments', async () => {
    const storage = await isolatedStorage();
    const result = await createQuickDemoForUser({
      userId: 'quick-demo-user',
      storage,
      now: new Date('2026-08-28T15:00:00.000Z'),
    });

    expect(result.project.title).toBe(QUICK_DEMO_TITLE);
    expect(result.project.goal).toBe(QUICK_DEMO_GOAL);
    expect(result.project.historyEvents).toHaveLength(2);
    expect(result.snapshotCount).toBe(2);
    expect(result.finalNodeCount).toBe(10);
    expect(result.finalEdgeCount).toBe(9);
    expect(result.assessmentStatus).toEqual({ focus: 'ready', overview: 'ready', askSuggestions: 'ready' });

    const insurance = result.project.nodes.find((node) => node.text.startsWith('Does the library require'));
    const kitDecision = result.project.nodes.find((node) => node.text.startsWith('Determine how to provide'));
    const venueConfirmation = result.project.nodes.find((node) => node.text.startsWith('The community room is expected'));
    const libraryAction = result.project.nodes.find((node) => node.text.startsWith('Ask the library coordinator'));
    expect(insurance).toMatchObject({ type: 'UNKNOWN', status: 'OPEN' });
    expect(kitDecision).toMatchObject({ type: 'DECISION', status: 'OPEN' });
    expect(venueConfirmation).toMatchObject({ type: 'ASSUMPTION', status: 'OPEN' });
    expect(libraryAction).toMatchObject({ type: 'NEXT_ACTION', status: 'OPEN' });
    expect(result.project.history).toEqual([]);
    expect(result.project.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: libraryAction?.id, target: insurance?.id, type: 'satisfies' }),
      expect.objectContaining({ source: insurance?.id, target: expect.any(String), type: 'informs' }),
    ]));

    const snapshots = await storage.listProjectSnapshots('quick-demo-user', result.project.id);
    expect(snapshots.map((snapshot) => snapshot.trigger.historyEventId)).toEqual([
      result.project.historyEvents?.[0]?.id,
      result.project.historyEvents?.[1]?.id,
    ]);
    for (const snapshot of snapshots) {
      const loaded = await storage.getProjectSnapshot('quick-demo-user', snapshot.id);
      expect(loaded?.projectId).toBe(result.project.id);
    }

    const contextPack = buildContextPack({
      userId: 'quick-demo-user',
      query: 'What is the current strategic state of this workshop?',
      project: result.project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [],
      calendarCommitments: [],
      conversationMessages: [],
      researchEvidence: [],
      includeBroadContext: true,
      scope: { type: 'project', projectId: result.project.id },
    });
    const focusVersion = await focusProjectStateVersion(result.project, contextPack, DEFAULT_USER_PROFILE);
    const focus = await storage.getFocusAssessment('quick-demo-user', focusAssessmentCacheId(result.project.id, focusVersion));
    expect(focus?.assessment).toMatchObject({ targetNodeId: insurance?.id, executionNodeId: libraryAction?.id });

    const overviewVersion = await overviewProjectStateVersion(
      result.project,
      result.project.historyEvents,
      focus?.assessment ?? null,
      contextPack,
      DEFAULT_USER_PROFILE,
    );
    expect(await storage.getProjectOverviewAssessment(
      'quick-demo-user',
      projectOverviewAssessmentCacheId(result.project.id, overviewVersion),
    )).toMatchObject({ projectId: result.project.id });

    const suggestions = await storage.getLatestAskSuggestionsCache('quick-demo-user', result.project.id);
    expect(suggestions).toMatchObject({
      projectId: result.project.id,
      status: 'ready',
      topQuestions: [
        'What should I confirm with the library before finalizing the venue?',
        'How should I cover the eight missing repair kits within the current budget?',
        'What could delay opening workshop registration?',
      ],
    });
  });

  it('uses a readable numeric suffix without overwriting an existing workspace', async () => {
    const storage = await isolatedStorage();
    const first = await createQuickDemoForUser({ userId: 'quick-demo-user', storage, now: new Date('2026-08-28T15:00:00.000Z') });
    const second = await createQuickDemoForUser({ userId: 'quick-demo-user', storage, now: new Date('2026-08-28T15:01:00.000Z') });

    expect(first.project.title).toBe(QUICK_DEMO_TITLE);
    expect(second.project.title).toBe(`${QUICK_DEMO_TITLE} (2)`);
    expect(second.project.id).not.toBe(first.project.id);
    expect(await storage.listProjects('quick-demo-user')).toHaveLength(2);
    expect(first.project.historyEvents).toHaveLength(2);
    expect(second.project.historyEvents).toHaveLength(2);
  });

  it('ignores archived workspaces when choosing the Quick Demo title', async () => {
    const storage = await isolatedStorage();
    const archived = createProjectFromInput({ name: QUICK_DEMO_TITLE, goal: 'An archived workshop.' }, '2026-08-28T14:00:00.000Z');
    archived.status = 'archived';
    await storage.saveProject('quick-demo-user', archived);

    const result = await createQuickDemoForUser({
      userId: 'quick-demo-user',
      storage,
      now: new Date('2026-08-28T15:00:00.000Z'),
    });

    expect(result.project.title).toBe(QUICK_DEMO_TITLE);
    expect((await storage.listProjects('quick-demo-user')).find((project) => project.id === archived.id)).toMatchObject({
      title: QUICK_DEMO_TITLE,
      status: 'archived',
    });
  });

  it('atomically registers one public Quick Demo when creation is requested concurrently', async () => {
    const storage = await isolatedStorage();
    const [first, second] = await Promise.all([
      createOrReuseQuickDemoForUser({ userId: 'public-demo-user', storage }),
      createOrReuseQuickDemoForUser({ userId: 'public-demo-user', storage }),
    ]);

    expect(first.project.id).toBe(second.project.id);
    expect(await storage.listProjects('public-demo-user')).toHaveLength(1);
    expect(await storage.getPublicDemoUsage('public-demo-user')).toMatchObject({
      quickDemoProjectId: first.project.id,
    });
  });
});
