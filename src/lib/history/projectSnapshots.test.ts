import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { clearTracesForTests, recordTrace } from '@/lib/observability/trace';
import { getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';
import { historyBranchRequestId } from '@/components/ProjectHistory';
import {
  branchProjectFromSnapshot,
  createProjectSnapshot,
  materializeProjectSnapshot,
} from '@/lib/history/projectSnapshots';
import {
  PROJECT_SNAPSHOT_MAX_BYTES,
  projectSnapshotToSummary,
  snapshotRecordContentEqual,
  serializedProjectSnapshotSize,
  type ProjectSnapshotV1,
} from '@/types/projectSnapshot';
import type { AskChatMessage, AskChatSession, AskResearchEvidence } from '@/types/ask';
import type { Project } from '@/types/clarity';

const userId = 'snapshot-test-user';
let storagePath = '';

function node(id: string, text: string, type: 'UNKNOWN' | 'DECISION' = 'UNKNOWN') {
  return {
    id,
    type,
    text,
    status: 'OPEN' as const,
    confidence: 0.9,
    impact: 0.8,
    source_refs: ['source_context'],
    created_by: 'agent' as const,
    created_at: '2026-08-25T10:00:00.000Z',
    updated_at: '2026-08-25T10:00:00.000Z',
  };
}

function makeProject(title: string, time: string) {
  const project = createProjectFromInput(
    { name: title, goal: 'Preserve one meaningful project moment.', deadline: '2026-09-01' },
    time,
  );
  project.sources.push({
    id: 'source_context',
    filename: 'Context note',
    type: 'note',
    content: 'SOURCE_BODY_SENTINEL '.repeat(2000),
    extracted_at: '2026-08-25T10:01:00.000Z',
    derived_node_ids: ['question_old'],
    processing_status: 'completed',
    origin: 'user',
  });
  project.nodes.push(node('question_old', 'Which plan should we use?'));
  project.nodes.push(node('decision_old', 'Choose the pilot plan.', 'DECISION'));
  project.edges.push({ id: 'edge_old', source: 'question_old', target: 'decision_old', type: 'informs', confidence: 0.9 });
  return project;
}

describe('project snapshots', () => {
  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(os.tmpdir(), 'gapwise-snapshots-'));
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(storagePath, 'storage.json');
    resetStorageProviderForTests();
    clearTracesForTests();
  });

  afterEach(async () => {
    clearTracesForTests();
    resetStorageProviderForTests();
    delete process.env.GAPSWISE_MOCK_STORAGE_PATH;
    await rm(storagePath, { recursive: true, force: true });
  });

  it('ignores storage bookkeeping when checking referenced Ask records', () => {
    const chat = {
      id: 'chat_bookkeeping',
      userId,
      scopeType: 'project' as const,
      projectId: 'project_bookkeeping',
      title: 'Planning',
      createdAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T10:01:00.000Z',
    };

    expect(snapshotRecordContentEqual('chat', chat, {
      updatedAt: '2026-08-25T10:02:00.000Z',
      serverUpdatedAt: { seconds: 123 },
      userId,
      title: 'Planning',
      projectId: 'project_bookkeeping',
      scopeType: 'project',
      id: 'chat_bookkeeping',
      createdAt: '2026-08-25T10:00:00.000Z',
    })).toBe(true);
  });

  it('writes a small v2 manifest without source bodies, Ask text, or traces', async () => {
    const storage = getStorageProvider();
    const project = makeProject('Snapshot project', '2026-08-25T10:00:00.000Z');
    await storage.saveProject(userId, project);
    const chat: AskChatSession = {
      id: 'chat_old', userId, scopeType: 'project', projectId: project.id,
      title: 'Planning', createdAt: '2026-08-25T10:02:00.000Z', updatedAt: '2026-08-25T10:02:00.000Z',
    };
    const message: AskChatMessage = {
      id: 'message_old', chatId: chat.id, userId, projectId: project.id, role: 'assistant',
      text: 'MESSAGE_BODY_SENTINEL', sources: [], createdAt: '2026-08-25T10:03:00.000Z',
      contextProposals: [{
        id: 'proposal_old', type: 'UNKNOWN', text: 'Whether the pilot can start on Friday.', status: 'OPEN',
        confirmationStatus: 'pending', sourceMessageId: 'message_old',
      }],
    };
    const research: AskResearchEvidence = {
      id: 'research_old', userId, chatId: chat.id, assistantMessageId: message.id, projectId: project.id,
      text: 'RESEARCH_BODY_SENTINEL', sources: [], retrievedAt: '2026-08-25T10:03:00.000Z',
      createdAt: '2026-08-25T10:03:00.000Z', updatedAt: '2026-08-25T10:03:00.000Z',
      provenance: 'assistant_web_research_confirmed_by_user',
    };
    await storage.saveAskChat(userId, chat);
    await storage.saveAskMessage(userId, message);
    await storage.saveAskResearch(userId, research);
    recordTrace({
      userId,
      route: 'internal_context',
      label: 'snapshot test',
      started_at: '2026-08-25T10:03:00.000Z',
      duration_ms: 1,
      agentNames: ['test'],
      contextIds: [project.id],
      scores: [],
      toolCalls: [],
      error: 'TRACE_BODY_SENTINEL',
    });

    const snapshot = await createProjectSnapshot({
      userId, projectId: project.id, trigger: { type: 'context_processed', sourceId: 'source_context' },
      label: 'Context processed', summary: 'The first context was processed.',
    });
    expect(snapshot.schemaVersion).toBe(2);
    expect('projectState' in snapshot).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('SOURCE_BODY_SENTINEL');
    expect(JSON.stringify(snapshot)).not.toContain('MESSAGE_BODY_SENTINEL');
    expect(JSON.stringify(snapshot)).not.toContain('RESEARCH_BODY_SENTINEL');
    expect(JSON.stringify(snapshot)).not.toContain('TRACE_BODY_SENTINEL');
    expect(snapshot.references).toMatchObject({
      sourceIds: ['source_context'],
      chatIds: ['chat_old'],
      messageIds: ['message_old'],
      researchIds: ['research_old'],
    });
    expect(snapshot.proposalStates).toEqual([{
      proposalId: 'proposal_old', messageId: 'message_old', confirmationStatus: 'pending',
    }]);
    expect(serializedProjectSnapshotSize(snapshot)).toBeLessThan(PROJECT_SNAPSHOT_MAX_BYTES);
    expect(await storage.getProjectSnapshot(userId, snapshot.id)).toEqual(snapshot);

    const summaries = await storage.listProjectSnapshots(userId, project.id);
    expect(summaries).toEqual([projectSnapshotToSummary(snapshot)]);
    expect(JSON.stringify(summaries)).not.toContain('MESSAGE_BODY_SENTINEL');
  });

  it('materializes exact referenced state and applies proposal status without mutating the source message', async () => {
    const storage = getStorageProvider();
    const project = makeProject('Materializable project', '2026-08-25T11:00:00.000Z');
    await storage.saveProject(userId, project);
    const chat: AskChatSession = {
      id: 'chat_old', userId, scopeType: 'project', projectId: project.id, title: 'Ask',
      createdAt: '2026-08-25T11:02:00.000Z', updatedAt: '2026-08-25T11:02:00.000Z',
    };
    const message: AskChatMessage = {
      id: 'message_old', chatId: chat.id, userId, projectId: project.id, role: 'assistant', text: 'Consider this.', sources: [], createdAt: '2026-08-25T11:03:00.000Z',
      contextProposals: [{ id: 'proposal_old', type: 'RISK', text: 'The path may be delayed.', status: 'OPEN', confirmationStatus: 'pending', sourceMessageId: 'message_old' }],
    };
    await storage.saveAskChat(userId, chat);
    await storage.saveAskMessage(userId, message);
    const snapshot = await createProjectSnapshot({ userId, projectId: project.id, trigger: { type: 'ask_response_created', askMessageId: message.id }, label: 'Ask response' });

    const storedMessage = await storage.getAskMessages(userId);
    storedMessage[0]!.contextProposals![0]!.confirmationStatus = 'dismissed';
    await storage.saveAskMessage(userId, storedMessage[0]!);
    await expect(storage.saveAskMessage(userId, {
      ...storedMessage[0]!,
      text: 'A different assistant response.',
    })).rejects.toThrow('immutable');
    await expect(storage.saveProject(userId, {
      ...project,
      sources: project.sources.map((source) => ({ ...source, content: 'EDITED_SOURCE_BODY' })),
    })).rejects.toThrow('immutable');
    const materialized = await materializeProjectSnapshot({ userId, snapshotId: snapshot.id });
    expect(materialized.project.sources[0]?.content).toContain('SOURCE_BODY_SENTINEL');
    expect(materialized.project).toEqual(project);
    expect(materialized.ask.messages[0]?.contextProposals?.[0]?.confirmationStatus).toBe('pending');
    expect((await storage.getAskMessages(userId))[0]?.contextProposals?.[0]?.confirmationStatus).toBe('dismissed');
  });

  it('prevents deleting records referenced by a snapshot', async () => {
    const storage = getStorageProvider();
    const project = makeProject('Retained records project', '2026-08-25T11:30:00.000Z');
    await storage.saveProject(userId, project);
    const chat: AskChatSession = {
      id: 'chat_retained', userId, scopeType: 'project', projectId: project.id, title: 'Ask',
      createdAt: '2026-08-25T11:31:00.000Z', updatedAt: '2026-08-25T11:31:00.000Z',
    };
    const message: AskChatMessage = {
      id: 'message_retained', chatId: chat.id, userId, projectId: project.id, role: 'user',
      text: 'Keep this historical message.', sources: [], createdAt: '2026-08-25T11:32:00.000Z',
    };
    const research: AskResearchEvidence = {
      id: 'research_retained', userId, chatId: chat.id, assistantMessageId: message.id, projectId: project.id,
      text: 'Historical research.', sources: [], retrievedAt: '2026-08-25T11:32:00.000Z',
      createdAt: '2026-08-25T11:32:00.000Z', updatedAt: '2026-08-25T11:32:00.000Z',
      provenance: 'assistant_web_research_confirmed_by_user',
    };
    await storage.saveAskChat(userId, chat);
    await storage.saveAskMessage(userId, message);
    await storage.saveAskResearch(userId, research);
    await createProjectSnapshot({ userId, projectId: project.id, trigger: { type: 'ask_response_created' }, label: 'Historical Ask' });

    await expect(storage.deleteSource(userId, 'source_context')).rejects.toThrow('retained');
    await expect(storage.deleteAskChat(userId, chat.id)).rejects.toThrow('retained');
    await expect(storage.saveAskChat(userId, { ...chat, title: 'Edited historical chat' })).rejects.toThrow('immutable');
    await expect(storage.saveAskResearch(userId, { ...research, text: 'Edited historical research.' })).rejects.toThrow('immutable');
    expect((await storage.getAskMessages(userId)).some((item) => item.id === message.id)).toBe(true);
    expect((await storage.getAskResearch(userId)).some((item) => item.id === research.id)).toBe(true);
  });

  it('does not materialize records added after the snapshot', async () => {
    const storage = getStorageProvider();
    const project = makeProject('Historical project', '2026-08-25T12:00:00.000Z');
    await storage.saveProject(userId, project);
    const chat: AskChatSession = {
      id: 'chat_old', userId, scopeType: 'project', projectId: project.id, title: 'Ask',
      createdAt: '2026-08-25T12:02:00.000Z', updatedAt: '2026-08-25T12:02:00.000Z',
    };
    const first: AskChatMessage = {
      id: 'message_old', chatId: chat.id, userId, projectId: project.id, role: 'user', text: 'First', sources: [], createdAt: '2026-08-25T12:03:00.000Z',
    };
    await storage.saveAskChat(userId, chat);
    await storage.saveAskMessage(userId, first);
    const snapshot = await createProjectSnapshot({ userId, projectId: project.id, trigger: { type: 'context_processed' }, label: 'Before second message' });
    await storage.saveAskMessage(userId, { ...first, id: 'message_new', text: 'Added later' });
    const materialized = await materializeProjectSnapshot({ userId, snapshotId: snapshot.id });
    expect(materialized.ask.messages.map((item) => item.id)).toEqual(['message_old']);
  });

  it('branches a materialized moment with independent IDs and preserves pending proposal state', async () => {
    const storage = getStorageProvider();
    const project = makeProject('Branchable project', '2026-08-25T13:00:00.000Z');
    await storage.saveProject(userId, project);
    const chat: AskChatSession = {
      id: 'chat_old', userId, scopeType: 'project', projectId: project.id, title: 'Ask',
      createdAt: '2026-08-25T13:02:00.000Z', updatedAt: '2026-08-25T13:02:00.000Z',
    };
    const message: AskChatMessage = {
      id: 'message_old', chatId: chat.id, userId, projectId: project.id, role: 'assistant', text: 'Consider this.', sources: [], createdAt: '2026-08-25T13:03:00.000Z',
      contextProposals: [{ id: 'proposal_old', type: 'RISK', text: 'The path may be delayed.', status: 'OPEN', confirmationStatus: 'pending', sourceMessageId: 'message_old' }],
    };
    await storage.saveAskChat(userId, chat);
    await storage.saveAskMessage(userId, message);
    const createdSnapshot = await createProjectSnapshot({ userId, projectId: project.id, trigger: { type: 'ask_response_created', askMessageId: message.id }, label: 'Ask response' });
    const snapshot = { ...createdSnapshot, id: `snapshot-${'x'.repeat(180)}` };
    await storage.saveProjectSnapshot(userId, snapshot);
    const clientRequestId = historyBranchRequestId(snapshot.id);
    expect(clientRequestId.length).toBeLessThanOrEqual(180);
    expect(historyBranchRequestId(snapshot.id)).toBe(clientRequestId);
    const branched = await branchProjectFromSnapshot({ userId, snapshotId: snapshot.id, clientRequestId });
    expect(branched.project.id).not.toBe(project.id);
    expect(branched.project.title).toBe('Branchable project (2)');
    expect(branched.project.branch).toMatchObject({ sourceProjectId: project.id, sourceSnapshotId: snapshot.id, requestId: clientRequestId });
    const branchNodeIds = new Set(branched.project.nodes.map((item) => item.id));
    expect(branchNodeIds.has('question_old')).toBe(false);
    expect(branchNodeIds.has('decision_old')).toBe(false);
    expect(branched.project.edges.every((edge) => branchNodeIds.has(edge.source) && branchNodeIds.has(edge.target))).toBe(true);
    expect(branched.project.sources[0]?.content).toContain('SOURCE_BODY_SENTINEL');
    const branchChat = (await storage.getAskChats(userId)).find((item) => item.projectId === branched.project.id);
    const branchMessage = (await storage.getAskMessages(userId)).find((item) => item.projectId === branched.project.id);
    expect(branchChat?.id).not.toBe(chat.id);
    expect(branchMessage?.chatId).toBe(branchChat?.id);
    expect(branchMessage?.contextProposals?.[0]).toMatchObject({ confirmationStatus: 'pending', sourceMessageId: branchMessage?.id });
    expect((await branchProjectFromSnapshot({ userId, snapshotId: snapshot.id, clientRequestId })).project.id).toBe(branched.project.id);
  });

  it('keeps version 1 snapshots readable', async () => {
    const storage = getStorageProvider();
    const project = createProjectFromInput({ name: 'Legacy project', goal: 'Read old snapshots.' }, '2026-08-25T14:00:00.000Z');
    const legacy: ProjectSnapshotV1 = {
      id: 'legacy_snapshot', userId, projectId: project.id, sequence: 1,
      createdAt: project.created_at, trigger: { type: 'project_created' }, label: 'Legacy', project,
      ask: { chats: [], messages: [], research: [] }, assessments: { focus: null, overview: null, today: null }, execution: [], schemaVersion: 1,
    };
    await storage.saveProjectSnapshot(userId, legacy);
    const materialized = await materializeProjectSnapshot({ userId, snapshotId: legacy.id });
    expect(materialized.project).toEqual(project);
    expect(materialized.snapshot.schemaVersion).toBe(1);
    expect((await storage.listProjectSnapshots(userId, project.id))[0]?.schemaVersion).toBe(1);
  });

  it('reports missing optional traces and required records separately', async () => {
    const storage = getStorageProvider();
    const project = makeProject('Missing references project', '2026-08-25T15:00:00.000Z');
    await storage.saveProject(userId, project);
    recordTrace({
      userId, route: 'internal_context', label: 'trace', started_at: project.created_at, duration_ms: 1,
      agentNames: [], contextIds: [project.id], scores: [], toolCalls: [],
    });
    const snapshot = await createProjectSnapshot({ userId, projectId: project.id, trigger: { type: 'context_processed' }, label: 'Missing refs' });
    const missingSnapshot = {
      ...snapshot,
      id: 'missing-references',
      projectState: {
        ...snapshot.projectState,
        sources: [{
          id: 'missing-source', filename: 'Missing', type: 'note' as const,
          extracted_at: snapshot.createdAt, derived_node_ids: [],
        }],
      },
      references: { ...snapshot.references, sourceIds: ['missing-source'] },
    };
    await storage.saveProjectSnapshot(userId, missingSnapshot);
    clearTracesForTests();
    const missing = await materializeProjectSnapshot({ userId, snapshotId: missingSnapshot.id });
    expect(missing.missingReferences).toEqual([
      { type: 'source', id: 'missing-source' },
      { type: 'trace', id: snapshot.references.traceIds[0] },
    ]);
    await expect(branchProjectFromSnapshot({ userId, snapshotId: missingSnapshot.id })).rejects.toThrow('referenced records are missing');
  });

  it('rejects an oversized manifest before it can be stored', async () => {
    const storage = getStorageProvider();
    const project = createProjectFromInput({ name: 'Oversized', goal: 'Test size guard.' }, '2026-08-25T16:00:00.000Z');
    const oversized = {
      id: 'oversized', userId, projectId: project.id, sequence: 1, createdAt: project.created_at,
      trigger: { type: 'project_created' as const }, label: 'Oversized', projectState: { ...project, nodes: [{ ...node('large', 'x'), text: 'x'.repeat(PROJECT_SNAPSHOT_MAX_BYTES) }], sources: [] },
      references: { sourceIds: [], chatIds: [], messageIds: [], researchIds: [], traceIds: [] }, proposalStates: [],
      listSummary: { counts: { nodes: 1, edges: 0, sources: 0, chats: 0, messages: 0, pendingProposals: 0 } },
      assessments: { focus: null, overview: null, today: null }, schemaVersion: 2 as const,
    };
    await expect(storage.saveProjectSnapshot(userId, oversized)).rejects.toThrow('too large');
    expect(await storage.getProjectSnapshot(userId, oversized.id)).toBeNull();
  });
});
