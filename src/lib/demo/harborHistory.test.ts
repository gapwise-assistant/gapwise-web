import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/types/clarity';
import type { AskContextProposal } from '@/types/ask';

const mocks = vi.hoisted(() => ({
  storage: null as any,
  snapshots: [] as any[],
  generationRuns: [] as any[],
  generationSteps: [] as any[],
  askCalls: 0,
  uploadContextSourcePdf: vi.fn(),
  processContextSource: vi.fn(),
  refreshProjectGapRuntime: vi.fn(),
  askGapswise: vi.fn(),
  persistAskConversationContext: vi.fn(),
  persistAskProposal: vi.fn(),
  confirmDecision: vi.fn(),
  answerQuestion: vi.fn(),
  createProjectSnapshot: vi.fn(),
  getCachedFocusAssessment: vi.fn(),
  getProjectOverviewAssessmentWithMetadata: vi.fn(),
  buildContextPackForUser: vi.fn(),
  generateDailyBrief: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({ getStorageProvider: () => mocks.storage }));
vi.mock('@/lib/storage/gcsAssets', () => ({ uploadContextSourcePdf: mocks.uploadContextSourcePdf }));
vi.mock('@/lib/context/ingestion', () => ({ hashText: vi.fn(async (value: string) => `hash:${value.length}`) }));
vi.mock('@/lib/context/contextAnalysis', () => ({ processContextSource: mocks.processContextSource }));
vi.mock('@/lib/agents/gapRuntime', () => ({ refreshProjectGapRuntime: mocks.refreshProjectGapRuntime }));
vi.mock('@/lib/ask/adkClient', () => ({ askGapswise: mocks.askGapswise }));
vi.mock('@/lib/ask/conversationContext', () => ({
  persistAskConversationContext: mocks.persistAskConversationContext,
  persistAskProposal: mocks.persistAskProposal,
}));
vi.mock('@/lib/decisions/workspace', () => ({ confirmDecision: mocks.confirmDecision }));
vi.mock('@/lib/questions/answerQuestion', () => ({ answerQuestion: mocks.answerQuestion }));
vi.mock('@/lib/history/projectSnapshots', () => ({ createProjectSnapshot: mocks.createProjectSnapshot }));
vi.mock('@/lib/focus/focusCache', () => ({ getCachedFocusAssessment: mocks.getCachedFocusAssessment }));
vi.mock('@/lib/overview/projectOverviewCache', () => ({
  getProjectOverviewAssessmentWithMetadata: mocks.getProjectOverviewAssessmentWithMetadata,
}));
vi.mock('@/lib/retrieval/contextPackServer', () => ({ buildContextPackForUser: mocks.buildContextPackForUser }));
vi.mock('@/lib/attention/generateBrief', () => ({ generateDailyBrief: mocks.generateDailyBrief }));

import { createProjectFromInput } from '@/lib/projects/createProject';
import { createHarborHistoryDemoForUser, proposalIdFor, proposalSourceIdFor } from '@/lib/demo/harborHistory';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function historyEvent(project: Project, id: string, type: 'context_added' | 'context_changed' | 'decision_resolved' | 'gap_resolved', sourceId?: string) {
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

function proposal(type: AskContextProposal['type'], text: string): AskContextProposal {
  return { type, text, status: 'OPEN', confirmationStatus: 'pending' };
}

describe('Harbor history demo journey', () => {
  beforeEach(() => {
    process.env.CLOUD_STORAGE_BUCKET = 'test-bucket';
    mocks.snapshots = [];
    mocks.askCalls = 0;
    mocks.uploadContextSourcePdf.mockReset();
    mocks.processContextSource.mockReset();
    mocks.refreshProjectGapRuntime.mockReset();
    mocks.askGapswise.mockReset();
    mocks.persistAskConversationContext.mockReset();
    mocks.persistAskProposal.mockReset();
    mocks.confirmDecision.mockReset();
    mocks.answerQuestion.mockReset();
    mocks.createProjectSnapshot.mockReset();
    mocks.getCachedFocusAssessment.mockReset();
    mocks.getProjectOverviewAssessmentWithMetadata.mockReset();
    mocks.buildContextPackForUser.mockReset();
    mocks.generateDailyBrief.mockReset();

    let project: Project | null = null;
    const messages: any[] = [];
    const chats: any[] = [];
    mocks.generationRuns = [];
    mocks.generationSteps = [];
    mocks.storage = {
      getMemories: vi.fn(async () => []),
      getProject: vi.fn(async () => clone(project)),
      listProjects: vi.fn(async () => project ? [clone(project)] : []),
      saveProject: vi.fn(async (_userId: string, next: Project) => { project = clone(next); }),
      getAskMessages: vi.fn(async () => clone(messages)),
      saveAskMessage: vi.fn(async (_userId: string, message: any) => {
        const index = messages.findIndex((candidate) => candidate.id === message.id);
        if (index >= 0) messages[index] = clone(message);
        else messages.push(clone(message));
      }),
      getAskChats: vi.fn(async () => clone(chats)),
      saveAskChat: vi.fn(async (_userId: string, chat: any) => {
        const index = chats.findIndex((candidate) => candidate.id === chat.id);
        if (index >= 0) chats[index] = clone(chat);
        else chats.push(clone(chat));
      }),
      getAskResearch: vi.fn(async () => []),
      listProjectSnapshots: vi.fn(async () => mocks.snapshots.map((snapshot) => ({
        id: snapshot.id,
        sequence: snapshot.sequence,
        trigger: snapshot.trigger,
      }))),
      getProjectSnapshot: vi.fn(async (_userId: string, id: string) => clone(mocks.snapshots.find((snapshot) => snapshot.id === id) ?? null)),
      listDeveloperGenerationRuns: vi.fn(async (_userId: string, projectId?: string) => clone(mocks.generationRuns.filter((run) => !projectId || run.projectId === projectId))),
      getDeveloperGenerationRun: vi.fn(async (_userId: string, id: string) => clone(mocks.generationRuns.find((run) => run.id === id) ?? null)),
      saveDeveloperGenerationRun: vi.fn(async (_userId: string, run: any) => {
        const index = mocks.generationRuns.findIndex((candidate) => candidate.id === run.id);
        if (index >= 0) mocks.generationRuns[index] = clone(run);
        else mocks.generationRuns.push(clone(run));
      }),
      getDeveloperGenerationSteps: vi.fn(async (_userId: string, runId: string) => clone(mocks.generationSteps.filter((step) => step.runId === runId))),
      saveDeveloperGenerationStep: vi.fn(async (_userId: string, step: any) => {
        const index = mocks.generationSteps.findIndex((candidate) => candidate.id === step.id);
        if (index >= 0) mocks.generationSteps[index] = clone(step);
        else mocks.generationSteps.push(clone(step));
      }),
      setAppScope: vi.fn(async () => undefined),
    };

    mocks.uploadContextSourcePdf.mockImplementation(async ({ sourceId, filename }: { sourceId: string; filename: string }) => ({
      storageUrl: `gs://test-bucket/${sourceId}/${filename}`,
    }));
    mocks.refreshProjectGapRuntime.mockImplementation(async ({ project: next }: { project: Project }) => ({ project: next, runtime: null }));
    mocks.buildContextPackForUser.mockResolvedValue({
      includedContextIds: [], activeGoals: [], unresolvedGaps: [], relevantEvidence: [],
      provenanceSources: [], userPreferences: [], recentDecisions: [], upcomingCommitments: [],
    });
    mocks.getCachedFocusAssessment.mockResolvedValue({
      kind: 'question', title: 'Test focus', representedNodeIds: [], sourceNodeIds: [], sourceIds: [], score: 1, confidence: 1,
    });
    mocks.getProjectOverviewAssessmentWithMetadata.mockResolvedValue({
      assessment: { trajectory: { state: 'taking_shape', explanation: 'Test' }, summary: 'Test', meaningfulChanges: [], goalImpact: { summary: 'Test', positiveFactors: [], negativeFactors: [] }, unsettled: [], criticalIssues: [], emergingInsights: [], confidence: 1 },
      cache: { status: 'generated', projectStateVersion: 'test' },
    });
    mocks.generateDailyBrief.mockReturnValue({ generated_at: new Date().toISOString(), recommendations: [] });

    mocks.processContextSource.mockImplementation(async (current: Project, input: any) => {
      const next = clone(current);
      const sourceId = input.sourceId;
      next.sources = [...next.sources, {
        id: sourceId, filename: input.filename, type: 'pdf', content: input.content,
        extracted_at: new Date().toISOString(), derived_node_ids: [], processing_status: 'completed',
        storage_url: input.storageUrl,
      }];
      const slug = input.filename.toLowerCase();
      if (slug.includes('security requirements')) {
        next.nodes.push(node(next, 'deletion', 'UNKNOWN', 'Can engineering enforce 30-day customer-data deletion?'));
      }
      if (slug.includes('engineering integration')) {
        next.nodes.push(node(next, 'technical', 'DECISION', 'Choose the technical integration for the Harbor pilot.'));
      }
      if (slug.includes('procurement update')) {
        next.nodes.push(node(next, 'pricing', 'DECISION', 'Approve the Harbor pilot price.'));
      }
      if (slug.includes('launch readiness')) {
        next.nodes.push(node(next, 'rehearsal', 'UNKNOWN', 'Has the production access rehearsal been completed successfully?'));
      }
      next.historyEvents = [...(next.historyEvents ?? []), historyEvent(next, `event:${sourceId}`, 'context_added', sourceId)];
      return { project: next, skipped: false };
    });

    mocks.persistAskConversationContext.mockImplementation(async ({ projectId, chatId, messageId }: any) => {
      if (!project) throw new Error('missing test project');
      const next = clone(project);
      const sourceId = `ask_${chatId}_${messageId}`;
      const event = historyEvent(next, `event:${messageId}`, 'context_changed', sourceId);
      next.historyEvents = [...(next.historyEvents ?? []), event];
      project = next;
      return { sourceId, historyEventId: event.id, openQuestionIds: [], openQuestions: [] };
    });

    mocks.persistAskProposal.mockImplementation(async ({ proposal: selected, assistantMessageId }: any) => {
      if (!project) throw new Error('missing test project');
      const next = clone(project);
      const proposalId = selected.id;
      const sourceId = proposalSourceIdFor(assistantMessageId, proposalId);
      const nodeId = `proposal-node-${proposalId}`;
      next.sources.push({
        id: sourceId,
        filename: `Ask proposal ${assistantMessageId}.txt`,
        type: 'note',
        content: selected.text,
        extracted_at: new Date().toISOString(),
        derived_node_ids: [nodeId],
        processing_status: 'completed',
      });
      next.nodes.push({
        ...node(next, nodeId, selected.type === 'DECISION' ? 'DECISION' : 'UNKNOWN', selected.text),
        type: selected.type,
        source_refs: [sourceId],
      } as any);
      next.historyEvents = [...(next.historyEvents ?? []), historyEvent(next, `event:${proposalId}`, 'context_added', sourceId)];
      project = next;
      return next;
    });

    mocks.askGapswise.mockImplementation(async () => {
      mocks.askCalls += 1;
      const proposalSets = [
        [],
        [proposal('RISK', 'This unrelated model suggestion must not control the Harbor journey.')],
        [],
      ];
      return {
        answer: `Test Ask response ${mocks.askCalls}`,
        outcome: 'exploration',
        contextProposals: proposalSets[mocks.askCalls - 1],
        proposals: proposalSets[mocks.askCalls - 1],
        sessionId: `session-${mocks.askCalls}`,
        sources: [],
        openQuestionIds: [],
        openQuestions: [],
        execution: { route: 'graph_reasoning', agent: 'Partner Agent', toolCalls: ['ADK /run_sse'] },
      };
    });

    mocks.confirmDecision.mockImplementation((current: Project, input: any) => {
      const next = clone(current);
      const target = next.nodes.find((candidate) => candidate.id === input.decisionNodeId);
      if (target) {
        target.status = 'RESOLVED';
        target.decision_outcome = input.customDecision;
      }
      const event = historyEvent(next, `decision:${input.decisionNodeId}`, 'decision_resolved');
      next.historyEvents = [...(next.historyEvents ?? []), { ...event, primaryNodeId: input.decisionNodeId }];
      return next;
    });
    mocks.answerQuestion.mockImplementation(async ({ nodeId }: any) => {
      if (!project) throw new Error('missing test project');
      const next = clone(project);
      const target = next.nodes.find((candidate) => candidate.id === nodeId);
      if (target) target.status = 'RESOLVED';
      next.history = [{ question: target?.text ?? '', answer: 'Confirmed', timestamp: new Date().toISOString(), graph_diff_summary: 'resolved', nodeId }];
      const event = historyEvent(next, `gap:${nodeId}`, 'gap_resolved');
      next.historyEvents = [...(next.historyEvents ?? []), { ...event, primaryNodeId: nodeId }];
      project = next;
      return { context: next };
    });

    mocks.createProjectSnapshot.mockImplementation(async ({ projectId, trigger, label, summary }: any) => {
      if (!project) throw new Error('missing test project');
      const snapshot = {
        id: `snapshot:${mocks.snapshots.length + 1}`,
        userId: 'demo-user', projectId, sequence: mocks.snapshots.length + 1,
        createdAt: new Date().toISOString(), schemaVersion: 2, trigger, label, summary,
        projectState: clone(project), references: { sourceIds: [], chatIds: [], messageIds: [], researchIds: [], traceIds: [] },
        proposalStates: messages.flatMap((message) => (message.contextProposals ?? []).map((candidate: any) => ({ proposalId: candidate.id, messageId: message.id, confirmationStatus: candidate.confirmationStatus ?? 'pending' }))),
        listSummary: { counts: { nodes: project.nodes.length, edges: project.edges.length, sources: project.sources.length, chats: chats.length, messages: messages.length, pendingProposals: 0 } },
        assessments: { focus: { title: 'focus' }, overview: { summary: 'overview' }, today: { generatedAt: new Date().toISOString() } },
      };
      mocks.snapshots.push(snapshot);
      return snapshot;
    });
  });

  it('replays documents, Ask proposal transitions, resolutions, and final open rehearsal state', async () => {
    const result = await createHarborHistoryDemoForUser({ userId: 'demo-user', fresh: true });

    expect(result.chatCount).toBe(1);
    expect(result.messageCount).toBe(6);
    expect(result.userMessageCount).toBe(3);
    expect(result.assistantMessageCount).toBe(3);
    expect(result.addedProposalCount).toBe(4);
    expect(result.dismissedProposalCount).toBe(3);
    expect(result.pendingProposalCount).toBe(0);
    expect(result.graphHealth).toMatchObject({
      nodeCount: expect.any(Number),
      edgeCount: expect.any(Number),
      isolatedNodeCount: expect.any(Number),
      isolatedActionableNodeIds: expect.any(Array),
      staleOpenActionIds: expect.any(Array),
      overlappingCanonicalNodeIds: expect.any(Array),
      openWorkflowNodeCount: expect.any(Number),
      connectedOpenWorkflowNodeCount: expect.any(Number),
    });
    expect(result.relationshipCountsByType).toEqual(expect.any(Object));
    expect(result.pdfSourcesWithCompletionTrace).toEqual(expect.any(Number));
    expect(result.askProposalSourcesWithCompletionTrace).toEqual(expect.any(Number));
    expect(result.uniqueSnapshotEventCount).toBe(result.snapshotCount);
    expect(result.askResponseSnapshotCount).toBe(3);
    expect(result.proposalAddedSnapshotCount).toBe(4);
    expect(result.proposalDismissedSnapshotCount).toBe(3);
    expect(result.downloadablePdfCount).toBe(5);
    expect(result.snapshotsWithFocus).toBe(result.snapshotCount);
    expect(result.snapshotsWithOverview).toBe(result.snapshotCount);
    expect(result.snapshotsWithToday).toBe(result.snapshotCount);
    expect(result.missingSnapshotEvents).toEqual([]);
    expect(result.project.nodes.filter((candidate) => candidate.type === 'DECISION' && candidate.status === 'RESOLVED').length).toBeGreaterThanOrEqual(2);
    expect(result.project.nodes.some((candidate) => candidate.text === 'Confirm whether engineering can enforce 30-day customer-data deletion.' && candidate.status === 'RESOLVED')).toBe(true);
    expect(result.project.nodes.find((candidate) => candidate.id === 'rehearsal')?.status).toBe('OPEN');
    expect(mocks.generationRuns).toHaveLength(1);
    expect(mocks.generationRuns[0]).toMatchObject({ projectId: result.project.id, status: 'completed' });
    expect(mocks.generationSteps.length).toBeGreaterThan(0);
    expect(mocks.generationSteps.every((step) => step.projectId === result.project.id)).toBe(true);
    expect(mocks.generationSteps.map((step) => step.sequence)).toEqual([...mocks.generationSteps].sort((left, right) => left.sequence - right.sequence).map((step) => step.sequence));

    expect(mocks.persistAskProposal).toHaveBeenCalledTimes(4);
    expect(mocks.persistAskProposal.mock.calls.map(([input]) => input.proposal.text)).toEqual([
      'Choose the technical integration for the Harbor pilot.',
      'Run the production access rehearsal before launch authorization.',
      'Confirm whether engineering can enforce 30-day customer-data deletion.',
      'Approve the final pilot price for Harbor.',
    ]);
    expect((await mocks.storage.getAskMessages('demo-user')).flatMap((message: any) => message.contextProposals ?? []).map((item: any) => item.text)).not.toContain(
      'This unrelated model suggestion must not control the Harbor journey.',
    );
    expect(result.project.nodes.some((candidate) => [
      'Expand the pilot from 500 to 1,000 tickets.',
      'Record that Harbor approved a temporary exception to the deletion policy.',
      'Reconsider the confirmed CSV integration decision.',
    ].includes(candidate.text))).toBe(false);

    expect(mocks.snapshots.some((snapshot) => snapshot.trigger.type === 'ask_response_created')).toBe(true);
    expect(mocks.snapshots.some((snapshot) => snapshot.trigger.type === 'ask_proposal_added'
      && snapshot.proposalStates.some((state: any) => state.confirmationStatus === 'added'))).toBe(true);
    expect(mocks.snapshots.some((snapshot) => snapshot.trigger.type === 'ask_proposal_dismissed'
      && snapshot.proposalStates.some((state: any) => state.confirmationStatus === 'dismissed'))).toBe(true);

    const securitySnapshot = mocks.snapshots.find((snapshot) => snapshot.label === 'Harbor Security and Data Requirements processed');
    const engineeringSnapshot = mocks.snapshots.find((snapshot) => snapshot.label === 'Engineering Integration Review processed');
    const technicalResolvedSnapshot = mocks.snapshots.find((snapshot) => snapshot.label === 'Technical integration decision confirmed');
    const procurementSnapshot = mocks.snapshots.find((snapshot) => snapshot.label === 'Harbor Procurement Update processed');
    const pricingResolvedSnapshot = mocks.snapshots.find((snapshot) => snapshot.label === 'Pilot pricing decision confirmed');
    const deletionResolvedSnapshot = mocks.snapshots.find((snapshot) => snapshot.label === '30-day deletion question resolved');
    expect(securitySnapshot.projectState.sources.length).toBeGreaterThanOrEqual(2);
    expect(securitySnapshot.projectState.nodes.some((candidate: any) => candidate.id === 'technical')).toBe(false);
    expect(securitySnapshot.projectState.nodes.find((candidate: any) => candidate.id === 'deletion')?.status).toBe('OPEN');
    expect(engineeringSnapshot.projectState.nodes.find((candidate: any) => candidate.id === 'technical')?.status).toBe('OPEN');
    expect(technicalResolvedSnapshot.projectState.nodes.some((candidate: any) => candidate.type === 'DECISION' && candidate.status === 'RESOLVED')).toBe(true);
    expect(procurementSnapshot.projectState.nodes.find((candidate: any) => candidate.id === 'pricing')?.status).toBe('OPEN');
    expect(pricingResolvedSnapshot.projectState.nodes.some((candidate: any) => candidate.type === 'DECISION' && candidate.status === 'RESOLVED')).toBe(true);
    expect(deletionResolvedSnapshot.projectState.nodes.some((candidate: any) => candidate.text === 'Confirm whether engineering can enforce 30-day customer-data deletion.' && candidate.status === 'RESOLVED')).toBe(true);
    expect(mocks.snapshots.every((snapshot) => snapshot.trigger.historyEventId)).toBe(true);

    const proposalEvents = (result.project.historyEvents ?? []).filter((event) =>
      event.type === 'ask_proposal_added' || event.type === 'ask_proposal_dismissed'
    );
    expect(proposalEvents).toHaveLength(7);
    expect(new Set(proposalEvents.map((event) => event.id)).size).toBe(7);
    proposalEvents.forEach((event) => {
      expect(mocks.snapshots.filter((snapshot) => snapshot.trigger.historyEventId === event.id)).toHaveLength(1);
    });
    expect(mocks.snapshots
      .filter((snapshot) => snapshot.trigger.type === 'ask_proposal_added' || snapshot.trigger.type === 'ask_proposal_dismissed')
      .every((snapshot) => snapshot.trigger.askMessageId && snapshot.trigger.proposalId)).toBe(true);
    const askEventIds = new Set(
      mocks.snapshots
        .filter((snapshot) => snapshot.trigger.type === 'ask_response_created')
        .map((snapshot) => snapshot.trigger.historyEventId),
    );
    expect(proposalEvents.every((event) => !askEventIds.has(event.id))).toBe(true);
    expect(mocks.storage.getProjectSnapshot).toHaveBeenCalledTimes(result.snapshotCount);
  });

  it('keeps proposals distinct for a long assistant-message ID', () => {
    const assistantMessageId = `assistant-${'x'.repeat(300)}`;
    const first = proposalIdFor(assistantMessageId, { type: 'RISK', text: 'The pilot may be delayed.' });
    const second = proposalIdFor(assistantMessageId, { type: 'ASSUMPTION', text: 'The pilot will use the current schedule.' });

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(240);
    expect(second.length).toBeLessThanOrEqual(240);
  });
});
