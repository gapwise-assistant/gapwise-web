import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import harborFixture from '@/lib/demo/fixtures/firestore/harbor-history-real.json';
import riversideFixture from '@/lib/demo/fixtures/firestore/riverside-delivery-failure.json';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { confirmDecision } from '@/lib/decisions/workspace';
import { answerQuestion } from '@/lib/questions/answerQuestion';
import {
  persistAskProposal,
} from '@/lib/ask/conversationContext';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { getStorageProvider, resetStorageProviderForTests, saveProject } from '@/lib/storage';
import { normalizeAskContextProposals, type AskChatMessage } from '@/types/ask';
import type { ClarityNode, EdgeType, Project, ProjectHistoryEvent, ProjectPatchOperation } from '@/types/clarity';
import {
  createJourneyAnchorBook,
  inspectJourneyAnchor,
  journeyAnchorHasOutcome,
  recordJourneyAnchor,
} from '@/lib/demo/journeyAnchors';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

/**
 * The exported fixtures intentionally remove raw model prompts/responses and
 * source bodies. Their source summaries and canonical source-derived records
 * are the captured semantic inputs used to reconstruct the model boundary in
 * this test. The application still owns every state transition after that
 * boundary.
 */
interface ReplayFixture {
  fixtureVersion: number;
  originalStatus: string;
  originalFailure: string | null;
  userId: string;
  projectId: string;
  collections: {
    contexts: Array<{
      title: string;
      goal: string;
      deadline?: string;
    }>;
    nodes: Array<{
      id: string;
      type: ClarityNode['type'];
      text: string;
      status: ClarityNode['status'];
      confidence?: number;
      importance?: number;
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      type: EdgeType;
      confidence?: number;
    }>;
    sources: Array<{
      id: string;
      filename: string;
      type: 'text' | 'pdf' | 'image' | 'note' | 'voice';
      extraction_summary?: string;
      derived_node_ids?: string[];
      processing_status?: string;
      processed_at?: string;
    }>;
  };
  ask: {
    chats: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
  };
}

const harbor = harborFixture as ReplayFixture;
const riverside = riversideFixture as ReplayFixture;

const replayState = vi.hoisted(() => ({
  nextContextAnalysis: null as unknown,
  satisfiesActionText: null as string | null,
}));

