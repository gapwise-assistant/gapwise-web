import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClarityNode, Project } from '@/types/clarity';
import type { AskContextProposal } from '@/types/ask';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  saveProject: vi.fn(),
  loadGeneralContext: vi.fn(),
  saveGeneralContext: vi.fn(),
  getStorageProvider: vi.fn(),
  ingestContextSource: vi.fn(),
  processContextSource: vi.fn(),
  changedProjectNodeIds: vi.fn(),
  completeProjectRelationships: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  listProjects: mocks.listProjects,
  saveProject: mocks.saveProject,
  loadGeneralContext: mocks.loadGeneralContext,
  saveGeneralContext: mocks.saveGeneralContext,
  getStorageProvider: mocks.getStorageProvider,
}));

vi.mock('@/lib/context/ingestion', () => ({ ingestContextSource: mocks.ingestContextSource }));
vi.mock('@/lib/context/contextAnalysis', () => ({ processContextSource: mocks.processContextSource }));
vi.mock('@/lib/graph/relationshipCompletion', () => ({
  changedProjectNodeIds: mocks.changedProjectNodeIds,
  completeProjectRelationships: mocks.completeProjectRelationships,
}));

import { persistAskProposal } from '@/lib/ask/conversationContext';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { serializedProcessingLogSize, PROCESSING_LOG_MAX_BYTES } from '@/lib/context/processingLog';

const now = '2026-08-26T12:00:00.000Z';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function node(
  id: string,
  type: ClarityNode['type'],
  text: string,
  status: ClarityNode['status'] = 'OPEN',
): ClarityNode {
  return {
    id,
    type,
    text,
    status,
    confidence: 0.9,
    impact: 0.8,
    source_refs: [],
    created_by: 'agent',
    created_at: now,
    updated_at: now,
  };
}

function projectWith(...nodes: ClarityNode[]): Project {
  const project = createProjectFromInput({
    name: 'Ask proposal trace test',
    goal: 'Complete the project safely.',
  }, now);
  project.nodes.push(...nodes);
  return project;
}

function proposal(): AskContextProposal {
  return {
    id: 'proposal-1',
    type: 'RISK',
    text: 'A delay could threaten the project outcome.',
    reasoning: 'The current plan has little schedule margin.',
    status: 'OPEN',
  };
}

function ingestedProject(current: Project, input: { sourceId?: string; filename: string; content: string }): Project {
  const next = clone(current);
  const sourceId = input.sourceId ?? 'new-source';
  const proposalNode = node('proposal-node', 'RISK', input.content);
  next.nodes.push(proposalNode);
  next.sources.push({
    id: sourceId,
    filename: input.filename,
    type: 'note',
    content: input.content,
    extracted_at: now,
    derived_node_ids: [proposalNode.id],
    processing_status: 'completed',
  });
  return next;
}

