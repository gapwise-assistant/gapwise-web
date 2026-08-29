import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSoftwareReleaseDemoForUser, clearSoftwareReleaseDemoLocksForTests } from '@/lib/demo/softwareReleaseDemo';
import { getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { focusAssessmentCacheId, focusProjectStateVersion } from '@/lib/focus/focusCache';
import { clearTracesForUser, listTraces } from '@/lib/observability/trace';

describe('RelayDesk software release deterministic demo', () => {
  let tempDirectory = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-software-demo-'));
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_DEMO_MODE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(tempDirectory, 'storage.json');
    delete process.env.CLOUD_STORAGE_BUCKET;
    resetStorageProviderForTests();
    clearSoftwareReleaseDemoLocksForTests();
    clearTracesForUser('software-demo-user');
  });

  afterEach(async () => {
    clearSoftwareReleaseDemoLocksForTests();
    clearTracesForUser('software-demo-user');
    resetStorageProviderForTests();
    delete process.env.GAPSWISE_MOCK_STORAGE_PATH;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('persists a late-middle project with cached deterministic state and no AI work', async () => {
    const storage = getStorageProvider();
    const result = await createSoftwareReleaseDemoForUser({
      userId: 'software-demo-user',
      storage,
      now: new Date('2026-08-29T09:00:00.000Z'),
    });

    expect(result.execution).toBe('simulated');
    expect(result.aiCalls).toBe(0);
    expect(result.finalNodeCount).toBe(24);
    expect(result.finalEdgeCount).toBe(31);
    expect(result.sourceCount).toBe(7);
    expect(result.chatCount).toBe(2);
    expect(result.messageCount).toBe(4);
    expect(result.proposalCount).toBe(3);
    expect(result.snapshotCount).toBe(result.historyEventCount);

    const project = await storage.getProject('software-demo-user', result.project.id);
    expect(project?.title).toBe('RelayDesk Offline Sync Release');
    expect(project?.nodes.find((node) => node.text.startsWith('Choose the browser storage'))).toMatchObject({
      type: 'DECISION',
      status: 'RESOLVED',
    });
    expect(project?.nodes.find((node) => node.text.includes('operation UUID'))).toMatchObject({
      type: 'DECISION',
      status: 'RESOLVED',
    });
    expect(project?.nodes.find((node) => node.text.includes('launch offline sync'))?.status).toBe('OPEN');

    const nodeIds = new Set(project?.nodes.map((node) => node.id));
    const edgeSignatures = project?.edges.map((edge) => `${edge.source}:${edge.type}:${edge.target}`) ?? [];
    expect(new Set(edgeSignatures).size).toBe(edgeSignatures.length);
    expect(project?.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))).toBe(true);
    expect(project?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.stringContaining('timeoutAction'), type: 'satisfies' }),
      expect.objectContaining({ source: expect.stringContaining('retryQuestion'), type: 'blocks' }),
      expect.objectContaining({ source: expect.stringContaining('monitoring'), type: 'affects' }),
    ]));
    expect(project?.edges.find((edge) => edge.source.includes('metricsAction'))?.type).toBe('affects');
    expect(project?.edges.find((edge) => edge.source.includes('featureFlagAction'))?.type).toBe('affects');
    expect(project?.nodes.filter((node) => node.type === 'NEXT_ACTION').every((node) => node.status === 'OPEN')).toBe(true);
    expect(project?.sources.map((source) => source.filename)).toEqual(expect.arrayContaining([
      'RelayDesk Offline Sync Product Brief.pdf',
      'offline-sync-architecture.md',
      'syncWorker.ts',
      'offline-sync-timeout-test.txt',
      'Safari Offline Queue Compatibility Report.pdf',
      'Offline Data Security Review.pdf',
    ]));
    expect(await storage.getAppScope('software-demo-user')).toEqual({ type: 'project', projectId: result.project.id });

    const retryQuestion = project?.nodes.find((node) => node.text.includes('below 0.1%'));
    expect(retryQuestion?.status).toBe('OPEN');
    const messages = (await storage.getAskMessages('software-demo-user'))
      .filter((message) => message.projectId === result.project.id);
    const firstConversation = messages.filter((message) => message.chatId.includes('duplicate-work-orders'))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    expect(firstConversation.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(Date.parse(firstConversation[1]!.createdAt)).toBeGreaterThan(Date.parse(firstConversation[0]!.createdAt));
    const focusVersion = await focusProjectStateVersion(project!, undefined, DEFAULT_USER_PROFILE);
    const focus = await storage.getFocusAssessment('software-demo-user', focusAssessmentCacheId(project!.id, focusVersion));
    expect(focus?.assessment).toMatchObject({
      targetNodeId: retryQuestion?.id,
      actionNodeId: retryQuestion?.id,
    });

    const snapshots = await storage.listProjectSnapshots('software-demo-user', result.project.id);
    expect(snapshots.every((snapshot) => snapshot.trigger.historyEventId)).toBe(true);
    expect(new Set(snapshots.map((snapshot) => snapshot.trigger.historyEventId)).size).toBe(snapshots.length);
    expect(listTraces('software-demo-user')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        route: '/api/demos/software-release',
        simulation: true,
        model: 'deterministic-fixture',
      }),
    ]));
  });

  it('deduplicates concurrent creation but gives a later explicit run an active-only title suffix', async () => {
    const storage = getStorageProvider();
    const [first, second] = await Promise.all([
      createSoftwareReleaseDemoForUser({ userId: 'software-demo-user', storage, now: new Date('2026-08-29T09:00:00.000Z') }),
      createSoftwareReleaseDemoForUser({ userId: 'software-demo-user', storage, now: new Date('2026-08-29T09:00:00.000Z') }),
    ]);

    expect(first.project.id).toBe(second.project.id);
    const later = await createSoftwareReleaseDemoForUser({
      userId: 'software-demo-user',
      storage,
      now: new Date('2026-08-29T10:00:00.000Z'),
    });
    expect(later.project.title).toBe('RelayDesk Offline Sync Release (2)');
    expect((await storage.listProjects('software-demo-user')).filter((project) => project.title.startsWith('RelayDesk Offline Sync Release'))).toHaveLength(2);
  }, 20_000);
});
