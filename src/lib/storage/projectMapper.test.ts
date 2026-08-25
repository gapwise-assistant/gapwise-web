import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import {
  collectionsToGeneralContext,
  collectionsToProject,
  generalContextToCollections,
  projectToCollections,
} from '@/lib/storage/projectMapper';

describe('project storage mapper', () => {
  it('round-trips decision reconciliation metadata for project and general-context nodes', () => {
    const project = createProjectFromInput(
      { name: 'Storage round trip', goal: 'Preserve canonical decision state.' },
      '2026-08-25T12:00:00.000Z',
    );
    project.nodes.push({
      id: 'decision_round_trip',
      type: 'DECISION',
      text: 'Choose the pilot scope.',
      status: 'RESOLVED',
      confidence: 1,
      impact: 0.9,
      source_refs: ['source_decision'],
      created_by: 'agent',
      created_at: project.created_at,
      updated_at: project.updated_at,
      decision_outcome: 'Use nightly CSV imports.',
      canonical_node_id: 'canonical_scope_decision',
      reconciliation_classification: 'EQUIVALENT',
    });
    project.history = [{
      question: 'Choose the pilot scope.',
      answer: 'Use nightly CSV imports.',
      timestamp: '2026-08-25T12:01:00.000Z',
      graph_diff_summary: 'Resolved the pilot scope.',
      nodeId: 'decision_round_trip',
      projectId: project.id,
    }];

    const collections = projectToCollections('mapper-user', project);
    expect(collections.nodes.find((node) => node.id === 'decision_round_trip')).toMatchObject({
      decision_outcome: 'Use nightly CSV imports.',
      canonical_node_id: 'canonical_scope_decision',
      reconciliation_classification: 'EQUIVALENT',
    });

    const loadedProject = collectionsToProject(collections, project.id);
    expect(loadedProject?.nodes.find((node) => node.id === 'decision_round_trip')).toMatchObject({
      decision_outcome: 'Use nightly CSV imports.',
      canonical_node_id: 'canonical_scope_decision',
      reconciliation_classification: 'EQUIVALENT',
    });
    expect(loadedProject?.history).toEqual(project.history);

    const generalCollections = generalContextToCollections('mapper-user', project);
    const loadedGeneralContext = collectionsToGeneralContext(generalCollections);
    expect(loadedGeneralContext.nodes.find((node) => node.id === 'decision_round_trip')).toMatchObject({
      decision_outcome: 'Use nightly CSV imports.',
      canonical_node_id: 'canonical_scope_decision',
      reconciliation_classification: 'EQUIVALENT',
    });
  });
});
