import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { applyProjectPatch } from '@/lib/context/canonicalChanges';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

describe('ProjectPatch execution', () => {
  it('resolves the canonical decision without requiring a relationship edge', () => {
    const project = createProjectFromInput(
      {
        name: 'Atlas pilot',
        goal: 'Choose and lock the technical scope for the pilot.',
      },
      '2026-08-24T12:00:00.000Z',
    );
    project.nodes.push({
      id: 'atlas-scope',
      type: 'DECISION',
      text: 'Choose the technical scope for the pilot.',
      status: 'OPEN',
      confidence: 0.9,
      impact: 0.95,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-24T12:00:00.000Z',
      updated_at: '2026-08-24T12:00:00.000Z',
    });

    const result = applyProjectPatch(
      project,
      {
        operations: [{
          op: 'RESOLVE_DECISION',
          targetNodeId: 'atlas-scope',
          outcome: 'Use nightly CSV imports and named user accounts for the pilot.',
          confidence: 0.99,
          operationRef: 'op:0',
        }],
      },
      'atlas-commitment',
      DEFAULT_USER_PROFILE,
    );

    const decision = result.project.nodes.find((node) => node.id === 'atlas-scope');
    expect(decision).toMatchObject({
      id: 'atlas-scope',
      type: 'DECISION',
      text: 'Choose the technical scope for the pilot.',
      status: 'RESOLVED',
      decision_outcome: 'Use nightly CSV imports and named user accounts for the pilot.',
      source_refs: ['atlas-commitment'],
    });
    expect(result.project.edges).toHaveLength(0);
    expect(result.createdNodeIds).toEqual([]);
    expect(result.updatedNodeIds).toEqual(['atlas-scope']);
    expect(result.rejectedOperations).toEqual([]);
  });
});
