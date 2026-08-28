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
import { materializeProjectSnapshot } from '@/lib/history/projectSnapshots';
import { createHarborHistoryDemoForUser } from '@/lib/demo/harborHistory';

let storagePath = '';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function contextPack(): ContextPack {
  return {
    id: 'integration-context-pack',
    query: 'integration test',
    built_at: '2026-08-26T00:00:00.000Z',
    includedContextIds: [],
    activeGoals: [],
    recentImportantEvents: [],
    unresolvedGaps: [],
    recentlyResolvedGaps: [],
    relevantEvidence: [],
    provenanceSources: [],
    userPreferences: [],
    recentDecisions: [],
    upcomingCommitments: [],
    contradictions: [],
  };
}

function historyEvent(
  project: Project,
  id: string,
  type: 'context_added' | 'context_changed' | 'decision_resolved' | 'gap_resolved',
  sourceId?: string,
) {
  return {
    id,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    type,
    title: id,
    ...(sourceId ? { sourceId } : {}),
  };
}

function node(project: Project, id: string, type: 'DECISION' | 'UNKNOWN', text: string) {
  return {
    id,
    type,
    text,
    status: 'OPEN' as const,
    confidence: 0.9,
    impact: 0.8,
    source_refs: [],
    created_by: 'agent' as const,
    created_at: project.created_at,
    updated_at: project.created_at,
  };
}

