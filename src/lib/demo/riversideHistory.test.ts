import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/types/clarity';
import type { ContextPack } from '@/types/contextPack';

const mocks = vi.hoisted(() => ({
  processContextSource: vi.fn(),
  refreshProjectGapRuntime: vi.fn(),
  askGapswise: vi.fn(),
  uploadContextSourcePdf: vi.fn(),
  confirmDecision: vi.fn(),
  answerQuestion: vi.fn(),
  persistAskConversationContext: vi.fn(),
  persistAskProposal: vi.fn(),
  getCachedFocusAssessment: vi.fn(),
  getProjectOverviewAssessmentWithMetadata: vi.fn(),
  buildContextPackForUser: vi.fn(),
  generateDailyBrief: vi.fn(),
}));

vi.mock('@/lib/context/contextAnalysis', () => ({ processContextSource: mocks.processContextSource }));
vi.mock('@/lib/agents/gapRuntime', () => ({ refreshProjectGapRuntime: mocks.refreshProjectGapRuntime }));
vi.mock('@/lib/ask/adkClient', () => ({ askGapswise: mocks.askGapswise }));
vi.mock('@/lib/storage/gcsAssets', () => ({ uploadContextSourcePdf: mocks.uploadContextSourcePdf }));
vi.mock('@/lib/decisions/workspace', () => ({ confirmDecision: mocks.confirmDecision }));
vi.mock('@/lib/questions/answerQuestion', () => ({ answerQuestion: mocks.answerQuestion }));
vi.mock('@/lib/ask/conversationContext', () => ({
  persistAskConversationContext: mocks.persistAskConversationContext,
  persistAskProposal: mocks.persistAskProposal,
}));
vi.mock('@/lib/retrieval/contextPackServer', () => ({ buildContextPackForUser: mocks.buildContextPackForUser }));
vi.mock('@/lib/attention/generateBrief', () => ({ generateDailyBrief: mocks.generateDailyBrief }));
vi.mock('@/lib/focus/focusCache', async () => {
  const actual = await vi.importActual<typeof import('@/lib/focus/focusCache')>('@/lib/focus/focusCache');
  return { ...actual, getCachedFocusAssessment: mocks.getCachedFocusAssessment };
});
vi.mock('@/lib/overview/projectOverviewCache', async () => {
  const actual = await vi.importActual<typeof import('@/lib/overview/projectOverviewCache')>('@/lib/overview/projectOverviewCache');
  return { ...actual, getProjectOverviewAssessmentWithMetadata: mocks.getProjectOverviewAssessmentWithMetadata };
});

import { getStorageProvider, resetStorageProviderForTests } from '@/lib/storage';
import { focusAssessmentCacheId, focusProjectStateVersion } from '@/lib/focus/focusCache';
import { overviewProjectStateVersion, projectOverviewAssessmentCacheId } from '@/lib/overview/projectOverviewCache';
import { boundedId } from '@/lib/ids/boundedId';
import { createRiversideHistoryDemoForUser } from '@/lib/demo/riversideHistory';

let storagePath = '';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function contextPack(): ContextPack {
  return {
    id: 'riverside-test-pack', query: 'integration test', built_at: '2026-08-26T00:00:00.000Z',
    includedContextIds: [], activeGoals: [], recentImportantEvents: [], unresolvedGaps: [], recentlyResolvedGaps: [],
    relevantEvidence: [], provenanceSources: [], userPreferences: [], recentDecisions: [], upcomingCommitments: [], contradictions: [],
  };
}

function event(project: Project, id: string, type: 'context_added' | 'context_changed' | 'decision_resolved' | 'gap_resolved', sourceId?: string) {
  return { id, projectId: project.id, createdAt: new Date().toISOString(), type, title: id, ...(sourceId ? { sourceId } : {}) };
}

function node(project: Project, id: string, type: 'DECISION' | 'UNKNOWN', text: string) {
  return { id, type, text, status: 'OPEN' as const, confidence: 0.9, impact: 0.8, source_refs: [], created_by: 'agent' as const, created_at: project.created_at, updated_at: project.created_at };
}

