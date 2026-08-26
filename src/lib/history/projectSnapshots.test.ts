import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';
import { branchProjectFromSnapshot, createProjectSnapshot } from '@/lib/history/projectSnapshots';
import type { AskChatMessage, AskChatSession, AskResearchEvidence } from '@/types/ask';

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

describe('project snapshots', () => {
  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(os.tmpdir(), 'gapwise-snapshots-'));
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(storagePath, 'storage.json');
    resetStorageProviderForTests();
  });

  afterEach(async () => {
    resetStorageProviderForTests();
    delete process.env.GAPSWISE_MOCK_STORAGE_PATH;
    await rm(storagePath, { recursive: true, force: true });
  });

  it('captures persisted project, Ask proposal state, assessments, and immutable identity', async () => {
    const storage = getStorageProvider();
    const project = createProjectFromInput(
      { name: 'Snapshot project', goal: 'Preserve one meaningful project moment.', deadline: '2026-09-01' },
      '2026-08-25T10:00:00.000Z',
    );
    project.sources.push({
      id: 'source_context',
      filename: 'Context note',
      type: 'note',
      content: 'The first project context.',
      extracted_at: '2026-08-25T10:01:00.000Z',
      derived_node_ids: ['question_old'],
      processing_status: 'completed',
      origin: 'user',
    });
    project.nodes.push(node('question_old', 'Which plan should we use?'));
    project.nodes.push(node('decision_old', 'Choose the pilot plan.', 'DECISION'));
    project.edges.push({ id: 'edge_old', source: 'question_old', target: 'decision_old', type: 'informs', confidence: 0.9 });
    await storage.saveProject(userId, project);

    const chat: AskChatSession = {
      id: 'chat_old', userId, scopeType: 'project', projectId: project.id,
      title: 'Planning', createdAt: '2026-08-25T10:02:00.000Z', updatedAt: '2026-08-25T10:02:00.000Z',
    };
    const message: AskChatMessage = {
      id: 'message_old', chatId: chat.id, userId, projectId: project.id, role: 'assistant',
      text: 'There is one unresolved choice.', sources: [], createdAt: '2026-08-25T10:03:00.000Z',
      contextProposals: [{
        id: 'proposal_old', type: 'UNKNOWN', text: 'Whether the pilot can start on Friday.', status: 'OPEN',
        confirmationStatus: 'pending', sourceMessageId: 'message_old',
      }],
    };
    const research: AskResearchEvidence = {
      id: 'research_old', userId, chatId: chat.id, assistantMessageId: message.id, projectId: project.id,
      text: 'Research note', sources: [], retrievedAt: '2026-08-25T10:03:00.000Z',
      createdAt: '2026-08-25T10:03:00.000Z', updatedAt: '2026-08-25T10:03:00.000Z',
      provenance: 'assistant_web_research_confirmed_by_user',
    };
    await storage.saveAskChat(userId, chat);
    await storage.saveAskMessage(userId, message);
    await storage.saveAskResearch(userId, research);

    const snapshot = await createProjectSnapshot({
      userId, projectId: project.id, trigger: { type: 'context_processed', sourceId: 'source_context' },
      label: 'Context processed', summary: 'The first context was processed.',
    });
    expect(snapshot.project).toEqual(await storage.getProject(userId, project.id));
    expect(snapshot.ask).toEqual({ chats: [chat], messages: [message], research: [research] });
    expect(snapshot.assessments.today?.brief.recommendations).toBeDefined();
    expect(snapshot.id).toContain(`${project.id}:snapshot:context_processed:`);
    expect(await storage.getProjectSnapshot(userId, snapshot.id)).toEqual(snapshot);

    await expect(storage.saveProjectSnapshot(userId, { ...snapshot, label: 'Changed' })).rejects.toThrow('immutable');
    expect(await createProjectSnapshot({
      userId, projectId: project.id, trigger: { type: 'context_processed', sourceId: 'source_context' },
      label: 'Different label',
    })).toEqual(snapshot);
  });

  it('branches an exact moment with independent IDs, proposal state, and stable naming', async () => {
    const storage = getStorageProvider();
    const project = createProjectFromInput(
      { name: 'Branchable project', goal: 'Try a different path.' },
      '2026-08-25T11:00:00.000Z',
    );
    project.sources.push({
      id: 'source_context', filename: 'Context', type: 'note', content: 'Saved context',
      extracted_at: '2026-08-25T11:01:00.000Z', derived_node_ids: ['question_old'], processing_status: 'completed', origin: 'user',
    });
    project.nodes.push(node('question_old', 'Which path should we take?'));
    project.nodes.push(node('decision_old', 'Choose a path.', 'DECISION'));
    project.edges.push({ id: 'edge_old', source: 'question_old', target: 'decision_old', type: 'informs', confidence: 0.8 });
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

    const branched = await branchProjectFromSnapshot({ userId, snapshotId: snapshot.id, clientRequestId: 'branch-request-1' });
    expect(branched.project.id).not.toBe(project.id);
    expect(branched.project.title).toBe('Branchable project (2)');
    expect(branched.project.branch).toMatchObject({ sourceProjectId: project.id, sourceSnapshotId: snapshot.id, requestId: 'branch-request-1' });
    expect(branched.project.historyEvents?.at(-1)).toMatchObject({ type: 'project_branched', projectId: branched.project.id });

    const branchNodeIds = new Set(branched.project.nodes.map((item) => item.id));
    expect(branchNodeIds.has('question_old')).toBe(false);
    expect(branchNodeIds.has('decision_old')).toBe(false);
    expect(branched.project.edges.every((edge) => branchNodeIds.has(edge.source) && branchNodeIds.has(edge.target))).toBe(true);
    expect(branched.project.sources[0]?.derived_node_ids.every((id) => branchNodeIds.has(id))).toBe(true);

    const branchChats = await storage.getAskChats(userId);
    const branchChat = branchChats.find((item) => item.projectId === branched.project.id);
    const branchMessages = (await storage.getAskMessages(userId)).filter((item) => item.projectId === branched.project.id);
    expect(branchChat?.id).not.toBe(chat.id);
    expect(branchMessages[0]?.chatId).toBe(branchChat?.id);
    expect(branchMessages[0]?.contextProposals?.[0]).toMatchObject({ confirmationStatus: 'pending', sourceMessageId: branchMessages[0]?.id });

    const retried = await branchProjectFromSnapshot({ userId, snapshotId: snapshot.id, clientRequestId: 'branch-request-1' });
    expect(retried.project.id).toBe(branched.project.id);
    expect((await storage.listProjects(userId)).filter((item) => item.branch?.sourceSnapshotId === snapshot.id)).toHaveLength(1);
    expect((await storage.getProject(userId, project.id))?.id).toBe(project.id);
  });
});