const replayModel = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock('@/lib/google/genai', () => ({
  getVertexGenAIClient: () => ({ models: replayModel }),
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function captureRef(nodeId: string): string {
  return `captured:${nodeId}`;
}

function nodeOperation(node: ReplayFixture['collections']['nodes'][number]): ProjectPatchOperation | undefined {
  const common = {
    text: node.text,
    confidence: node.confidence ?? 0.8,
    impact: node.importance ?? 0.7,
    operationRef: captureRef(node.id),
  };

  if (node.type === 'GOAL') return undefined;
  if (node.type === 'DECISION') return { op: 'OPEN_DECISION', ...common };
  if (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') return { op: 'OPEN_UNKNOWN', ...common };
  if (node.type === 'NEXT_ACTION') return { op: 'ADD_ACTION', ...common };
  if (['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'PREFERENCE', 'RISK'].includes(node.type)) {
    return {
      op: 'ADD_CONTEXT',
      nodeType: node.type,
      ...common,
    } as ProjectPatchOperation;
  }
  return undefined;
}

function sourceNodeIds(
  fixture: ReplayFixture,
  source: ReplayFixture['collections']['sources'][number],
): Set<string> {
  return new Set(source.derived_node_ids ?? []);
}

function analysisForSource(
  fixture: ReplayFixture,
  source: ReplayFixture['collections']['sources'][number],
  canonicalIds: Map<string, string>,
): Record<string, unknown> {
  const sourceIds = sourceNodeIds(fixture, source);
  const nodes = fixture.collections.nodes.filter((node) => sourceIds.has(node.id));
  const operations = nodes
    .map(nodeOperation)
    .filter((operation): operation is ProjectPatchOperation => Boolean(operation));

  const relationships = fixture.collections.edges
    .filter((edge) => sourceIds.has(edge.source) || sourceIds.has(edge.target))
    .flatMap((edge) => {
      const sourceRef = sourceIds.has(edge.source) ? captureRef(edge.source) : canonicalIds.get(edge.source);
      const targetRef = sourceIds.has(edge.target) ? captureRef(edge.target) : canonicalIds.get(edge.target);
      if (!sourceRef || !targetRef) return [];
      return [{
        source_ref: sourceRef,
        target_ref: targetRef,
        type: edge.type,
        confidence: edge.confidence ?? 0.8,
      }];
    });

  return {
    summary: source.extraction_summary ?? `Captured input from ${source.filename}.`,
    relevance: 'relevant',
    operations,
    relationships,
  };
}

function responseText(request: unknown): string {
  const contents = (request as { contents?: Array<{ parts?: Array<{ text?: unknown }> }> }).contents;
  return String(contents?.[0]?.parts?.find((part) => typeof part.text === 'string')?.text ?? '');
}

function completionResponse(prompt: string): Record<string, unknown> {
  const json = prompt.slice(prompt.lastIndexOf('\n') + 1);
  let request: {
    nodes?: Array<{ id: string; type: ClarityNode['type']; text?: string }>;
    pairs?: Array<{ pairId: string; sourceNodeId: string; targetNodeId: string; allowedTypes: EdgeType[] }>;
  } = {};
  try {
    request = JSON.parse(json) as typeof request;
  } catch {
    return { classifications: [] };
  }

  const nodesById = new Map((request.nodes ?? []).map((node) => [node.id, node]));
  const classifications = (request.pairs ?? [])
    .flatMap((pair) => {
      const source = nodesById.get(pair.sourceNodeId);
      const target = nodesById.get(pair.targetNodeId);
      if (
        source?.type === 'NEXT_ACTION'
        && ['DECISION', 'UNKNOWN', 'ASSUMPTION'].includes(target?.type ?? '')
        && pair.allowedTypes.includes('satisfies')
        && (!replayState.satisfiesActionText || source.text === replayState.satisfiesActionText)
      ) {
        return [{ pair_id: pair.pairId, relationship: 'satisfies', confidence: 0.96 }];
      }
      return [];
    });
  return { classifications };
}

function assertNoDuplicateSemanticNodes(project: Project): void {
  const keys = new Set<string>();
  project.nodes
    .filter((node) => node.status !== 'DEPRECATED')
    .forEach((node) => {
      const key = `${node.type}:${node.text.trim().toLowerCase().replace(/\s+/g, ' ')}`;
      expect(keys.has(key), `duplicate canonical node: ${key}`).toBe(false);
      keys.add(key);
    });
}

function transitionForEvent(event: ProjectHistoryEvent): 'project_created' | 'context_processed' | 'gap_resolved' | 'decision_confirmed' | 'action_completed' | null {
  switch (event.type) {
    case 'project_started': return 'project_created';
    case 'context_added': return 'context_processed';
    case 'gap_resolved': return 'gap_resolved';
    case 'decision_resolved': return 'decision_confirmed';
    case 'action_completed': return 'action_completed';
    default: return null;
  }
}

async function checkpoint(
  userId: string,
  before: Project,
  next: Project,
  expectedSourceId: string | undefined,
  label: string,
): Promise<Project> {
  const priorNodeIds = new Set(before.nodes.map((node) => node.id));
  const priorEdgeIds = new Set(before.edges.map((edge) => edge.id));
  await saveProject(userId, next);
  const reloaded = await getStorageProvider().getProject(userId, next.id);

  try {
    expect(reloaded?.id).toBe(next.id);
    expect(reloaded).not.toBeNull();
    const project = reloaded!;
    if (expectedSourceId) {
      const persistedSource = project.sources.find((source) => source.id === expectedSourceId);
      expect(persistedSource).toMatchObject({
        processing_status: 'completed',
      });
      const relationshipStage = persistedSource?.processing_log?.stages.find((stage) => stage.name === 'Relationship completion');
      expect(relationshipStage).toMatchObject({
        status: expect.stringMatching(/completed|failed/),
      });
      expect(relationshipStage?.output).toEqual(expect.objectContaining({
        candidatePairs: expect.any(Array),
        classifications: expect.any(Array),
        acceptedRelationships: expect.any(Array),
        rejectedRelationships: expect.any(Array),
      }));
    }
    expect(new Set(project.nodes.map((node) => node.id))).toEqual(new Set(next.nodes.map((node) => node.id)));
    expect(new Set(project.edges.map((edge) => edge.id))).toEqual(new Set(next.edges.map((edge) => edge.id)));
    expect(project.nodes.filter((node) => priorNodeIds.has(node.id))).toHaveLength(
      [...priorNodeIds].filter((id) => project.nodes.some((node) => node.id === id)).length,
    );
    expect(project.edges.filter((edge) => priorEdgeIds.has(edge.id))).toHaveLength(
      [...priorEdgeIds].filter((id) => project.edges.some((edge) => edge.id === id)).length,
    );
    project.edges.forEach((edge) => {
      expect(project.nodes.some((node) => node.id === edge.source)).toBe(true);
      expect(project.nodes.some((node) => node.id === edge.target)).toBe(true);
    });
    assertNoDuplicateSemanticNodes(project);

    const previousEvents = new Set((before.historyEvents ?? []).map((event) => event.id));
    const newEvents = (project.historyEvents ?? []).filter((event) => !previousEvents.has(event.id));
    if (expectedSourceId) {
      expect(newEvents.filter((event) => event.sourceId === expectedSourceId)).toHaveLength(1);
    }

    for (const event of newEvents) {
      const triggerType = transitionForEvent(event);
      if (!triggerType) continue;
      const snapshot = await createProjectSnapshot({
        userId,
        projectId: project.id,
        trigger: {
          type: triggerType,
          historyEventId: event.id,
          ...(event.sourceId ? { sourceId: event.sourceId } : {}),
          ...(event.primaryNodeId ? { nodeId: event.primaryNodeId } : {}),
        },
        label: `${label}: ${event.title}`,
        summary: event.summary,
      });
      expect(snapshot.trigger.historyEventId).toBe(event.id);
      expect(await getStorageProvider().getProjectSnapshot(userId, snapshot.id)).toEqual(snapshot);
    }
    return project;
  } catch (error) {
    throw new Error(JSON.stringify({
      journeyStep: label,
      projectId: next.id,
      sourceId: expectedSourceId,
      processingStatus: expectedSourceId
        ? reloaded?.sources.find((source) => source.id === expectedSourceId)?.processing_status
        : undefined,
      nodeCount: reloaded?.nodes.length,
      edgeCount: reloaded?.edges.length,
      saveResult: 'completed',
      reloadedProjectId: reloaded?.id,
      expectedState: { nodeIds: [...next.nodes].map((node) => node.id) },
      actualState: { nodeIds: reloaded?.nodes.map((node) => node.id) },
      cause: error instanceof Error ? error.message : String(error),
    }, null, 2));
  }
}

async function replayFixture(
  fixture: ReplayFixture,
  userId: string,
  name: string,
): Promise<Project> {
  const context = fixture.collections.contexts[0];
  if (!context) throw new Error(`Fixture ${name} has no project context.`);
  let project = createProjectFromInput({
    name: `${context.title} replay`,
    goal: context.goal,
    deadline: context.deadline,
  }, '2026-08-27T00:00:00.000Z');
  const storage = getStorageProvider();

  if (name === 'Riverside') {
    const capturedSatisfiesEdge = fixture.collections.edges.find((edge) => edge.type === 'satisfies');
    replayState.satisfiesActionText = fixture.collections.nodes.find((node) => node.id === capturedSatisfiesEdge?.source)?.text ?? null;
  } else {
    replayState.satisfiesActionText = null;
  }

  project = await checkpoint(
    userId,
    { ...project, historyEvents: [] },
    project,
    undefined,
    `${name}: project created`,
  );

  const canonicalIds = new Map<string, string>();
  const fixtureGoal = fixture.collections.nodes.find((node) => node.type === 'GOAL');
  const actualGoal = project.nodes.find((node) => node.type === 'GOAL');
  if (fixtureGoal && actualGoal) canonicalIds.set(fixtureGoal.id, actualGoal.id);

  const orderedSources = fixture.collections.sources
    .filter((source) => !source.filename.toLowerCase().startsWith('ask '))
    .slice()
    .sort((left, right) => (left.processed_at ?? '').localeCompare(right.processed_at ?? '') || left.id.localeCompare(right.id));

  for (const source of orderedSources) {
    const sourceId = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${source.id}`;
    replayState.nextContextAnalysis = analysisForSource(fixture, source, canonicalIds);
    const result = await processContextSource(project, {
      sourceId,
      filename: source.filename,
      type: source.type,
      content: source.extraction_summary ?? source.filename,
      origin: 'user',
    }, DEFAULT_USER_PROFILE, {
      genAI: { models: replayModel } as any,
      captureProcessingLog: true,
    });
    project = await checkpoint(userId, project, result.project, sourceId, `${name}: ${source.filename}`);

    const sourceNodeSet = sourceNodeIds(fixture, source);
    for (const fixtureNode of fixture.collections.nodes.filter((node) => sourceNodeSet.has(node.id))) {
      const actual = project.nodes.find((node) =>
        node.text === fixtureNode.text && node.source_refs.includes(sourceId),
      );
      if (actual) canonicalIds.set(fixtureNode.id, actual.id);
    }
  }

  if (name === 'Riverside') {
    const capturedChat = fixture.ask.chats[0];
    if (capturedChat) {
      await storage.saveAskChat(userId, {
        ...clone(capturedChat),
        id: `${name.toLowerCase()}:chat:planning`,
        userId,
        projectId: project.id,
        scopeType: 'project',
      } as any);
    }
    const capturedAssistant = fixture.ask.messages.find((message) =>
      message.role === 'assistant' && normalizeAskContextProposals(message.contextProposals ?? message.proposals)
        .some((proposal) => proposal.type === 'NEXT_ACTION' && /packing-and-delivery rehearsal/i.test(proposal.text)),
    );
    if (capturedAssistant) {
      const assistantMessage: AskChatMessage = {
        ...clone(capturedAssistant),
        id: `${name.toLowerCase()}:message:planning`,
        chatId: `${name.toLowerCase()}:chat:planning`,
        userId,
        projectId: project.id,
        role: 'assistant',
        text: String(capturedAssistant.text ?? ''),
        sources: [],
        createdAt: '2026-08-27T00:01:00.000Z',
      } as AskChatMessage;
      await storage.saveAskMessage(userId, assistantMessage);

      const proposals = normalizeAskContextProposals(capturedAssistant.contextProposals ?? capturedAssistant.proposals);
      const actionProposal = proposals.find((proposal) => proposal.type === 'NEXT_ACTION');
      const questionProposal = proposals.find((proposal) => proposal.type === 'UNKNOWN');
      for (const proposal of [actionProposal, questionProposal]) {
        if (!proposal) continue;
        const projectBeforeProposal = project;
        project = await persistAskProposal({
          userId,
          projectId: project.id,
          assistantMessageId: assistantMessage.id,
          proposal: {
            ...proposal,
            sourceMessageId: assistantMessage.id,
          },
        });
        project = await checkpoint(
          userId,
          projectBeforeProposal,
          project,
          project.sources.at(-1)?.id,
          `${name}: Ask proposal ${proposal.type}`,
        );
      }
    }

    const deliveryDecision = project.nodes.find((node) =>
      node.type === 'DECISION' && /delivery coverage/i.test(node.text),
    ) ?? project.nodes.find((node) => node.type === 'DECISION');
    const deliveryAction = replayState.satisfiesActionText
      ? project.nodes.find((node) => node.type === 'NEXT_ACTION' && node.text === replayState.satisfiesActionText)
      : project.nodes.find((node) => node.type === 'NEXT_ACTION');
    if (!deliveryDecision || !deliveryAction) {
      throw new Error(JSON.stringify({
        journeyStep: `${name}: delivery anchor`,
        projectId: project.id,
        anchorKey: 'deliveryCoverage',
        actionNodeId: deliveryAction?.id,
        outcomeNodeId: deliveryDecision?.id,
        candidateNodeIds: project.nodes.filter((node) => ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'NEXT_ACTION'].includes(node.type)).map((node) => node.id),
        expectedState: 'action and outcome should be present after captured proposal replay',
      }, null, 2));
    }

    const anchors = createJourneyAnchorBook();
    recordJourneyAnchor(anchors, {
      key: 'deliveryCoverage',
      project,
      candidateNodeIds: [deliveryAction.id, deliveryDecision.id],
      actionNodeId: deliveryAction.id,
      outcomeNodeId: deliveryDecision.id,
    });

    const answeredQuestion = project.nodes.find((node) =>
      node.type === 'UNKNOWN' && /paperwork/i.test(node.text),
    );
    if (answeredQuestion) {
      const beforeAnswer = project;
      const answerResult = await answerQuestion({
        userId,
        projectId: project.id,
        nodeId: answeredQuestion.id,
        answer: 'The kitchen paperwork is complete before the first cooking shift.',
      });
      project = await checkpoint(userId, beforeAnswer, answerResult.context, undefined, `${name}: Ask answer`);
    }

    const beforeDecision = project;
    const currentDecision = project.nodes.find((node) => node.id === deliveryDecision.id) ?? project.nodes.find((node) => node.type === 'DECISION');
    if (!currentDecision) throw new Error(`${name} lost its anchored decision before confirmation.`);
    project = confirmDecision(project, {
      decisionNodeId: currentDecision.id,
      customDecision: 'Confirm primary and backup volunteer delivery coverage for every Wednesday route.',
      reason: 'Captured fixture outcome used for the replay transition.',
    });
    project = await checkpoint(userId, beforeDecision, project, undefined, `${name}: decision confirmation`);

    const deliveryInspection = inspectJourneyAnchor(anchors, 'deliveryCoverage', project);
    expect(deliveryInspection.anchor?.actionNodeId).toBe(deliveryAction.id);
    expect(deliveryInspection.anchor?.outcomeNodeId).toBe(deliveryDecision.id);
    expect(journeyAnchorHasOutcome(deliveryInspection)).toBe(true);
    expect(project.nodes.find((node) => node.id === deliveryDecision.id)?.status).toBe('RESOLVED');
    expect(project.nodes.find((node) => node.id === deliveryAction.id)?.status).toBe('RESOLVED');
    expect((project.historyEvents ?? []).filter((event) =>
      event.type === 'action_completed' && event.primaryNodeId === deliveryAction.id,
    )).toHaveLength(1);
  }

  return project;
}

describe('fixture-backed project generation replay', () => {
  let storagePath = '';
  const originalEnvironment: Record<string, string | undefined> = {};

  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(os.tmpdir(), 'gapwise-fixture-replay-'));
    for (const key of ['USE_FIRESTORE', 'GAPSWISE_DEMO_MODE', 'GAPSWISE_MOCK_STORAGE_PATH', 'GAP_AGENT_MODE']) {
      originalEnvironment[key] = process.env[key];
    }
    process.env.USE_FIRESTORE = 'false';
    process.env.GAPSWISE_DEMO_MODE = 'false';
    process.env.GAP_AGENT_MODE = 'deterministic';
    process.env.GAPSWISE_MOCK_STORAGE_PATH = path.join(storagePath, 'storage.json');
    resetStorageProviderForTests();
    replayState.nextContextAnalysis = null;
    replayState.satisfiesActionText = null;
    replayModel.generateContent.mockReset();
    replayModel.generateContent.mockImplementation(async (request: unknown) => {
      const prompt = responseText(request);
      if (prompt.includes("canonical project-state interpreter")) {
        return {
          text: JSON.stringify(replayState.nextContextAnalysis ?? {
            summary: 'No captured project change.',
            relevance: 'relevant',
            operations: [],
            relationships: [],
          }),
          modelVersion: 'captured-fixture-model',
        };
      }
      return {
        text: JSON.stringify(completionResponse(prompt)),
        modelVersion: 'captured-fixture-model',
      };
    });
  });

  afterEach(async () => {
    resetStorageProviderForTests();
    await rm(storagePath, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('replays the sanitized Harbor fixture through ingestion, persistence, reload, and snapshots', async () => {
    const project = await replayFixture(harbor, 'fixture-replay-harbor', 'Harbor');
    const storage = getStorageProvider();
    const reloaded = await storage.getProject('fixture-replay-harbor', project.id);
    const snapshots = await storage.listProjectSnapshots('fixture-replay-harbor', project.id);

    expect(reloaded?.id).toBe(project.id);
    expect(reloaded?.nodes.length).toBe(project.nodes.length);
    expect(reloaded?.edges.length).toBe(project.edges.length);
    expect(reloaded?.sources.every((source) => source.processing_status === 'completed')).toBe(true);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(reloaded?.historyEvents?.some((event) => event.type === 'project_started')).toBe(true);
    expect(replayModel.generateContent).toHaveBeenCalled();
  });

  it('replays Riverside captured failure inputs and completes the anchored delivery transition after reload', async () => {
    const project = await replayFixture(riverside, 'fixture-replay-riverside', 'Riverside');
    const storage = getStorageProvider();
    const reloaded = await storage.getProject('fixture-replay-riverside', project.id);
    const snapshots = await storage.listProjectSnapshots('fixture-replay-riverside', project.id);

    expect(riverside.originalStatus).toBe('failed');
    expect(riverside.originalFailure).toContain('deliveryCoverage');
    expect(reloaded?.id).toBe(project.id);
    expect(reloaded?.nodes.some((node) =>
      node.type === 'DECISION'
      && node.status === 'RESOLVED'
      && /delivery coverage/i.test(node.decision_outcome ?? ''),
    )).toBe(true);
    expect(reloaded?.nodes.some((node) =>
      node.type === 'NEXT_ACTION'
      && node.status === 'RESOLVED',
    )).toBe(true);
    expect((reloaded?.historyEvents ?? []).filter((event) => event.type === 'action_completed')).toHaveLength(1);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(reloaded?.sources.filter((source) => source.processing_log?.stages?.some((stage) => stage.name === 'Relationship completion')).length).toBeGreaterThan(0);
  });
});