describe('Harbor history demo integration', () => {
  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(os.tmpdir(), 'gapwise-harbor-history-'));
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(storagePath, 'storage.json');
    process.env.CLOUD_STORAGE_BUCKET = 'test-bucket';
    resetStorageProviderForTests();

    mocks.processContextSource.mockReset();
    mocks.refreshProjectGapRuntime.mockReset();
    mocks.askGapswise.mockReset();
    mocks.uploadContextSourcePdf.mockReset();
    mocks.confirmDecision.mockReset();
    mocks.answerQuestion.mockReset();
    mocks.getCachedFocusAssessment.mockReset();
    mocks.getProjectOverviewAssessmentWithMetadata.mockReset();
    mocks.buildContextPackForUser.mockReset();
    mocks.generateDailyBrief.mockReset();

    const storage = getStorageProvider();
    mocks.buildContextPackForUser.mockResolvedValue(contextPack());
    mocks.generateDailyBrief.mockReturnValue({
      id: 'test-brief',
      userId: 'integration-user',
      period: '2026-08-26',
      generated_at: new Date().toISOString(),
      recommendations: [],
    });
    mocks.getCachedFocusAssessment.mockImplementation(async (userId: string, project: Project, pack: ContextPack, profile: any) => {
      const assessment = {
        kind: 'question' as const,
        title: 'Integration focus',
        representedNodeIds: [],
        sourceNodeIds: [],
        sourceIds: [],
        score: 1,
        confidence: 1,
      };
      const version = await focusProjectStateVersion(project, pack, profile);
      const now = new Date().toISOString();
      await storage.saveFocusAssessment(userId, {
        id: focusAssessmentCacheId(project.id, version),
        userId,
        projectId: project.id,
        projectStateVersion: version,
        assessment,
        createdAt: now,
        updatedAt: now,
      });
      return assessment;
    });
    mocks.getProjectOverviewAssessmentWithMetadata.mockImplementation(async (
      userId: string,
      project: Project,
      history: Project['historyEvents'],
      focus: any,
      pack: ContextPack,
      deps: { profile?: any } = {},
    ) => {
      const assessment = {
        trajectory: { state: 'taking_shape' as const, explanation: 'Integration assessment' },
        summary: 'Integration assessment',
        meaningfulChanges: [],
        goalImpact: { summary: 'Integration assessment', positiveFactors: [], negativeFactors: [] },
        unsettled: [],
        criticalIssues: [],
        emergingInsights: [],
        confidence: 1,
      };
      const version = await overviewProjectStateVersion(project, history ?? [], focus, pack, deps.profile);
      const now = new Date().toISOString();
      await storage.saveProjectOverviewAssessment(userId, {
        id: projectOverviewAssessmentCacheId(project.id, version),
        userId,
        projectId: project.id,
        projectStateVersion: version,
        assessment,
        createdAt: now,
        updatedAt: now,
      });
      return { assessment, cache: { status: 'generated' as const, projectStateVersion: version } };
    });
    mocks.uploadContextSourcePdf.mockResolvedValue({ storageUrl: 'gs://test-bucket/harbor.pdf' });
    mocks.refreshProjectGapRuntime.mockImplementation(async ({ project }: { project: Project }) => ({ project, runtime: null }));
    mocks.askGapswise.mockResolvedValue({
      answer: 'Live integration Ask answer.',
      outcome: 'exploration',
      contextProposals: [],
      proposals: [],
      sessionId: 'integration-session',
      sources: [],
      openQuestionIds: [],
      openQuestions: [],
      execution: { route: 'internal_context', agent: 'Partner Agent', toolCalls: ['ADK /run_sse'] },
    });
    mocks.processContextSource.mockImplementation(async (current: Project, input: any) => {
      const next = clone(current);
      next.sources = [...next.sources, {
        id: input.sourceId,
        filename: input.filename,
        type: input.type ?? 'note',
        content: input.content,
        extracted_at: new Date().toISOString(),
        derived_node_ids: [],
        processing_status: 'completed',
        storage_url: input.storageUrl,
      }];
      const filename = String(input.filename).toLowerCase();
      if (filename.includes('security requirements')) {
        next.nodes.push(node(next, 'deletion', 'UNKNOWN', 'Can engineering enforce 30-day customer-data deletion?'));
      } else if (filename.includes('engineering integration')) {
        next.nodes.push(node(next, 'technical', 'DECISION', 'Choose the technical integration for the Harbor pilot.'));
      } else if (filename.includes('procurement update')) {
        next.nodes.push(node(next, 'pricing', 'DECISION', 'Approve the Harbor pilot price.'));
      } else if (filename.includes('launch readiness')) {
        next.nodes.push(node(next, 'rehearsal', 'UNKNOWN', 'Has the production access rehearsal been completed successfully?'));
      }
      next.historyEvents = [
        ...(next.historyEvents ?? []),
        historyEvent(next, `event:${input.sourceId}`, 'context_added', input.sourceId),
      ];
      return { project: next, skipped: false };
    });
    mocks.confirmDecision.mockImplementation((current: Project, input: any) => {
      const next = clone(current);
      const target = next.nodes.find((candidate) => candidate.id === input.decisionNodeId);
      if (target) {
        target.status = 'RESOLVED';
        target.decision_outcome = input.customDecision;
      }
      next.historyEvents = [...(next.historyEvents ?? []), {
        ...historyEvent(next, `decision:${input.decisionNodeId}`, 'decision_resolved'),
        primaryNodeId: input.decisionNodeId,
      }];
      return next;
    });
    mocks.answerQuestion.mockImplementation(async ({ nodeId }: { nodeId: string }) => {
      const current = await storage.getProject('integration-user');
      if (!current) throw new Error('missing integration project');
      const next = clone(current);
      const target = next.nodes.find((candidate) => candidate.id === nodeId);
      if (target) target.status = 'RESOLVED';
      next.history = [{
        question: target?.text ?? '',
        answer: 'Confirmed',
        timestamp: new Date().toISOString(),
        graph_diff_summary: 'resolved',
        nodeId,
      }];
      next.historyEvents = [...(next.historyEvents ?? []), {
        ...historyEvent(next, `gap:${nodeId}`, 'gap_resolved'),
        primaryNodeId: nodeId,
      }];
      await storage.saveProject('integration-user', next);
      return { context: next };
    });
  });

  afterEach(async () => {
    resetStorageProviderForTests();
    delete process.env.GAPSWISE_MOCK_STORAGE_PATH;
    delete process.env.CLOUD_STORAGE_BUCKET;
    await rm(storagePath, { recursive: true, force: true });
  });

  it('materializes an early proposal dismissal independently from its Ask response', async () => {
    const result = await createHarborHistoryDemoForUser({ userId: 'integration-user', fresh: true });
    const storage = getStorageProvider();
    const summaries = await storage.listProjectSnapshots('integration-user', result.project.id);
    const askSummary = summaries.find((summary) => summary.trigger.type === 'ask_response_created');
    const dismissalSummary = summaries.find((summary) => summary.trigger.type === 'ask_proposal_dismissed');
    expect(askSummary).toBeDefined();
    expect(dismissalSummary).toBeDefined();
    expect(askSummary?.trigger.historyEventId).not.toBe(dismissalSummary?.trigger.historyEventId);

    const askMoment = await materializeProjectSnapshot({ userId: 'integration-user', snapshotId: askSummary!.id });
    const dismissalMoment = await materializeProjectSnapshot({ userId: 'integration-user', snapshotId: dismissalSummary!.id });
    expect(askMoment.snapshot.trigger.historyEventId).not.toBe(dismissalMoment.snapshot.trigger.historyEventId);
    expect(askMoment.project.historyEvents?.some((event) => event.type === 'ask_proposal_dismissed')).toBe(false);
    expect(dismissalMoment.project.historyEvents?.some((event) => event.type === 'ask_proposal_dismissed')).toBe(true);
    expect(dismissalMoment.project.nodes.some((node) =>
      /30-day.*(?:customer-data )?deletion|delet.*within 30 days/i.test(node.text)
    )).toBe(true);
    expect(dismissalMoment.project.nodes.some((node) =>
      node.text === 'Record that Harbor approved a temporary exception to the deletion policy.'
    )).toBe(false);
    expect(dismissalMoment.project.nodes.some((node) =>
      node.text === 'Expand the pilot from 500 to 1,000 tickets.'
    )).toBe(false);
    expect(dismissalMoment.ask.messages.some((message) =>
      message.contextProposals?.some((proposal) => proposal.confirmationStatus === 'dismissed')
    )).toBe(true);
    expect(result.askResponseSnapshotCount).toBe(3);
    expect(result.proposalDismissedSnapshotCount).toBe(3);
  }, 15_000);
});
