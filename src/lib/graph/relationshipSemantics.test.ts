import { describe, expect, it } from 'vitest';
import type { ClarityNode } from '@/types/clarity';
import {
  allowedRelationshipTypes,
  relationshipAddsDistinctMeaning,
  relationshipRoleCompatible,
} from '@/lib/graph/relationshipSemantics';

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
});