describe('Riverside history demo generator', () => {
  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(os.tmpdir(), 'gapwise-riverside-history-'));
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_DEMO_MODE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(storagePath, 'storage.json');
    process.env.CLOUD_STORAGE_BUCKET = 'test-bucket';
    resetStorageProviderForTests();

    Object.values(mocks).forEach((mock) => mock.mockReset());
    const storage = getStorageProvider();
    mocks.buildContextPackForUser.mockResolvedValue(contextPack());
    mocks.generateDailyBrief.mockReturnValue({ id: 'riverside-brief', userId: 'riverside-user', period: '2026-08-26', generated_at: new Date().toISOString(), recommendations: [] });
    mocks.getCachedFocusAssessment.mockImplementation(async (userId: string, project: Project, pack: ContextPack) => {
      const assessment = { kind: 'question' as const, title: 'Riverside focus', representedNodeIds: [], sourceNodeIds: [], sourceIds: [], score: 1, confidence: 1 };
      const version = await focusProjectStateVersion(project, pack);
      const now = new Date().toISOString();
      await storage.saveFocusAssessment(userId, { id: focusAssessmentCacheId(project.id, version), userId, projectId: project.id, projectStateVersion: version, assessment, createdAt: now, updatedAt: now });
      return assessment;
    });
    mocks.getProjectOverviewAssessmentWithMetadata.mockImplementation(async (userId: string, project: Project, history: Project['historyEvents'], focus: unknown, pack: ContextPack) => {
      const assessment = { trajectory: { state: 'taking_shape' as const, explanation: 'Riverside assessment' }, summary: 'Riverside assessment', meaningfulChanges: [], goalImpact: { summary: 'Riverside assessment', positiveFactors: [], negativeFactors: [] }, unsettled: [], criticalIssues: [], emergingInsights: [], confidence: 1 };
      const version = await overviewProjectStateVersion(project, history ?? [], focus as any, pack);
      const now = new Date().toISOString();
      await storage.saveProjectOverviewAssessment(userId, { id: projectOverviewAssessmentCacheId(project.id, version), userId, projectId: project.id, projectStateVersion: version, assessment, createdAt: now, updatedAt: now });
      return { assessment, cache: { status: 'generated' as const, projectStateVersion: version } };
    });
    mocks.uploadContextSourcePdf.mockImplementation(async ({ sourceId }: { sourceId: string }) => ({ storageUrl: `gs://test-bucket/${sourceId}.pdf` }));
    mocks.refreshProjectGapRuntime.mockImplementation(async ({ project }: { project: Project }) => ({ project, runtime: null }));
    mocks.askGapswise.mockResolvedValue({ answer: 'Live Riverside answer.', outcome: 'exploration', sources: [], sessionId: 'riverside-session', openQuestionIds: [], openQuestions: [], execution: { route: 'internal_context', agent: 'Partner Agent', toolCalls: ['ADK /run_sse'] } });
    mocks.processContextSource.mockImplementation(async (current: Project, input: { sourceId: string; filename: string; content: string; storageUrl?: string }) => {
      const next = clone(current);
      next.sources = [...next.sources, { id: input.sourceId, filename: input.filename, type: 'pdf', content: input.content, extracted_at: new Date().toISOString(), derived_node_ids: [], processing_status: 'completed', storage_url: input.storageUrl, processing_log: { version: 1, status: 'completed', started_at: new Date().toISOString(), completed_at: new Date().toISOString(), duration_ms: 1, input: { source_id: input.sourceId, filename: input.filename, type: 'pdf', content: input.content }, stages: [{ name: 'Relationship completion', status: 'completed', started_at: new Date().toISOString(), duration_ms: 1, input: {}, output: {} }] } as any }];
      const filename = input.filename.toLowerCase();
      if (filename.includes('meal cost')) next.nodes.push(node(next, 'riverside-pricing', 'DECISION', 'Set the initial Riverside meal price.'));
      if (filename.includes('kitchen')) {
        // Model the same transition with a mixture of node types: the
        // canonical outcome is already resolved, while supporting action/risk
        // context remains open. The generator must use the recorded anchor,
        // not search for a particular UNKNOWN type or phrase.
        next.nodes.push({
          ...node(next, 'riverside-driver', 'DECISION', 'Delivery coverage arrangement for every Wednesday route.'),
          status: 'RESOLVED' as const,
          decision_outcome: 'Primary and backup volunteer drivers are confirmed.',
        });
        next.nodes.push({
          ...node(next, 'riverside-driver-action', 'UNKNOWN', 'Confirm backup delivery coverage.'),
          type: 'NEXT_ACTION' as const,
        });
        next.nodes.push({
          ...node(next, 'riverside-driver-risk', 'UNKNOWN', 'Volunteer cancellations may leave routes uncovered.'),
          type: 'RISK' as const,
        });
        next.historyEvents = [...(next.historyEvents ?? []), {
          ...event(next, 'delivery-resolved', 'decision_resolved'),
          primaryNodeId: 'riverside-driver',
        }];
      }
      if (filename.includes('final readiness')) next.nodes.push(node(next, 'riverside-rehearsal', 'UNKNOWN', 'Has the complete packing-and-delivery rehearsal been completed?'));
      next.historyEvents = [...(next.historyEvents ?? []), event(next, `event:${input.sourceId}`, 'context_added', input.sourceId)];
      return { project: next, skipped: false };
    });
    mocks.persistAskConversationContext.mockImplementation(async ({ userId, projectId, sourceId, historyEventId, messageId, text }: { userId: string; projectId: string; sourceId?: string; historyEventId?: string; messageId: string; text: string }) => {
      const current = await storage.getProject(userId, projectId);
      if (!current) throw new Error('Riverside project missing during Ask context');
      const generatedHistoryEventId = historyEventId ?? boundedId('history', `${projectId}:${messageId}`);
      const generatedSourceId = sourceId ?? boundedId('ask_source', `${projectId}:${messageId}`);
      const next = clone(current);
      next.sources.push({ id: generatedSourceId, filename: 'Ask message.txt', type: 'note', content: text, extracted_at: new Date().toISOString(), derived_node_ids: [], processing_status: 'completed' });
      next.historyEvents = [...(next.historyEvents ?? []), event(next, generatedHistoryEventId, 'context_added', generatedSourceId)];
      await storage.saveProject(userId, next);
      return { project: next, sourceId: generatedSourceId, historyEventId: generatedHistoryEventId, openQuestions: [] };
    });
    mocks.persistAskProposal.mockImplementation(async ({ userId, projectId, assistantMessageId, proposal }: { userId: string; projectId: string; assistantMessageId: string; proposal: { id: string; type: string; text: string; status: string } }) => {
      const current = await storage.getProject(userId, projectId);
      if (!current) throw new Error('Riverside project missing during proposal');
      const next = clone(current);
      const sourceId = boundedId('ask_proposal', `${assistantMessageId}_${proposal.id}`);
      next.sources.push({ id: sourceId, filename: `Ask proposal ${assistantMessageId}.txt`, type: 'note', content: proposal.text, extracted_at: new Date().toISOString(), derived_node_ids: [], processing_status: 'completed', processing_log: { version: 1, status: 'completed', started_at: new Date().toISOString(), completed_at: new Date().toISOString(), duration_ms: 1, input: { source_id: sourceId, filename: 'proposal', type: 'note', content: proposal.text }, stages: [{ name: 'Relationship completion', status: 'completed', started_at: new Date().toISOString(), duration_ms: 1, input: {}, output: {} }] } as any });
      next.nodes.push({ id: `proposal-node-${proposal.id}`, type: proposal.type, text: proposal.text, status: proposal.status, confidence: 0.9, impact: 0.75, source_refs: [sourceId], created_by: 'user', created_at: next.created_at, updated_at: new Date().toISOString() } as any);
      next.historyEvents = [...(next.historyEvents ?? []), event(next, `proposal-context:${proposal.id}`, 'context_added', sourceId)];
      await storage.saveProject(userId, next);
      return next;
    });
    mocks.confirmDecision.mockImplementation((current: Project, input: { decisionNodeId: string; customDecision: string }) => {
      const next = clone(current);
      const target = next.nodes.find((candidate) => candidate.id === input.decisionNodeId);
      if (target) { target.status = 'RESOLVED'; target.decision_outcome = input.customDecision; }
      next.historyEvents = [...(next.historyEvents ?? []), { ...event(next, `decision:${input.decisionNodeId}`, 'decision_resolved'), primaryNodeId: input.decisionNodeId }];
      return next;
    });
    mocks.answerQuestion.mockImplementation(async ({ userId, projectId, nodeId }: { userId: string; projectId: string; nodeId: string }) => {
      const current = await storage.getProject(userId, projectId);
      if (!current) throw new Error('Riverside project missing during answer');
      const next = clone(current);
      const target = next.nodes.find((candidate) => candidate.id === nodeId);
      if (target) target.status = 'RESOLVED';
      next.history = [...next.history, { question: target?.text ?? '', answer: 'Confirmed', timestamp: new Date().toISOString(), graph_diff_summary: 'resolved', nodeId }];
      next.historyEvents = [...(next.historyEvents ?? []), { ...event(next, `gap:${nodeId}`, 'gap_resolved'), primaryNodeId: nodeId }];
      await storage.saveProject(userId, next);
      return { context: next };
    });
  });

  afterEach(async () => {
    resetStorageProviderForTests();
    delete process.env.GAPSWISE_MOCK_STORAGE_PATH;
    delete process.env.CLOUD_STORAGE_BUCKET;
    await rm(storagePath, { recursive: true, force: true });
  });

  it('uses live Ask responses and persists the full Riverside history journey through PDFs, proposals, and workflows', async () => {
    const result = await createRiversideHistoryDemoForUser({ userId: 'riverside-user', fresh: true });
    const storage = getStorageProvider();
    const snapshots = await storage.listProjectSnapshots('riverside-user', result.project.id);
    const generationRuns = await storage.listDeveloperGenerationRuns('riverside-user', result.project.id);
    const generationSteps = await storage.getDeveloperGenerationSteps('riverside-user', result.generationRunId);
    const messages = (await storage.getAskMessages('riverside-user')).filter((message) => message.projectId === result.project.id);
    const proposals = messages.flatMap((message) => message.contextProposals ?? message.proposals ?? []);

    // Three calls are the scripted conversation; the fourth is the single
    // final project-state suggestion refresh for the batch journey.
    expect(mocks.askGapswise).toHaveBeenCalledTimes(4);
    expect(result.pdfs).toHaveLength(5);
    expect(result.pdfs.every((pdf) => pdf.stored)).toBe(true);
    expect(result.snapshotCount).toBeGreaterThan(8);
    expect(result.missingSnapshotEvents).toEqual([]);
    expect(result.addedProposalCount).toBe(4);
    expect(result.dismissedProposalCount).toBe(3);
    expect(result.pendingProposalCount).toBe(0);
    expect(result.proposalCounts).toEqual({ added: 4, dismissed: 3, pending: 0 });
    expect(result.pdfSourcesWithCompletionTrace).toBe(5);
    expect(result.askProposalSourcesWithCompletionTrace).toBe(4);
    expect(snapshots.length).toBe(result.snapshotCount);
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(3);
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(3);
    expect(proposals).toHaveLength(7);
    expect(result.project.nodes.some((node) => node.text.includes('packing-and-delivery rehearsal') && node.status === 'OPEN')).toBe(true);
    expect(result.project.nodes.some((node) => node.type === 'DECISION' && node.status === 'RESOLVED')).toBe(true);
    expect(result.projects.some((project) => project.id === result.project.id)).toBe(true);
    expect(generationRuns).toEqual([expect.objectContaining({ id: result.generationRunId, status: 'completed' })]);
    expect(generationSteps.length).toBeGreaterThan(0);
    expect(generationSteps.every((step) => step.projectId === result.project.id)).toBe(true);
  });
});
