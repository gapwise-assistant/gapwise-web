import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { getStorageMode, getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';
import { MockStorageProvider } from '@/lib/storage/mock';
import { generateDailyBrief } from '@/lib/attention/generateBrief';
import { buildComingUp } from '@/lib/today/sections';
import { assertExternalServicesAllowed, isDemoMode } from '@/lib/runtime/demoMode';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { ingestContextSource } from '@/lib/context/ingestion';
import { createDurableMemory } from '@/lib/memory/policy';
import { resolveGap } from '@/lib/tools/graphTools';
import { getFirestoreClient } from '@/lib/firebase-admin';
import { mergeProjectsForEverything } from '@/lib/scope/projectScope';
import { createLocalDemoProjects } from '@/lib/demo/localFixtures';

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const originalFirestoreMode = process.env.USE_FIRESTORE;
const tempDirs: string[] = [];

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(async () => {
  restore('GAPSWISE_DEMO_MODE', originalDemoMode);
  restore('USE_FIRESTORE', originalFirestoreMode);
  resetStorageProviderForTests();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('zero-cost demo mode', () => {
  it('uses one explicit flag and forces local storage even if Firestore is enabled', () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    process.env.USE_FIRESTORE = 'true';
    expect(isDemoMode()).toBe(true);
    expect(getStorageMode()).toBe('mock');
    expect(getStorageProvider()).toBeInstanceOf(MockStorageProvider);
    expect(() => assertExternalServicesAllowed('Firestore')).toThrow(/disabled/);
    expect(() => getFirestoreClient()).toThrow(/disabled/);
  });

  it('feeds demo Calendar into the existing Context Pack and Today without calling Calendar API', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const hasTokens = vi.fn(async () => { throw new Error('must not run'); });
    const listEvents = vi.fn(async () => { throw new Error('must not run'); });
    const now = new Date('2026-08-12T12:00:00.000Z');
    const project = createGoldenDemoProject();
    const pack = await buildContextPackForUser({
      userId: 'demo-user',
      query: 'What do I have coming up?',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [],
      scope: { type: 'everything' },
    }, { hasCalendarTokens: hasTokens, listCalendarEvents: listEvents, now });

    expect(hasTokens).not.toHaveBeenCalled();
    expect(listEvents).not.toHaveBeenCalled();
    expect(pack.upcomingCommitments.map((node) => node.text).join(' ')).toContain('Gapswise Demo Review');
    const brief = generateDailyBrief({ userId: 'demo-user', project, memories: [], contextPack: pack, now, force: true });
    expect(buildComingUp(brief, now).some((item) => item.title === 'Gapswise Demo Review')).toBe(true);
  });

  it('keeps the full local project, scope, context, memory, and answer workflow persistent', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-zero-cost-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'demo.json');
    const storage = new MockStorageProvider(file);
    const first = createProjectFromInput({ name: 'Project A', goal: 'Ship the local demo.' }, '2026-08-12T12:00:00Z');
    const second = createProjectFromInput({ name: 'Project B', goal: 'Test project isolation.' }, '2026-08-12T13:00:00Z');
    second.nodes.push({
      id: 'unknown_local_demo', type: 'UNKNOWN', text: 'Which local flow needs validation?', status: 'OPEN',
      confidence: 0.2, impact: 0.8, source_refs: [], created_by: 'agent',
      created_at: '2026-08-12T13:00:00Z', updated_at: '2026-08-12T13:00:00Z',
    });
    await storage.saveProject('demo-user', first);
    await storage.saveProject('demo-user', second);
    await storage.setAppScope('demo-user', { type: 'project', projectId: second.id });

    const withContext = await ingestContextSource(second, {
      filename: 'local-note.txt', content: 'Only Project B should contain this local source.', type: 'note',
    }, DEFAULT_USER_PROFILE);
    const answered = resolveGap(withContext, 'unknown_local_demo', 'Validate Context, Ask, and Today locally.', DEFAULT_USER_PROFILE);
    await storage.saveProject('demo-user', answered);
    const memory = createDurableMemory('Remember that concise explanations are my preference.')!;
    await storage.replaceMemories('demo-user', [memory]);

    const restarted = new MockStorageProvider(file);
    expect(await restarted.getAppScope('demo-user')).toEqual({ type: 'project', projectId: second.id });
    const projects = await restarted.listProjects('demo-user');
    expect(projects).toHaveLength(2);
    const loadedSecond = await restarted.getProject('demo-user', second.id);
    expect(loadedSecond?.sources.some((source) => source.filename === 'local-note.txt')).toBe(true);
    expect(loadedSecond?.nodes.find((node) => node.id === 'unknown_local_demo')?.status).toBe('RESOLVED');
    expect((await restarted.getMemories('demo-user'))[0].text).toContain('concise explanations');
    expect((await restarted.getProject('demo-user', first.id))?.sources).toEqual([]);
    expect(mergeProjectsForEverything(projects, createProjectFromInput({ name: 'General', goal: 'General context' })).nodes.length)
      .toBeGreaterThanOrEqual(projects.flatMap((project) => project.nodes).length);
  });

  it('persists every centralized seed project with the file-backed provider', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-zero-cost-seed-'));
    tempDirs.push(dir);
    const storage = new MockStorageProvider(path.join(dir, 'seed.json'));
    for (const project of createLocalDemoProjects()) {
      await storage.saveProject('demo-user', project);
    }
    expect((await storage.listProjects('demo-user')).map((project) => project.id)).toEqual(
      expect.arrayContaining(['hackathon_demo', 'job_search_demo'])
    );
  });
});