describe('persistAskProposal relationship completion trace', () => {
  let storedProject: Project;

  beforeEach(() => {
    storedProject = projectWith();
    vi.clearAllMocks();
    mocks.listProjects.mockImplementation(async () => [clone(storedProject)]);
    mocks.saveProject.mockImplementation(async (_userId: string, next: Project) => {
      storedProject = clone(next);
    });
    mocks.loadGeneralContext.mockResolvedValue(projectWith());
    mocks.saveGeneralContext.mockResolvedValue(undefined);
    mocks.getStorageProvider.mockReturnValue({
      getUserMemoryProfile: vi.fn(async () => null),
    });
    mocks.processContextSource.mockResolvedValue({ project: storedProject, skipped: false });
    mocks.changedProjectNodeIds.mockReturnValue(['proposal-node']);
    mocks.ingestContextSource.mockImplementation(async (current: Project, input: { sourceId?: string; filename: string; content: string }) =>
      ingestedProject(current, input)
    );
  });

  it('persists a successful relationship completion trace with classifications and accepted edges', async () => {
    mocks.completeProjectRelationships.mockImplementation(async ({ projectAfter }: { projectAfter: Project }) => ({
      project: projectAfter,
      trace: {
        candidatePairs: [{
          pairId: 'pair-1',
          sourceNodeId: 'proposal-node',
          targetNodeId: projectAfter.nodes[0]!.id,
          allowedTypes: ['affects'],
          score: 0.8,
        }],
        classifications: [{ pair_id: 'pair-1', relationship: 'NONE', confidence: 0.1 }],
        acceptedRelationships: [],
        rejectedRelationships: [],
      },
    }));

    await persistAskProposal({
      userId: 'user-1',
      projectId: storedProject.id,
      assistantMessageId: 'assistant-1',
      proposal: proposal(),
    });

    const source = storedProject.sources.find((candidate) => candidate.id.startsWith('ask_proposal_'))!;
    const log = source.processing_log!;
    expect(log.status).toBe('completed');
    expect(log.duration_ms).toEqual(expect.any(Number));
    expect(log.stages).toHaveLength(1);
    expect(log.stages[0]).toMatchObject({
      name: 'Relationship completion',
      status: 'completed',
      duration_ms: expect.any(Number),
      output: {
        candidatePairs: [{ pairId: 'pair-1' }],
        classifications: [{ pair_id: 'pair-1', relationship: 'NONE' }],
        acceptedRelationships: [],
        rejectedRelationships: [],
      },
    });
    expect(storedProject.sources.filter((candidate) => candidate.id === source.id)).toHaveLength(1);
    expect(storedProject.historyEvents?.filter((event) => event.type === 'context_added')).toHaveLength(1);
  });

  it('records a failed completion while preserving the saved proposal', async () => {
    mocks.completeProjectRelationships.mockImplementation(async ({ projectAfter }: { projectAfter: Project }) => ({
      project: projectAfter,
      trace: {
        candidatePairs: [],
        classifications: [],
        acceptedRelationships: [],
        rejectedRelationships: [],
        error: 'Vertex AI unavailable.',
      },
    }));

    await persistAskProposal({
      userId: 'user-1',
      projectId: storedProject.id,
      assistantMessageId: 'assistant-1',
      proposal: proposal(),
    });

    const source = storedProject.sources.find((candidate) => candidate.id.startsWith('ask_proposal_'))!;
    expect(source.derived_node_ids).toEqual(['proposal-node']);
    expect(source.processing_log).toMatchObject({
      status: 'failed',
      error: 'Vertex AI unavailable.',
      stages: [{
        name: 'Relationship completion',
        status: 'failed',
        error: 'Vertex AI unavailable.',
        output: { error: 'Vertex AI unavailable.' },
      }],
    });
    expect(storedProject.nodes.some((candidate) => candidate.id === 'proposal-node')).toBe(true);
  });

  it('records a successful empty completion when no candidate pairs exist', async () => {
    mocks.completeProjectRelationships.mockImplementation(async ({ projectAfter }: { projectAfter: Project }) => ({
      project: projectAfter,
      trace: {
        candidatePairs: [],
        classifications: [],
        acceptedRelationships: [],
        rejectedRelationships: [],
      },
    }));

    await persistAskProposal({
      userId: 'user-1',
      projectId: storedProject.id,
      assistantMessageId: 'assistant-1',
      proposal: proposal(),
    });

    const source = storedProject.sources.find((candidate) => candidate.id.startsWith('ask_proposal_'))!;
    expect(source.processing_log?.stages[0]).toMatchObject({
      name: 'Relationship completion',
      status: 'completed',
      output: {
        candidatePairs: [],
        classifications: [],
        acceptedRelationships: [],
        rejectedRelationships: [],
      },
    });
  });

  it('keeps consecutive proposal diagnostics bounded instead of embedding prior logs', async () => {
    mocks.completeProjectRelationships.mockImplementation(async ({ projectAfter }: { projectAfter: Project }) => ({
      project: projectAfter,
      trace: {
        candidatePairs: [],
        classifications: [],
        acceptedRelationships: [],
        rejectedRelationships: [],
      },
    }));

    for (let index = 0; index < 6; index += 1) {
      await persistAskProposal({
        userId: 'user-1',
        projectId: storedProject.id,
        assistantMessageId: `assistant-${index}`,
        proposal: {
          ...proposal(),
          id: `proposal-${index}`,
          text: `A bounded proposal ${index} should remain useful.`,
        },
      });
    }

    const logs = storedProject.sources
      .map((source) => source.processing_log)
      .filter((log): log is NonNullable<typeof log> => Boolean(log));
    expect(logs).toHaveLength(6);
    expect(logs.every((log) => serializedProcessingLogSize(log) <= PROCESSING_LOG_MAX_BYTES)).toBe(true);
    expect(logs.every((log) => !log.input.project_snapshot.includes('processing_log'))).toBe(true);
    expect(Math.max(...logs.map((log) => log.input.project_snapshot.length))).toBeLessThan(10_000);
  });

  it('closes a satisfied action and writes exactly one action-completed event before saving', async () => {
    const question = node('question', 'UNKNOWN', 'Is the delivery date confirmed?', 'RESOLVED');
    const action = node('action', 'NEXT_ACTION', 'Ask the supplier to confirm the delivery date.');
    storedProject = projectWith(question, action);
    mocks.listProjects.mockImplementation(async () => [clone(storedProject)]);
    mocks.changedProjectNodeIds.mockReturnValue(['proposal-node']);
    mocks.completeProjectRelationships.mockImplementation(async ({ projectAfter }: { projectAfter: Project }) => ({
      project: {
        ...projectAfter,
        edges: [{
          id: 'satisfies-edge',
          source: action.id,
          target: question.id,
          type: 'satisfies',
          confidence: 0.95,
        }],
      },
      trace: {
        candidatePairs: [],
        classifications: [],
        acceptedRelationships: [],
        rejectedRelationships: [],
      },
    }));

    await persistAskProposal({
      userId: 'user-1',
      projectId: storedProject.id,
      assistantMessageId: 'assistant-1',
      proposal: proposal(),
    });

    expect(storedProject.nodes.find((candidate) => candidate.id === action.id)?.status).toBe('RESOLVED');
    expect(storedProject.historyEvents?.filter((event) => event.type === 'action_completed')).toHaveLength(1);
    expect(mocks.completeProjectRelationships.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.saveProject.mock.invocationCallOrder[0]);
  });
});
