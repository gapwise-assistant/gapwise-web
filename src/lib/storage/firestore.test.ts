import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FirestoreStorageProvider } from '@/lib/storage/firestore';
import { compactProcessingLogForFirestore, serializedProcessingLogSize, PROCESSING_LOG_MAX_BYTES } from '@/lib/context/processingLog';
import type { FirestoreSource } from '@/lib/storage/types';

describe('Firestore snapshot listing', () => {
  it('queries snapshots by project instead of scanning the user snapshot collection', async () => {
    const whereCalls: unknown[][] = [];
    const matchingSnapshot = {
      id: 'snapshot-project-one',
      userId: 'history-user',
      projectId: 'project-one',
      sequence: 1,
      createdAt: '2026-08-25T12:00:00.000Z',
      trigger: { type: 'context_processed', historyEventId: 'event-one' },
      label: 'Context processed',
      schemaVersion: 2,
      listSummary: {
        counts: { nodes: 2, edges: 1, sources: 1, chats: 0, messages: 0, pendingProposals: 0 },
      },
    };
    const query = {
      where(field: string, operator: string, value: string) {
        whereCalls.push([field, operator, value]);
        return query;
      },
      select() {
        return query;
      },
      async get() {
        return {
          docs: [{
            data: () => matchingSnapshot,
            ref: { get: async () => ({ exists: true, data: () => matchingSnapshot }) },
          }],
        };
      },
    };
    const db = {
      collection: () => ({
        doc: () => ({ collection: () => query }),
      }),
    } as unknown as Firestore;

    const provider = new FirestoreStorageProvider(db);
    const summaries = await provider.listProjectSnapshots('history-user', 'project-one');

    expect(whereCalls).toEqual([['projectId', '==', 'project-one']]);
    expect(summaries.map((summary) => summary.projectId)).toEqual(['project-one']);
    expect(summaries[0]?.id).toBe('snapshot-project-one');
  });
});

describe('Firestore processing log writes', () => {
  it('persists a bounded processing log when saving a source', async () => {
    let saved: Record<string, unknown> | undefined;
    const emptyQuery = {
      async get() {
        return { docs: [] };
      },
    };
    const sourceCollection = {
      get: emptyQuery.get,
      doc: () => ({
        set: async (value: Record<string, unknown>) => {
          saved = value;
        },
      }),
    };
    const db = {
      collection: () => ({
        doc: () => ({
          collection: () => sourceCollection,
        }),
      }),
    } as any;
    const provider = new FirestoreStorageProvider(db);
    const source = {
      id: 'source-large',
      userId: 'storage-user',
      projectId: 'project-1',
      filename: 'large.txt',
      type: 'text',
      content: 'source',
      extracted_at: '2026-08-27T12:00:00.000Z',
      derived_node_ids: [],
      status: 'ACTIVE',
      createdAt: '2026-08-27T12:00:00.000Z',
      updatedAt: '2026-08-27T12:00:00.000Z',
      processing_log: {
        version: 1,
        status: 'completed',
        started_at: '2026-08-27T12:00:00.000Z',
        completed_at: '2026-08-27T12:00:01.000Z',
        duration_ms: 1000,
        input: {
          source_id: 'source-large',
          filename: 'large.txt',
          type: 'text',
          content: 'x'.repeat(500_000),
          project_snapshot: '{}',
        },
        stages: [],
      },
    } satisfies FirestoreSource;

    await provider.saveSource('storage-user', source);

    const persistedLog = saved?.processing_log;
    expect(persistedLog).toBeDefined();
    expect(serializedProcessingLogSize(persistedLog)).toBeLessThanOrEqual(PROCESSING_LOG_MAX_BYTES);
    expect(persistedLog).toEqual(expect.objectContaining({
      truncated: true,
      original_size_bytes: expect.any(Number),
    }));
    // Keep this assertion tied to the same helper contract used by Firestore.
    expect(persistedLog).toEqual(compactProcessingLogForFirestore(source.processing_log));
  });
});
