import { describe, expect, it } from 'vitest';
import type { ClarityNode, Project } from '@/types/clarity';
import {
  candidateNodeIdsForJourneyAnchor,
  createJourneyAnchorBook,
  hasJourneyActionCompletionHistory,
  hasJourneyOutcomeHistory,
  inspectJourneyAnchor,
  journeyAnchorHasOutcome,
  journeyAnchorDiagnostics,
  recordControlledJourneyAnchor,
  recordJourneyActionCompletionHistory,
  recordJourneyAnchor,
} from '@/lib/demo/journeyAnchors';
import { resolveSatisfiedNextActions } from '@/lib/actions/completion';

function projectWithNodes(nodes: ClarityNode[], edges: Project['edges'] = []): Project {
  return {
    id: 'project-demo',
    title: 'Demo',
    goal: 'Test a project journey.',
    deadline: '2026-10-01',
    clarity_score: 0,
    active_question: null,
    nodes,
    edges,
    sources: [],
    history: [],
    historyEvents: [],
    created_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
  };
}

function node(id: string, type: ClarityNode['type'], status: ClarityNode['status'] = 'OPEN'): ClarityNode {
  return {
    id,
    type,
    text: `${type} ${id}`,
    status,
    confidence: 0.9,
    impact: 0.8,
    source_refs: [],
    created_by: 'agent',
    created_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
  };
}

