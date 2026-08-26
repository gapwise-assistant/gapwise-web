import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FirestoreStorageProvider } from '@/lib/storage/firestore';

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
