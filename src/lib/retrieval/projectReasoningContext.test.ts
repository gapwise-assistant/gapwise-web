import { describe, expect, it } from 'vitest';
import type { ClarityNode, Project } from '@/types/clarity';
import { retrieveProjectReasoningContext } from './projectReasoningContext';

function node(
  id: string,
  type: ClarityNode['type'],
  text: string,
  sourceRefs: string[] = [],
  status: ClarityNode['status'] = 'OPEN',
): ClarityNode {
  return {
    id,
    type,
    text,
    status,
    confidence: 0.9,
    impact: 0.8,
    source_refs: sourceRefs,
    created_by: 'agent',
    created_at: '2026-08-24T10:00:00Z',
    updated_at: '2026-08-24T10:00:00Z',
  };
}

function project(nodes: ClarityNode[], edges: Project['edges'], sources: Project['sources'] = []): Project {
  return {
    id: 'reasoning-project',
    title: 'Reasoning project',
    goal: 'Deliver the project safely.',
    clarity_score: 60,
    nodes,
    edges,
    sources,
    history: [],
    created_at: '2026-08-24T10:00:00Z',
    updated_at: '2026-08-24T10:00:00Z',
  };
}

function source(id: string, content: string, derivedNodeIds: string[]): Project['sources'][number] {
  return {
    id,
    filename: `${id}.txt`,
    type: 'text',
    content,
    extracted_at: '2026-08-24T10:00:00Z',
    derived_node_ids: derivedNodeIds,
    processing_status: 'completed',
  };
}

describe('project reasoning retrieval', () => {
  it('selects a factual seed and its supporting source without expanding unrelated graph state', () => {
    const fact = node('fact', 'KNOWN', 'The supplier delivers the package on Friday.', ['source-fact'], 'RESOLVED');
    const unrelated = node('unrelated', 'KNOWN', 'The team prefers afternoon meetings.', ['source-unrelated'], 'RESOLVED');
    const result = retrieveProjectReasoningContext({
      project: project([fact, unrelated], [], [
        source('source-fact', 'The supplier delivery commitment is Friday.', ['fact']),
        source('source-unrelated', 'The team prefers afternoon meetings.', ['unrelated']),
      ]),
      query: 'When does the supplier deliver?',
      mode: 'factual',
    });

    expect(result.seedNodes.map((item) => item.id)).toContain('fact');
    expect(result.expandedNodes).toHaveLength(0);
    expect(result.evidence.map((item) => item.source_id)).toContain('source-fact');
    expect(result.evidence.map((item) => item.source_id)).not.toContain('source-unrelated');
  });

  it('retrieves evidence through an informs edge even when the source text does not match the query', () => {
    const decision = node('decision', 'DECISION', 'Choose the pilot format.');
    const evidence = node('evidence', 'EVIDENCE', 'A completed participant trial produced stable results.', ['trial-results'], 'RESOLVED');
    const result = retrieveProjectReasoningContext({
      project: project(
        [decision, evidence],
        [{ id: 'evidence-informs-decision', source: 'evidence', target: 'decision', type: 'informs' }],
        [source('trial-results', 'The completed participant trial produced stable results.', ['evidence'])],
      ),
      query: 'What supports the pilot decision?',
      mode: 'decision',
    });

    expect(result.seedNodes.map((item) => item.id)).toContain('decision');
    expect(result.expandedNodes.map((item) => item.id)).toContain('evidence');
    expect(result.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'evidence', target: 'decision', type: 'informs' }),
    ]));
    expect(result.evidence[0]).toMatchObject({
      source_id: 'trial-results',
      supports: expect.arrayContaining([evidence.text]),
    });
  });

  it('follows impact direction for consequences and does not reverse the persisted edges', () => {
    const unknown = node('unknown', 'UNKNOWN', 'Will the security review be accepted?');
    const approval = node('approval', 'CONSTRAINT', 'Security approval is required before procurement.');
    const procurement = node('procurement', 'DECISION', 'Choose whether to start procurement.');
    const result = retrieveProjectReasoningContext({
      project: project([unknown, approval, procurement], [
        { id: 'unknown-affects-approval', source: 'unknown', target: 'approval', type: 'affects' },
        { id: 'approval-blocks-procurement', source: 'approval', target: 'procurement', type: 'blocks' },
      ]),
      query: 'Will the review be accepted?',
      mode: 'impact',
    });

    expect(result.seedNodes.map((item) => item.id)).toContain('unknown');
    expect(result.expandedNodes.map((item) => item.id)).toEqual(expect.arrayContaining(['approval', 'procurement']));
    expect(result.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeIds: ['unknown', 'approval'],
        edgeIds: ['unknown-affects-approval'],
      }),
      expect.objectContaining({
        nodeIds: ['unknown', 'approval', 'procurement'],
        edgeIds: ['unknown-affects-approval', 'approval-blocks-procurement'],
      }),
    ]));
    expect(result.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'unknown', target: 'approval', type: 'affects' }),
      expect.objectContaining({ source: 'approval', target: 'procurement', type: 'blocks' }),
    ]));
  });

  it('traverses dependencies from a decision to its prerequisite and from the prerequisite to its dependent in impact mode', () => {
    const decision = node('decision', 'DECISION', 'Choose the launch date.');
    const prerequisite = node('prerequisite', 'UNKNOWN', 'When will the vendor deliver?', [], 'OPEN');
    const graph = project(
      [decision, prerequisite],
      [{ id: 'decision-depends-vendor', source: 'decision', target: 'prerequisite', type: 'depends_on' }],
    );

    const decisionContext = retrieveProjectReasoningContext({ project: graph, query: 'What launch date should we choose?', mode: 'decision' });
    const impactContext = retrieveProjectReasoningContext({ project: graph, query: 'What depends on the vendor delivery?', mode: 'impact' });

    expect(decisionContext.expandedNodes.map((item) => item.id)).toContain('prerequisite');
    expect(impactContext.expandedNodes.map((item) => item.id)).toContain('decision');
  });

  it('is bounded and deterministic', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node(`node-${index}`, 'UNKNOWN', `Open question ${index}`));
    const edges = nodes.slice(1).map((item, index) => ({
      id: `edge-${index}`,
      source: nodes[index].id,
      target: item.id,
      type: 'affects' as const,
    }));
    const input = { project: project(nodes, edges), query: 'Open question', mode: 'reasoning' as const };
    const first = retrieveProjectReasoningContext(input);
    const second = retrieveProjectReasoningContext(input);

    expect(first.seedNodes.length).toBeLessThanOrEqual(5);
    expect(first.seedNodes.length + first.expandedNodes.length).toBeLessThanOrEqual(12);
    expect(first.evidence.length).toBeLessThanOrEqual(6);
    expect(first).toEqual(second);
  });

  it('does not invent a path without a persisted edge', () => {
    const result = retrieveProjectReasoningContext({
      project: project([
        node('a', 'UNKNOWN', 'Will the supplier deliver?'),
        node('b', 'RISK', 'A delay could threaten launch.'),
      ], []),
      query: 'What happens if the supplier does not deliver?',
      mode: 'impact',
    });

    expect(result.relationships).toEqual([]);
    expect(result.paths).toEqual([]);
  });
});