describe('demo journey anchors', () => {
  it('records and locks a canonical ID without depending on the node type', () => {
    const before = projectWithNodes([]);
    const after = projectWithNodes([node('delivery-transition', 'NEXT_ACTION')]);
    const anchors = createJourneyAnchorBook();
    recordJourneyAnchor(anchors, {
      key: 'delivery',
      project: after,
      candidateNodeIds: candidateNodeIdsForJourneyAnchor(before, after),
      actionNodeId: 'delivery-transition',
    });

    const inspection = inspectJourneyAnchor(anchors, 'delivery', after);

    expect(inspection.node?.id).toBe('delivery-transition');
    expect(anchors.get('delivery')?.actionNodeId).toBe('delivery-transition');
  });

  it('prefers a resolved actionable outcome over an unfinished action from the same transition', () => {
    const resolved = node('resolved-outcome', 'DECISION', 'RESOLVED');
    const action = node('unfinished-action', 'NEXT_ACTION', 'OPEN');
    const project = projectWithNodes([resolved, action], [{
      id: 'edge-1',
      source: action.id,
      target: resolved.id,
      type: 'satisfies',
    }]);
    const anchors = createJourneyAnchorBook();
    recordJourneyAnchor(anchors, { key: 'transition', project, candidateNodeIds: [action.id, resolved.id], actionNodeId: resolved.id });

    const inspection = inspectJourneyAnchor(anchors, 'transition', project);

    expect(inspection.node?.id).toBe(resolved.id);
    expect(inspection.explicitOutcomeNodeIds).toContain(resolved.id);
    expect(journeyAnchorHasOutcome(inspection)).toBe(true);
  });

  it('recognizes an open action whose explicit satisfies target is resolved', () => {
    const action = node('action', 'NEXT_ACTION', 'OPEN');
    const outcome = node('outcome', 'UNKNOWN', 'RESOLVED');
    const project = projectWithNodes([action, outcome], [{
      id: 'edge-1',
      source: action.id,
      target: outcome.id,
      type: 'satisfies',
    }]);
    const anchors = createJourneyAnchorBook();
    recordJourneyAnchor(anchors, { key: 'transition', project, candidateNodeIds: [action.id, outcome.id], actionNodeId: action.id });

    const inspection = inspectJourneyAnchor(anchors, 'transition', project);

    expect(inspection.node?.id).toBe(action.id);
    expect(journeyAnchorHasOutcome(inspection)).toBe(true);
  });

  it('does not treat non-actionable supporting facts as a resolved transition', () => {
    const project = projectWithNodes([node('supporting-fact', 'KNOWN', 'RESOLVED')]);
    const anchors = createJourneyAnchorBook();
    recordJourneyAnchor(anchors, { key: 'transition', project, candidateNodeIds: ['supporting-fact'] });

    const inspection = inspectJourneyAnchor(anchors, 'transition', project);

    expect(inspection.node).toBeUndefined();
    expect(inspection.status).toBe('not_actionable');
  });

  it('reports ambiguous actionable candidates rather than choosing by order', () => {
    const project = projectWithNodes([
      node('one', 'UNKNOWN'),
      node('two', 'DECISION'),
    ]);
    const anchors = createJourneyAnchorBook();
    recordJourneyAnchor(anchors, { key: 'transition', project, candidateNodeIds: ['one', 'two'] });

    const inspection = inspectJourneyAnchor(anchors, 'transition', project);

    expect(inspection.node).toBeUndefined();
    expect(inspection.status).toBe('ambiguous');
    expect(journeyAnchorDiagnostics(inspection)).toContain('one');
  });

  it('records the canonical node linked by a controlled source without selecting an unrelated candidate', () => {
    const before = projectWithNodes([]);
    const canonical = node('canonical', 'DECISION');
    const extractedAlias = {
      ...node('extracted-alias', 'DECISION'),
      canonical_node_id: canonical.id,
    };
    const unrelatedResolved = node('unrelated-resolved', 'DECISION', 'RESOLVED');
    const after = projectWithNodes([canonical, extractedAlias, unrelatedResolved]);
    after.sources = [{
      id: 'controlled-source',
      filename: 'controlled.txt',
      type: 'note',
      content: 'controlled transition',
      extracted_at: '2026-08-27T00:00:00.000Z',
      derived_node_ids: [extractedAlias.id],
    }];
    const anchors = createJourneyAnchorBook();

    recordControlledJourneyAnchor(anchors, {
      key: 'controlled',
      before,
      after,
      sourceId: 'controlled-source',
    });

    const inspection = inspectJourneyAnchor(anchors, 'controlled', after);

    expect(anchors.get('controlled')?.actionNodeId).toBe(canonical.id);
    expect(inspection.node?.id).toBe(canonical.id);
    expect(inspection.node?.id).not.toBe(unrelatedResolved.id);
  });

  it('records one action-completed event after an explicit satisfies outcome', () => {
    const action = node('action', 'NEXT_ACTION');
    const outcome = node('outcome', 'UNKNOWN', 'RESOLVED');
    const project = projectWithNodes([action, outcome], [{
      id: 'satisfies-edge',
      source: action.id,
      target: outcome.id,
      type: 'satisfies',
    }]);

    expect(resolveSatisfiedNextActions(project, '2026-08-27T01:00:00.000Z')).toEqual([action.id]);
    expect(recordJourneyActionCompletionHistory(project, action.id, '2026-08-27T01:00:00.000Z')).toBe(true);
    expect(recordJourneyActionCompletionHistory(project, action.id, '2026-08-27T01:00:00.000Z')).toBe(false);
    expect(project.historyEvents?.filter((event) => event.type === 'action_completed')).toHaveLength(1);
    expect(hasJourneyActionCompletionHistory(project, action.id)).toBe(true);
  });

  it('recognizes a resolution history event by the anchored node ID', () => {
    const project = projectWithNodes([node('outcome', 'UNKNOWN', 'RESOLVED')]);
    project.historyEvents = [{
      id: 'gap-event',
      projectId: project.id,
      createdAt: '2026-08-27T00:00:00.000Z',
      type: 'gap_resolved',
      title: 'Question resolved',
      primaryNodeId: 'outcome',
    }];

    expect(hasJourneyOutcomeHistory(project, 'outcome')).toBe(true);
    expect(hasJourneyOutcomeHistory(project, 'other')).toBe(false);
  });
});
