import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askSuggestionsCurrentCacheId } from '@/lib/ask/suggestionsCacheId';
import { MockStorageProvider } from '@/lib/storage/mock';
import { createProjectFromInput } from '@/lib/projects/createProject';
import type { AskSuggestionsCacheRecord } from '@/lib/storage/types';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('current Ask suggestion assessment', () => {
  it('reads one deterministic current record instead of selecting a historical latest record', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-ask-current-'));
    tempDirectories.push(directory);
    const storage = new MockStorageProvider(path.join(directory, 'db.json'));
    const project = createProjectFromInput({ name: 'Current assessment test', goal: 'Test saved suggestions.' });
    await storage.saveProject('ask-user', project);

    const base = {
      userId: 'ask-user',
      projectId: project.id,
      scopeKey: `project:${project.id}`,
      projectStateVersion: 'input-v1',
      topQuestions: ['Current question?'],
      otherQuestions: [],
      generatedBy: 'agent',
      createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-28T10:00:01.000Z',
      status: 'ready' as const,
    } satisfies Omit<AskSuggestionsCacheRecord, 'id'>;
    await storage.saveAskSuggestionsCache('ask-user', { ...base, id: 'historical-assessment', updatedAt: '2099-01-01T00:00:00.000Z' });
    await storage.saveAskSuggestionsCache('ask-user', { ...base, id: askSuggestionsCurrentCacheId(project.id) });

    await expect(storage.getLatestAskSuggestionsCache('ask-user', project.id)).resolves.toMatchObject({
      id: askSuggestionsCurrentCacheId(project.id),
      topQuestions: ['Current question?'],
    });
  });
});
