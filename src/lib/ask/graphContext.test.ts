import { describe, expect, it } from 'vitest';
import type { ClarityNode, Project } from '@/types/clarity';
import { buildAskGraphContext } from './graphContext';

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
    created_at: '2026-08-24T10:00:00Z',
    updated_at: '2026-08-24T10:00:00Z',
  };
}

function projectWithGraph(): Project {
  const nodes = [
    node('goal', 'GOAL', 'Deliver the pilot before the launch date.'),
    node('question', 'UNKNOWN', 'Will the supplier deliver the required package by Friday?'),
    node('policy', 'CONSTRAINT', 'The package must meet the supplier review policy.', 'RESOLVED'),
    node('risk', 'RISK', 'A supplier delay could threaten the launch date.', 'OPEN'),
    node('action', 'NEXT_ACTION', 'Confirm the supplier delivery date.', 'OPEN'),
    node('unrelated', 'KNOWN', 'The team prefers a short weekly meeting.', 'RESOLVED'),
  ];

  return {
    id: 'project_graph_test',
    title: 'Graph test',
    goal: 'Deliver the pilot before the launch date.',
    clarity_score: 50,
    nodes,
    edges: [
      { id: 'edge_policy_question', source: 'policy', target: 'question', type: 'informs', confidence: 0.9 },
      { id: 'edge_question_risk', source: 'question', target: 'risk', type: 'affects', confidence: 0.8 },
      { id: 'edge_action_question', source: 'action', target: 'question', type: 'satisfies', confidence: 0.8 },
    ],
    sources: [],
    history: [],
    created_at: '2026-08-24T10:00:00Z',
    updated_at: '2026-08-24T10:00:00Z',
  };
}

describe('Ask graph context', () => {
  it('selects a bounded relevant slice and preserves edge direction', () => {
    const context = buildAskGraphContext(
      projectWithGraph(),
      'What happens if the supplier misses Friday, and what would that put at risk?',
    );

    expect(context.nodes.length).toBeLessThanOrEqual(16);
    expect(context.startingNodeIds).toContain('question');
    expect(context.nodes.map((item) => item.id)).toContain('risk');
    expect(context.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'question',
        target: 'risk',
        type: 'affects',
      }),
    ]));
    expect(context.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'risk',
        target: 'question',
        type: 'affects',
      }),
    ]));
  });

  it('does not select unrelated nodes just because they are in the project', () => {
    const context = buildAskGraphContext(
      projectWithGraph(),
      'What policy affects the supplier delivery question?',
    );

    expect(context.nodes.map((item) => item.id)).not.toContain('unrelated');
  });
});

