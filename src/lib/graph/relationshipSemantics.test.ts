import { describe, expect, it } from 'vitest';
import type { ClarityNode, Project } from '@/types/clarity';
import {
  allowedRelationshipTypes,
  completionAllowedRelationshipTypes,
  relationshipAddsDistinctMeaning,
  relationshipRoleCompatible,
  removeSupersededRelationships,
  writeSemanticEdge,
} from '@/lib/graph/relationshipSemantics';
import { resolveSatisfiedNextActions } from '@/lib/actions/completion';

function node(id: string, type: ClarityNode['type'], text: string, status: ClarityNode['status']): ClarityNode {
  return {
    id,
    type,
    text,
    status,
    confidence: 0.9,
    impact: 0.8,
    source_refs: [],
    created_by: 'agent',
    created_at: '2026-08-20T09:00:00.000Z',
    updated_at: '2026-08-20T09:00:00.000Z',
  };
}

describe('relationship semantics', () => {
  it('keeps resolves strict and separates it from future action intent', () => {
    const decision = node('decision', 'DECISION', 'Choose the workshop format.', 'OPEN');
    const action = node('action', 'NEXT_ACTION', 'Run the pilot.', 'OPEN');
    const pending = node('pending', 'EVIDENCE', 'The pilot has not been run yet.', 'RESOLVED');
    const result = node('result', 'EVIDENCE', 'The completed pilot confirmed the small-group format worked.', 'RESOLVED');

    expect(relationshipRoleCompatible(action, decision, 'resolves')).toBe(false);
    expect(relationshipRoleCompatible(pending, decision, 'resolves')).toBe(false);
    expect(relationshipRoleCompatible(result, decision, 'resolves')).toBe(true);
    expect(relationshipRoleCompatible(action, decision, 'satisfies')).toBe(true);
  });

  it('does not let pending evidence resolve an outcome just because it is stored as resolved', () => {
    const pending = node('pending', 'EVIDENCE', 'I have not tested the corrected configuration yet.', 'RESOLVED');
    const question = node('question', 'UNKNOWN', 'Did the corrected configuration work?', 'OPEN');

    expect(relationshipRoleCompatible(pending, question, 'resolves')).toBe(false);
    expect(allowedRelationshipTypes(pending, question)).not.toContain('resolves');
  });

  it('does not let a preference resolve a decision', () => {
    const preference = node('preference', 'PREFERENCE', 'I would rather keep the first option.', 'RESOLVED');
    preference.created_by = 'user';
    const decision = node('decision', 'DECISION', 'Choose between the available options.', 'OPEN');

    expect(relationshipRoleCompatible(preference, decision, 'resolves')).toBe(false);
  });

  it('offers future satisfaction only for an unresolved outcome', () => {
    const action = node('action', 'NEXT_ACTION', 'Confirm the selected option.', 'OPEN');
    const openDecision = node('open-decision', 'DECISION', 'Choose the selected option.', 'OPEN');
    const resolvedDecision = node('resolved-decision', 'DECISION', 'Choose the selected option.', 'RESOLVED');

    expect(completionAllowedRelationshipTypes(action, openDecision)).toContain('satisfies');
    expect(completionAllowedRelationshipTypes(action, resolvedDecision)).not.toContain('satisfies');
  });

  it('allows a completed decision outcome to resolve an existing factual gap', () => {
    const decision = node('decision', 'DECISION', 'Use the smaller format.', 'RESOLVED');
    const question = node('question', 'UNKNOWN', 'Which format was selected?', 'OPEN');

    expect(relationshipRoleCompatible(decision, question, 'resolves')).toBe(true);
  });

  it('does not treat fixed context as a blockable or prerequisite outcome', () => {
    const action = node('action', 'NEXT_ACTION', 'Choose a venue.', 'OPEN');
    const constraint = node('constraint', 'CONSTRAINT', 'The budget cannot exceed 500.', 'RESOLVED');
    const decision = node('decision', 'DECISION', 'Choose a venue.', 'OPEN');
    const goal = node('goal', 'GOAL', 'Run the workshop.', 'OPEN');

    expect(relationshipRoleCompatible(action, constraint, 'blocks')).toBe(false);
    expect(relationshipRoleCompatible(action, constraint, 'depends_on')).toBe(false);
    expect(relationshipRoleCompatible(decision, goal, 'depends_on')).toBe(false);
    expect(allowedRelationshipTypes(action, constraint)).not.toContain('satisfies');
    expect(allowedRelationshipTypes(action, decision)).toContain('satisfies');
  });

  it('keeps completion choices narrow and excludes provenance/support guesses', () => {
    const evidence = node('evidence', 'EVIDENCE', 'The option requires two weeks and costs 400.', 'RESOLVED');
    const decision = node('decision', 'DECISION', 'Choose between the available options.', 'OPEN');
    const goal = node('goal', 'GOAL', 'Deliver the project.', 'OPEN');
    const action = node('action', 'NEXT_ACTION', 'Confirm the selected option.', 'OPEN');
    const question = node('question', 'UNKNOWN', 'Is the selected option available?', 'OPEN');

    expect(completionAllowedRelationshipTypes(evidence, decision)).toEqual(['informs']);
    expect(completionAllowedRelationshipTypes(evidence, goal)).toEqual([]);
    expect(completionAllowedRelationshipTypes(action, question)).toEqual(['informs', 'satisfies', 'affects']);
    expect(completionAllowedRelationshipTypes(decision, goal)).toEqual(['affects']);
  });

  it('rejects a generic affects edge when a precise prerequisite already exists', () => {
    expect(relationshipAddsDistinctMeaning([
      { id: 'edge-1', source: 'a', target: 'b', type: 'depends_on' },
    ], {
      source: 'a',
      target: 'b',
      type: 'affects',
    })).toBe(false);

    expect(relationshipAddsDistinctMeaning([], {
      source: 'a',
      target: 'b',
      type: 'affects',
    })).toBe(true);
  });

  it('treats inverse blocking and dependency edges as one relationship', () => {
    expect(relationshipAddsDistinctMeaning([
      { id: 'edge-1', source: 'blocker', target: 'blocked', type: 'blocks' },
    ], {
      source: 'blocked',
      target: 'blocker',
      type: 'depends_on',
    })).toBe(false);

    expect(relationshipAddsDistinctMeaning([
      { id: 'edge-1', source: 'blocked', target: 'blocker', type: 'depends_on' },
    ], {
      source: 'blocker',
      target: 'blocked',
      type: 'blocks',
    })).toBe(false);
  });

  it('keeps the stronger same-direction relationship and removes the weaker edge when it arrives later', () => {
    const edges = [{
      id: 'edge-1',
      source: 'risk',
      target: 'decision',
      type: 'affects' as const,
      confidence: 0.8,
    }];
    const candidate = {
      source: 'risk',
      target: 'decision',
      type: 'blocks' as const,
      confidence: 0.9,
    };

    expect(relationshipAddsDistinctMeaning(edges, candidate)).toBe(true);
    removeSupersededRelationships(edges, candidate);
    expect(edges).toEqual([]);
  });

  it('keeps only the stronger direction for reciprocal generic edges', () => {
    const edges = [{
      id: 'edge-1',
      source: 'evidence-b',
      target: 'decision-a',
      type: 'informs' as const,
      confidence: 0.7,
    }];

    expect(relationshipAddsDistinctMeaning(edges, {
      source: 'decision-a',
      target: 'evidence-b',
      type: 'informs',
      confidence: 0.6,
    })).toBe(false);

    const stronger = {
      source: 'decision-a',
      target: 'evidence-b',
      type: 'informs' as const,
      confidence: 0.9,
    };
    expect(relationshipAddsDistinctMeaning(edges, stronger)).toBe(true);
    removeSupersededRelationships(edges, stronger);
    expect(edges).toEqual([]);
  });

  it('rejects reciprocal support loops', () => {
    const edges = [{
      id: 'edge-1',
      source: 'evidence-a',
      target: 'evidence-b',
      type: 'supports' as const,
      confidence: 1,
    }];

    expect(relationshipAddsDistinctMeaning(edges, {
      source: 'evidence-b',
      target: 'evidence-a',
      type: 'supports',
      confidence: 1,
    })).toBe(false);
  });

  it('writes semantic edges through the shared dedupe and supersession rules', () => {
    const risk = node('risk', 'RISK', 'The schedule may slip.', 'OPEN');
    const decision = node('decision', 'DECISION', 'Choose the launch date.', 'OPEN');
    const project = {
      nodes: [risk, decision],
      edges: [{
        id: 'edge-generic',
        source: 'risk',
        target: 'decision',
        type: 'affects' as const,
        confidence: 0.7,
      }],
    } as Project;

    const persisted = writeSemanticEdge(project, {
      source: 'risk',
      target: 'decision',
      type: 'blocks',
      confidence: 0.9,
    });

    expect(persisted).toMatchObject({
      source: 'risk',
      target: 'decision',
      type: 'blocks',
      confidence: 0.9,
    });
    expect(project.edges).toHaveLength(1);
    expect(writeSemanticEdge(project, {
      source: 'risk',
      target: 'decision',
      type: 'blocks',
      confidence: 0.9,
    })).toBeUndefined();
  });

  it('rejects missing endpoints and role-incompatible edges on the shared write path', () => {
    const action = node('action', 'NEXT_ACTION', 'Book the selected venue.', 'OPEN');
    const constraint = node('constraint', 'CONSTRAINT', 'The budget is fixed.', 'RESOLVED');
    const project = { nodes: [action, constraint], edges: [] } as unknown as Project;

    expect(writeSemanticEdge(project, {
      source: 'missing', target: constraint.id, type: 'informs', confidence: 0.9,
    })).toBeUndefined();
    expect(writeSemanticEdge(project, {
      source: action.id, target: constraint.id, type: 'resolves', confidence: 0.9,
    })).toBeUndefined();
    expect(project.edges).toEqual([]);
  });

  it('resolves the target when a conclusive outcome edge is written', () => {
    const evidence = node('evidence', 'EVIDENCE', 'The corrected request returned 201 and created the expected record.', 'RESOLVED');
    const question = node('question', 'UNKNOWN', 'Does the corrected request resolve the failure?', 'OPEN');
    const project = { nodes: [evidence, question], edges: [] } as unknown as Project;

    expect(writeSemanticEdge(project, {
      source: evidence.id,
      target: question.id,
      type: 'resolves',
      confidence: 0.95,
    })).toBeDefined();
    expect(question.status).toBe('RESOLVED');
  });

  it('closes only the action explicitly satisfied by a newly resolved outcome', () => {
    const evidence = node('evidence', 'EVIDENCE', 'The review confirmed the configuration is valid.', 'RESOLVED');
    const question = node('question', 'UNKNOWN', 'Is the configuration valid?', 'OPEN');
    const action = node('action', 'NEXT_ACTION', 'Obtain confirmation of the configuration.', 'OPEN');
    const project = {
      nodes: [evidence, question, action],
      edges: [{ id: 'satisfies', source: action.id, target: question.id, type: 'satisfies' as const }],
    } as unknown as Project;

    writeSemanticEdge(project, {
      source: evidence.id,
      target: question.id,
      type: 'resolves',
      confidence: 0.95,
    });

    expect(question.status).toBe('RESOLVED');
    expect(resolveSatisfiedNextActions(project, '2026-08-23T13:00:00.000Z')).toEqual([action.id]);
    expect(action.status).toBe('RESOLVED');
  });
});
