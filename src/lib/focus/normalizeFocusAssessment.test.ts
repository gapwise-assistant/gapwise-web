import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import type { ClarityNode, EdgeType, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { normalizeFocusAssessment } from '@/lib/focus/normalizeFocusAssessment';

function projectWithNodes(nodes: ClarityNode[], edges: Array<{ source: string; target: string; type: EdgeType }> = []): Project {
  const project = createProjectFromInput({ name: 'Focus normalization', goal: 'Move the project forward.' });
  project.nodes = nodes;
  project.edges = edges.map((edge, index) => ({ id: `edge_${index}`, ...edge }));
  return project;
}

function node(
  id: string,
  type: ClarityNode['type'],
  status: ClarityNode['status'] = 'OPEN',
): ClarityNode {
  return {
    id,
    type,
    text: id,
    status,
    confidence: 0.8,
    impact: 0.8,
    source_refs: [],
    created_by: 'agent',
    created_at: '2026-08-25T10:00:00.000Z',
    updated_at: '2026-08-25T10:00:00.000Z',
  };
}

function assessment(targetNodeId: string): FocusAssessment {
  return {
    kind: 'action',
    title: targetNodeId,
    sourceNodeIds: [],
    sourceIds: [],
    representedNodeIds: [],
    targetNodeId,
    actionNodeId: targetNodeId,
    score: 0.9,
    confidence: 0.8,
  };
}

describe('normalizeFocusAssessment', () => {
  it('separates an action investigating an unknown into target and execution', () => {
    const project = projectWithNodes(
      [node('question', 'UNKNOWN'), node('investigate', 'NEXT_ACTION')],
      [{ source: 'investigate', target: 'question', type: 'informs' }],
    );

    const normalized = normalizeFocusAssessment(project, assessment('investigate'));

    expect(normalized).toMatchObject({
      targetNodeId: 'question',
      executionNodeId: 'investigate',
      actionNodeId: 'question',
    });
    expect(normalized.representedNodeIds).toEqual(expect.arrayContaining(['question', 'investigate']));
  });

  it('separates an action preparing a decision into target and execution', () => {
    const project = projectWithNodes(
      [node('decision', 'DECISION'), node('prepare', 'NEXT_ACTION')],
      [{ source: 'prepare', target: 'decision', type: 'satisfies' }],
    );

    const normalized = normalizeFocusAssessment(project, assessment('prepare'));

    expect(normalized.targetNodeId).toBe('decision');
    expect(normalized.executionNodeId).toBe('prepare');
    expect(normalized.kind).toBe('decision');
  });

  it('keeps a standalone action as the target', () => {
    const project = projectWithNodes([node('action', 'NEXT_ACTION')]);

    const normalized = normalizeFocusAssessment(project, assessment('action'));

    expect(normalized.targetNodeId).toBe('action');
    expect(normalized.executionNodeId).toBeUndefined();
    expect(normalized.kind).toBe('action');
  });

  it('redirects a blocked decision to its unresolved prerequisite', () => {
    const project = projectWithNodes(
      [node('decision', 'DECISION'), node('prerequisite', 'UNKNOWN')],
      [{ source: 'decision', target: 'prerequisite', type: 'depends_on' }],
    );

    const normalized = normalizeFocusAssessment(project, assessment('decision'));

    expect(normalized.targetNodeId).toBe('prerequisite');
    expect(normalized.actionNodeId).toBe('prerequisite');
  });

  it('does not redirect a decision to merely informative evidence', () => {
    const project = projectWithNodes(
      [node('decision', 'DECISION'), node('evidence', 'EVIDENCE')],
      [{ source: 'evidence', target: 'decision', type: 'informs' }],
    );

    const normalized = normalizeFocusAssessment(project, assessment('decision'));

    expect(normalized.targetNodeId).toBe('decision');
    expect(normalized.representedNodeIds).not.toContain('evidence');
  });

  it('does not choose arbitrarily when an action points to multiple outcomes', () => {
    const project = projectWithNodes(
      [node('question_a', 'UNKNOWN'), node('question_b', 'UNKNOWN'), node('action', 'NEXT_ACTION')],
      [
        { source: 'action', target: 'question_a', type: 'satisfies' },
        { source: 'action', target: 'question_b', type: 'satisfies' },
      ],
    );

    const normalized = normalizeFocusAssessment(project, assessment('action'));

    expect(normalized.targetNodeId).toBe('action');
    expect(normalized.executionNodeId).toBeUndefined();
  });
});
