import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { buildProcessingProjectSnapshot, serializeProcessingProjectSnapshot } from '@/lib/context/processingProjectSnapshot';
import type { ContextProcessingLog } from '@/types/clarity';

describe('processing project snapshot', () => {
  it('keeps semantic graph state without embedding sources or processing logs', () => {
    const project = createProjectFromInput({
      name: 'Snapshot safety',
      goal: 'Keep diagnostics useful and bounded.',
      deadline: '2026-09-01',
    }, '2026-08-27T12:00:00.000Z');
    project.nodes.push({
      id: 'decision-1',
      type: 'DECISION',
      text: 'Choose the diagnostic retention period.',
      status: 'OPEN',
      confidence: 0.9,
      impact: 0.8,
      source_refs: ['source-1'],
      created_by: 'agent',
      created_at: project.created_at,
      updated_at: project.updated_at,
    });
    project.edges.push({
      id: 'edge-1',
      source: project.nodes[0]!.id,
      target: 'decision-1',
      type: 'informs',
      confidence: 0.8,
    });
    project.sources.push({
      id: 'source-1',
      filename: 'private.txt',
      type: 'text',
      content: 'This full source should never be embedded in the snapshot.',
      extracted_at: project.created_at,
      derived_node_ids: ['decision-1'],
      processing_log: {
        version: 1,
        status: 'completed',
        started_at: project.created_at,
        completed_at: project.updated_at,
        duration_ms: 1,
        input: {
          source_id: 'source-1',
          filename: 'private.txt',
          type: 'text',
          content: 'recursive log content',
          project_snapshot: 'recursive snapshot content',
        },
        stages: [],
      },
    } satisfies (typeof project.sources)[number]);

    const snapshot = buildProcessingProjectSnapshot(project);
    const serialized = serializeProcessingProjectSnapshot(project);

    expect(snapshot).toMatchObject({
      project_id: project.id,
      project_title: project.title,
      project_goal: project.goal,
      deadline: project.deadline,
      important_nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'decision-1', type: 'DECISION', text: 'Choose the diagnostic retention period.' }),
      ]),
      important_edges: [{ source: project.nodes[0]!.id, target: 'decision-1', type: 'informs', confidence: 0.8 }],
    });
    expect(serialized).not.toContain('private.txt');
    expect(serialized).not.toContain('recursive log content');
    expect(serialized).not.toContain('processing_log');
    expect(serialized).not.toContain('source_refs');
  });
});
