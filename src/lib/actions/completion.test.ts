import { describe, expect, it } from 'vitest';
import { generateAttentionCandidates } from '@/lib/attention/candidates';
import { isNextActionSatisfied, resolveSatisfiedNextActions } from '@/lib/actions/completion';
import type { ClarityEdge, ClarityNode, NodeType, Project } from '@/types/clarity';

const now = '2026-08-23T12:00:00.000Z';

function node(id: string, type: NodeType, text: string, status: ClarityNode['status']): ClarityNode {
  return {
    id,
    type,
    text,
    status,
    confidence: 0.9,
    impact: 0.8,
    source_refs: [],
    created_by: 'user',
    created_at: now,
    updated_at: now,
  };
}

function project(nodes: ClarityNode[], edges: ClarityEdge[] = []): Project {
  return {
    id: 'workshop',
    title: 'Launch a paid cooking workshop',
    goal: 'Launch the first paid workshop',
    clarity_score: 50,
    nodes,
    edges,
    sources: [],
    history: [],
    created_at: now,
    updated_at: now,
  };
}

describe('NEXT_ACTION completion', () => {
  it('closes an action whose intended outcome is already resolved', () => {
    const venue = node('venue', 'DECISION', 'Use Riverside Kitchen.', 'RESOLVED');
    const action = node('venue-action', 'NEXT_ACTION', 'Decide which venue model to use.', 'OPEN');
    const graph = project([venue, action], [
      { id: 'edge', source: action.id, target: venue.id, type: 'satisfies' },
    ]);

    expect(isNextActionSatisfied(graph, action)).toBe(true);
    expect(resolveSatisfiedNextActions(graph, '2026-08-23T13:00:00.000Z')).toEqual([action.id]);
    expect(action.status).toBe('RESOLVED');
    expect(action.updated_at).toBe('2026-08-23T13:00:00.000Z');
  });

  it('keeps an action open when an informational target is resolved', () => {
    const venue = node('venue', 'DECISION', 'Use Riverside Kitchen.', 'RESOLVED');
    const action = node('venue-action', 'NEXT_ACTION', 'Ask the venue for final details.', 'OPEN');
    const graph = project([venue, action], [
      { id: 'edge', source: action.id, target: venue.id, type: 'informs' },
    ]);

    expect(isNextActionSatisfied(graph, action)).toBe(false);
    expect(resolveSatisfiedNextActions(graph, '2026-08-23T13:00:00.000Z')).toEqual([]);
    expect(action.status).toBe('OPEN');
  });

  it('does not treat a blocking relationship as completed work', () => {
    const venue = node('venue', 'DECISION', 'Use Riverside Kitchen.', 'RESOLVED');
    const action = node('venue-action', 'NEXT_ACTION', 'Book the selected venue.', 'OPEN');
    const graph = project([venue, action], [
      { id: 'edge', source: action.id, target: venue.id, type: 'blocks' },
    ]);

    expect(isNextActionSatisfied(graph, action)).toBe(false);
  });

  it('does not complete an action from an invalid satisfies target', () => {
    const constraint = node('constraint', 'CONSTRAINT', 'The budget is fixed.', 'RESOLVED');
    const action = node('book', 'NEXT_ACTION', 'Book the venue.', 'OPEN');
    const graph = project([constraint, action], [
      { id: 'edge', source: action.id, target: constraint.id, type: 'satisfies' },
    ]);

    expect(isNextActionSatisfied(graph, action)).toBe(false);
    expect(resolveSatisfiedNextActions(graph, '2026-08-23T13:00:00.000Z')).toEqual([]);
    expect(action.status).toBe('OPEN');
  });

  it('does not use similar wording without an explicit graph relationship', () => {
    const venue = node('venue', 'DECISION', 'The venue model is Riverside Kitchen.', 'RESOLVED');
    const action = node('venue-action', 'NEXT_ACTION', 'Decide which venue model to use.', 'OPEN');
    expect(isNextActionSatisfied(project([venue, action]), action)).toBe(false);
  });

  it('does not complete an action merely because its prerequisite is resolved', () => {
    const prerequisite = node('permit', 'UNKNOWN', 'Is the permit approved?', 'RESOLVED');
    const action = node('book', 'NEXT_ACTION', 'Book the venue.', 'OPEN');
    const graph = project([prerequisite, action], [
      { id: 'edge', source: action.id, target: prerequisite.id, type: 'depends_on' },
    ]);

    expect(isNextActionSatisfied(graph, action)).toBe(false);
  });

  it('does not complete an action when a resolved prerequisite points to it', () => {
    const prerequisite = node('permit', 'UNKNOWN', 'Is the permit approved?', 'RESOLVED');
    const action = node('book', 'NEXT_ACTION', 'Book the venue.', 'OPEN');
    const graph = project([prerequisite, action], [
      { id: 'edge', source: prerequisite.id, target: action.id, type: 'depends_on' },
    ]);

    expect(isNextActionSatisfied(graph, action)).toBe(false);
    expect(resolveSatisfiedNextActions(graph, '2026-08-23T13:00:00.000Z')).toEqual([]);
    expect(action.status).toBe('OPEN');
  });

  it('excludes a stale linked action from Attention candidates', () => {
    const venue = node('venue', 'DECISION', 'Use Riverside Kitchen.', 'RESOLVED');
    const action = node('venue-action', 'NEXT_ACTION', 'Decide which venue model to use.', 'OPEN');
    const pricing = node('pricing', 'DECISION', 'Determine the ticket price.', 'OPEN');
    const graph = project([venue, action, pricing], [
      { id: 'edge', source: action.id, target: venue.id, type: 'satisfies' },
    ]);

    const candidates = generateAttentionCandidates({
      userId: 'user',
      project: graph,
      memories: [],
      now: new Date(now),
    });

    expect(candidates.some((candidate) => candidate.action_node_id === action.id)).toBe(false);
    expect(candidates.some((candidate) => candidate.action_node_id === pricing.id)).toBe(true);
  });
});
