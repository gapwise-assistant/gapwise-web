import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BAKERY_JOURNEY_DEMO_ID,
  BAKERY_JOURNEY_LOCATION_DECISION,
  BAKERY_JOURNEY_SOURCES,
} from '@/lib/demo/bakeryJourney';
import { loadBakeryJourneyDemoForUser } from '@/lib/demo/bootstrap';
import { getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';
import { MockStorageProvider } from '@/lib/storage/mock';

const tempDirs: string[] = [];
const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const originalStorageMode = process.env.USE_FIRESTORE;
const originalMockStoragePath = process.env.GAPSWISE_MOCK_STORAGE_PATH;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(async () => {
  resetStorageProviderForTests();
  restoreEnv('GAPSWISE_DEMO_MODE', originalDemoMode);
  restoreEnv('USE_FIRESTORE', originalStorageMode);
  restoreEnv('GAPSWISE_MOCK_STORAGE_PATH', originalMockStoragePath);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Bakery journey demo', () => {
  it('replays source ingestion and decision resolution through production flows', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-bakery-journey-'));
    tempDirs.push(dir);
    process.env.GAPSWISE_DEMO_MODE = 'true';
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(dir, 'db.json');
    resetStorageProviderForTests();

    const result = await loadBakeryJourneyDemoForUser('bakery-journey-user');
    const historyTypes = result.project.historyEvents?.map((event) => event.type);
    const locationDecision = result.project.nodes.find((node) =>
      node.type === 'DECISION' && node.status === 'RESOLVED' && node.decision_outcome === BAKERY_JOURNEY_LOCATION_DECISION,
    );

    expect(result.project.id).toBe(BAKERY_JOURNEY_DEMO_ID);
    expect(result.project.title).toBe('Launch a weekend bakery pop-up');
    expect(result.project.goal).toContain('validate repeat demand');
    expect(result.project.deadline).toBeUndefined();
    expect(result.project.sources.map((source) => source.filename)).toEqual(BAKERY_JOURNEY_SOURCES.map((source) => source.filename));
    expect(historyTypes).toEqual([
      'project_started',
      'context_added',
      'context_added',
      'context_added',
      'decision_resolved',
    ]);
    expect(locationDecision).toBeDefined();
    const contextEvents = result.project.historyEvents?.filter((event) => event.type === 'context_added') ?? [];
    expect(contextEvents[0]?.sourceId).toBe(BAKERY_JOURNEY_SOURCES[0].id);
    expect(contextEvents[1]?.sourceId).toBe(BAKERY_JOURNEY_SOURCES[1].id);
    expect(contextEvents[2]?.sourceId).toBe(BAKERY_JOURNEY_SOURCES[2].id);

    const reloaded = await (getStorageProvider() as MockStorageProvider).getProject('bakery-journey-user', result.project.id);
    expect(reloaded?.historyEvents).toEqual(result.project.historyEvents);

    const repeated = await loadBakeryJourneyDemoForUser('bakery-journey-user');
    expect(repeated.project.historyEvents).toHaveLength(5);
    expect(await (getStorageProvider() as MockStorageProvider).listProjects('bakery-journey-user')).toHaveLength(1);
  });
});
