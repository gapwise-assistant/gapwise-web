import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askSuggestionsCurrentCacheId } from '@/lib/ask/suggestionsCacheId';
import { MockStorageProvider } from '@/lib/storage/mock';
import type { AskSuggestionsCacheRecord } from '@/lib/storage/types';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function record(overrides: Partial<AskSuggestionsCacheRecord> = {}): AskSuggestionsCacheRecord {
  return {
    id: askSuggestionsCurrentCacheId('workspace-lease'),
    userId: 'lease-user',
    projectId: 'workspace-lease',
    scopeKey: 'project:workspace-lease',
    projectStateVersion: 'input-a',
    publishedInputVersion: 'input-a',
    requestedSemanticProjectVersion: 'project-v1',
    generationId: 'generation-a',
    topQuestions: ['Previous question?'],
    otherQuestions: [],
    generatedBy: 'agent',
    createdAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-28T10:00:00.000Z',
    status: 'preparing',
    ...overrides,
  };
}

describe('Ask suggestion generation leases', () => {
  it('deduplicates a matching request while its explicit lease is valid', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-ask-lease-'));
    tempDirectories.push(directory);
    const storage = new MockStorageProvider(path.join(directory, 'db.json'));
    const existing = record({
      generationStartedAt: '2026-08-28T10:00:00.000Z',
      generationLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await storage.saveAskSuggestionsCache('lease-user', existing);

    const started = await storage.beginAskSuggestionsRefresh('lease-user', record({ generationId: 'generation-b' }));

    expect(started).toBe(false);
    await expect(storage.getLatestAskSuggestionsCache('lease-user', 'workspace-lease')).resolves.toMatchObject({
      generationId: 'generation-a',
      topQuestions: ['Previous question?'],
    });
  });

  it('takes over an expired lease, preserves previous questions, and rejects the old publisher', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-ask-lease-'));
    tempDirectories.push(directory);
    const storage = new MockStorageProvider(path.join(directory, 'db.json'));
    await storage.saveAskSuggestionsCache('lease-user', record({
      generationStartedAt: '2026-08-28T09:00:00.000Z',
      generationLeaseExpiresAt: '2026-08-28T09:01:00.000Z',
    }));

    const newGeneration = record({
      generationId: 'generation-b',
      publishedInputVersion: 'input-b',
      projectStateVersion: 'input-b',
    });
    expect(await storage.beginAskSuggestionsRefresh('lease-user', newGeneration)).toBe(true);
    await expect(storage.getLatestAskSuggestionsCache('lease-user', 'workspace-lease')).resolves.toMatchObject({
      generationId: 'generation-b',
      topQuestions: ['Previous question?'],
      publishedInputVersion: 'input-b',
    });

    const oldPublication = await storage.publishAskSuggestionsCache('lease-user', {
      ...record({ status: 'ready', topQuestions: ['Old result?'] }),
    }, 'generation-a');
    const newPublication = await storage.publishAskSuggestionsCache('lease-user', {
      ...newGeneration,
      status: 'ready',
      topQuestions: ['New result?'],
    }, 'generation-b');

    expect(oldPublication).toBe(false);
    expect(newPublication).toBe(true);
    await expect(storage.getLatestAskSuggestionsCache('lease-user', 'workspace-lease')).resolves.toMatchObject({
      generationId: 'generation-b',
      topQuestions: ['New result?'],
      status: 'ready',
    });
  });

  it('does not deduplicate a different full input just because the project version matches', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-ask-lease-'));
    tempDirectories.push(directory);
    const storage = new MockStorageProvider(path.join(directory, 'db.json'));
    await storage.saveAskSuggestionsCache('lease-user', record({
      generationStartedAt: '2026-08-28T10:00:00.000Z',
      generationLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    const changedProfileGeneration = record({
      generationId: 'generation-profile-b',
      publishedInputVersion: 'input-profile-b',
      projectStateVersion: 'input-profile-b',
    });

    expect(await storage.beginAskSuggestionsRefresh('lease-user', changedProfileGeneration)).toBe(true);
    await expect(storage.getLatestAskSuggestionsCache('lease-user', 'workspace-lease')).resolves.toMatchObject({
      generationId: 'generation-profile-b',
      requestedSemanticProjectVersion: 'project-v1',
    });
  });
});
