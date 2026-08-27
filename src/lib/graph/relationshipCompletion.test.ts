import { describe, expect, it, vi } from 'vitest';
import type { ClarityNode, Project } from '@/types/clarity';
import {
  buildRelationshipCompletionPairs,
  completeProjectRelationships,
} from '@/lib/graph/relationshipCompletion';
import { resolveSatisfiedNextActions } from '@/lib/actions/completion';

const now = '2026-08-26T12:00:00.000Z';

function node(
  id: string,
  type: ClarityNode['type'],
  text: string,
  status: ClarityNode['status'],
): ClarityNode {
  return {
    id,
    type,
    text,
    status,
    confidence: 0.9,
    impact: 0.85,
    source_refs: [],
    created_by: 'agent',
    created_at: now,
    updated_at: now,
  };
}

function project(nodes: ClarityNode[]): Project {
  return {
    id: 'relationship-completion-test',
    title: 'Relationship completion test',
    goal: 'Select and launch a workable option.',
    clarity_score: 50,
    nodes,
    edges: [],
    sources: [],
    history: [],
    created_at: now,
    updated_at: now,
  };
}

function mockGenAI(classifications: unknown[]) {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify({ classifications }),
        modelVersion: 'relationship-test-model',
      }),
    },
  } as any;
}

describe('canonical relationship completion', () => {
  it('lets supplied evidence inform an open decision', async () => {
    const decision = node('decision', 'DECISION', 'Choose the delivery option.', 'OPEN');
    const before = project([node('goal', 'GOAL', 'Select and launch a workable option.', 'OPEN'), decision]);
    const evidence = node('duration', 'EVIDENCE', 'The delivery option requires two weeks and costs 400.', 'RESOLVED');
    const after = project([...before.nodes, evidence]);
    const pairs = buildRelationshipCompletionPairs(after, [evidence.id], 'The delivery option requires two weeks and costs 400.');
    const pair = pairs.find((candidate) => candidate.sourceNodeId === evidence.id && candidate.targetNodeId === decision.id);
    expect(pair?.allowedTypes).toContain('informs');
    const genAI = mockGenAI([{ pair_id: pair!.pairId, relationship: 'informs', confidence: 0.93 }]);

    const result = await completeProjectRelationships({
      projectBefore: before,
      projectAfter: after,
      changedNodeIds: [evidence.id],
      source: { id: 'source-1', filename: 'source.txt', content: 'The delivery option requires two weeks and costs 400.' },
      genAI,
    });

    expect(result.project.edges).toEqual([
      expect.objectContaining({ source: evidence.id, target: decision.id, type: 'informs' }),
    ]);
    expect(result.trace.acceptedRelationships).toEqual([
      expect.objectContaining({ sourceNodeId: evidence.id, targetNodeId: decision.id, type: 'informs' }),
    ]);
  });

  it('lets an unresolved prerequisite block a downstream decision', async () => {
    const decision = node('decision', 'DECISION', 'Choose the launch option.', 'OPEN');
    const unknown = node('availability', 'UNKNOWN', 'Is the launch option available?', 'OPEN');
    const before = project([node('goal', 'GOAL', 'Select and launch a workable option.', 'OPEN'), decision]);
    const after = project([...before.nodes, unknown]);
    const pairs = buildRelationshipCompletionPairs(after, [unknown.id], 'The launch option availability is still unknown.');
    const pair = pairs.find((candidate) => candidate.sourceNodeId === unknown.id && candidate.targetNodeId === decision.id);
    expect(pair?.allowedTypes).toContain('blocks');
    const result = await completeProjectRelationships({
      projectBefore: before,
      projectAfter: after,
      changedNodeIds: [unknown.id],
      source: { id: 'source-2', filename: 'source.txt', content: 'The launch option availability is still unknown.' },
      genAI: mockGenAI([{ pair_id: pair!.pairId, relationship: 'blocks', confidence: 0.91 }]),
    });

    expect(result.project.edges).toEqual([
      expect.objectContaining({ source: unknown.id, target: decision.id, type: 'blocks' }),
    ]);
  });

  it('uses satisfies for an action intended to settle a question and propagates completion', async () => {
    const question = node('question', 'UNKNOWN', 'Is the launch option available?', 'OPEN');
    const action = node('action', 'NEXT_ACTION', 'Ask the provider to confirm launch availability.', 'OPEN');
    const before = project([node('goal', 'GOAL', 'Select and launch a workable option.', 'OPEN'), question, action]);
    const after = project([...before.nodes]);
    const pairs = buildRelationshipCompletionPairs(after, [action.id], 'Ask the provider to confirm launch availability.');
    const pair = pairs.find((candidate) => candidate.sourceNodeId === action.id && candidate.targetNodeId === question.id);
    expect(pair?.allowedTypes).toContain('satisfies');
    const result = await completeProjectRelationships({
      projectBefore: before,
      projectAfter: after,
      changedNodeIds: [action.id],
      source: { id: 'source-3', filename: 'source.txt', content: 'Ask the provider to confirm launch availability.' },
      genAI: mockGenAI([{ pair_id: pair!.pairId, relationship: 'satisfies', confidence: 0.94 }]),
    });

    const resolvedQuestion = result.project.nodes.find((candidate) => candidate.id === question.id)!;
    resolvedQuestion.status = 'RESOLVED';
    expect(resolveSatisfiedNextActions(result.project, now)).toEqual([action.id]);
    expect(result.project.nodes.find((candidate) => candidate.id === action.id)?.status).toBe('RESOLVED');
  });

  it('does not invent an edge for a pair the model marks NONE', async () => {
    const decision = node('decision', 'DECISION', 'Choose the launch option.', 'OPEN');
    const evidence = node('unrelated', 'EVIDENCE', 'The team has a shared calendar.', 'RESOLVED');
    const before = project([node('goal', 'GOAL', 'Select and launch a workable option.', 'OPEN'), decision]);
    const after = project([...before.nodes, evidence]);
    const pairs = buildRelationshipCompletionPairs(after, [evidence.id], 'The team has a shared calendar.');
    const pair = pairs.find((candidate) => candidate.sourceNodeId === evidence.id && candidate.targetNodeId === decision.id);
    expect(pair).toBeDefined();
    const result = await completeProjectRelationships({
      projectBefore: before,
      projectAfter: after,
      changedNodeIds: [evidence.id],
      source: { id: 'source-4', filename: 'source.txt', content: 'The team has a shared calendar.' },
      genAI: mockGenAI([{ pair_id: pair!.pairId, relationship: 'NONE', confidence: 0.99 }]),
    });

    expect(result.project.edges).toEqual([]);
    expect(result.trace.classifications).toEqual([
      expect.objectContaining({ pair_id: pair!.pairId, relationship: 'NONE' }),
    ]);
  });

  it('keeps completion attached when reconciliation projects a changed question alias to its canonical node', () => {
    const question = node('question', 'UNKNOWN', 'Is the launch option available?', 'OPEN');
    const alias = {
      ...question,
      id: 'question-alias',
      canonical_question_id: question.id,
      text: 'Can the launch option be booked?',
    };
    const decision = node('decision', 'DECISION', 'Choose the launch option.', 'OPEN');
    const graph = project([node('goal', 'GOAL', 'Select and launch a workable option.', 'OPEN'), question, alias, decision]);

    const pairs = buildRelationshipCompletionPairs(
      graph,
      [alias.id],
      'Can the launch option be booked?',
    );

    expect(pairs.some((pair) =>
      pair.sourceNodeId === question.id && pair.targetNodeId === decision.id,
    )).toBe(true);
  });
});
