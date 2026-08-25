import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import type { ClarityNode, EdgeType, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { getUnresolvedPrerequisites, isNodeBlocked, sequenceFocusAssessments } from '@/lib/focus/sequencing';

function node(id: string, type: ClarityNode['type'] = 'UNKNOWN', status: ClarityNode['status'] = 'OPEN'): ClarityNode {
  return {
    id,
    type,
    text: id,
    status,
    confidence: 0.8,
    impact: 0.8,
    source_refs: [],
    created_by: 'user',
    created_at: '2026-08-23T10:00:00.000Z',
    updated_at: '2026-08-23T10:00:00.000Z',
  };
}

function graph(nodes: ClarityNode[], edges: Array<{ source: string; target: string; type: EdgeType }>): Project {
  const project = createProjectFromInput({ name: 'Sequencing test', goal: 'Complete work in dependency order.' });
  project.nodes = nodes;
  project.edges = edges.map((edge, index) => ({ id: `edge_${index}`, ...edge }));
  return project;
}

function assessment(actionNodeId: string, score: number): FocusAssessment {
  return {
    kind: 'decision',
    title: actionNodeId,
    sourceNodeIds: [actionNodeId],
    sourceIds: [],
    representedNodeIds: [actionNodeId],
    actionNodeId,
    score,
    confidence: 0.8,
  };
}

describe('focus sequencing', () => {
  it('treats an open source of blocks as the prerequisite of its target', () => {
    const project = graph([node('A'), node('B', 'DECISION')], [{ source: 'A', target: 'B', type: 'blocks' }]);
    expect(getUnresolvedPrerequisites(project, 'B').map((item) => item.id)).toEqual(['A']);
    expect(isNodeBlocked(project, 'B')).toBe(true);
    expect(isNodeBlocked(project, 'A')).toBe(false);
  });

  it('treats the target of depends_on as the prerequisite of its source', () => {
    const project = graph([node('A'), node('B', 'DECISION')], [{ source: 'B', target: 'A', type: 'depends_on' }]);
    expect(getUnresolvedPrerequisites(project, 'B').map((item) => item.id)).toEqual(['A']);
    expect(isNodeBlocked(project, 'A')).toBe(false);
  });

  it('walks a multi-step dependency chain to the actionable leaf', () => {
    const project = graph(
      [node('A'), node('B', 'DECISION'), node('C', 'DECISION')],
      [
        { source: 'C', target: 'B', type: 'depends_on' },
        { source: 'B', target: 'A', type: 'depends_on' },
      ],
    );
    expect(getUnresolvedPrerequisites(project, 'C').map((item) => item.id)).toEqual(['A', 'B']);
    expect(isNodeBlocked(project, 'C')).toBe(true);
    expect(isNodeBlocked(project, 'B')).toBe(true);
    expect(isNodeBlocked(project, 'A')).toBe(false);
  });

  it('ignores resolved prerequisites', () => {
    const project = graph(
      [node('A', 'UNKNOWN', 'RESOLVED'), node('B', 'DECISION')],
      [{ source: 'B', target: 'A', type: 'depends_on' }],
    );
    expect(isNodeBlocked(project, 'B')).toBe(false);
  });

  it.each(['informs', 'affects'] as const)('does not treat %s as a blocking relationship', (type) => {
    const project = graph([node('A'), node('B', 'DECISION')], [{ source: 'A', target: 'B', type }]);
    expect(isNodeBlocked(project, 'B')).toBe(false);
  });

  it('terminates safely for a dependency cycle', () => {
    const project = graph(
      [node('A', 'DECISION'), node('B', 'DECISION')],
      [
        { source: 'A', target: 'B', type: 'depends_on' },
        { source: 'B', target: 'A', type: 'depends_on' },
      ],
    );
    expect(getUnresolvedPrerequisites(project, 'A').map((item) => item.id)).toEqual(['A', 'B']);
  });

  it('makes a higher-scoring blocked candidate ineligible so its represented prerequisite wins', () => {
    const project = graph(
      [node('cost'), node('pricing', 'DECISION')],
      [{ source: 'cost', target: 'pricing', type: 'blocks' }],
    );
    const sequenced = sequenceFocusAssessments(project, [
      assessment('pricing', 0.95),
      assessment('cost', 0.7),
    ]).sort((left, right) => right.score - left.score);

    expect(sequenced).toHaveLength(1);
    expect(sequenced[0]?.actionNodeId).toBe('cost');
    expect(sequenced[0]?.score).toBe(0.7);
  });

  it('promotes an actionable leaf prerequisite when it has no existing candidate', () => {
    const project = graph(
      [node('cost'), node('pricing', 'DECISION')],
      [{ source: 'pricing', target: 'cost', type: 'depends_on' }],
    );
    const sequenced = sequenceFocusAssessments(project, [assessment('pricing', 0.9)]);

    expect(sequenced).toHaveLength(1);
    expect(sequenced[0]).toMatchObject({ kind: 'question', title: 'cost', actionNodeId: 'cost' });
  });
});
