import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { createDurableMemory, shouldPromoteToDurableMemory } from '@/lib/memory/policy';
import { forgetMemory } from '@/lib/memory/store';
import { MockStorageProvider } from '@/lib/storage/mock';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';

const tempDirs: string[] = [];

async function makeStorageFile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gapwise-memory-'));
  tempDirs.push(dir);
  return path.join(dir, 'db.json');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('server durable memory store', () => {
  it('persists created memory across provider reloads', async () => {
    const filePath = await makeStorageFile();
    const firstProvider = new MockStorageProvider(filePath);
    const memory = createDurableMemory('Remember that concise answers are my preference.')!;

    await firstProvider.replaceMemories('demo-user', [memory]);
    const reloadedProvider = new MockStorageProvider(filePath);
    const memories = await reloadedProvider.getMemories('demo-user');

    expect(memories).toEqual([
      expect.objectContaining({
        id: memory.id,
        userId: 'demo-user',
        text: 'Remember that concise answers are my preference.',
        status: 'active',
      }),
    ]);
  });

  it('loads preference memories into server-built Context Packs', async () => {
    const memory = createDurableMemory('Remember that concise answers are my preference.')!;

    const pack = await buildContextPackForUser(
      {
        userId: 'demo-user',
        query: 'How should you answer me?',
        project: createGoldenDemoProject(),
        profile: DEFAULT_USER_PROFILE,
      },
      {
        listMemories: async () => [memory],
        hasCalendarTokens: async () => false,
      }
    );

    expect(pack.userPreferences).toEqual([expect.objectContaining({ id: memory.id })]);
    expect(pack.includedContextIds).toContain(memory.id);
  });

  it('removes forgotten memory from the next server-built Context Pack', async () => {
    const memory = createDurableMemory('Remember that concise answers are my preference.')!;
    const forgotten = forgetMemory([memory], memory.id);

    const pack = await buildContextPackForUser(
      {
        userId: 'demo-user',
        query: 'How should you answer me?',
        project: createGoldenDemoProject(),
        profile: DEFAULT_USER_PROFILE,
      },
      {
        listMemories: async () => forgotten,
        hasCalendarTokens: async () => false,
      }
    );

    expect(pack.userPreferences.some((item) => item.id === memory.id)).toBe(false);
    expect(pack.includedContextIds).not.toContain(memory.id);
  });

  it('does not promote transient statements into durable memory', () => {
    const decision = shouldPromoteToDurableMemory('Today I feel tired and distracted.');

    expect(decision.promote).toBe(false);
    expect(createDurableMemory('Today I feel tired and distracted.')).toBeNull();
  });

  it('isolates memories by userId', async () => {
    const filePath = await makeStorageFile();
    const storage = new MockStorageProvider(filePath);
    const one = createDurableMemory('Remember that concise answers are my preference.')!;
    const two = createDurableMemory('Remember that detailed answers are my preference.')!;

    await storage.replaceMemories('user-one', [one]);
    await storage.replaceMemories('user-two', [two]);

    expect(await storage.getMemories('user-one')).toEqual([
      expect.objectContaining({ text: 'Remember that concise answers are my preference.' }),
    ]);
    expect(await storage.getMemories('user-two')).toEqual([
      expect.objectContaining({ text: 'Remember that detailed answers are my preference.' }),
    ]);
  });
});
