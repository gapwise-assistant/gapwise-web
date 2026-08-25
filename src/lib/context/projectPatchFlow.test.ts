import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

function modelResponse(payload: unknown) {
  return {
    models: {
      generateContent: async () => ({
        text: JSON.stringify(payload),
        modelVersion: 'gemini-test-version',
      }),
    },
  } as any;
}

describe('Context Agent to ProjectPatch flow', () => {
  it('uses operations as the only model-backed project mutation path', async () => {
    let project = createProjectFromInput(
      {
        name: 'Atlas pilot',
        goal: 'Choose and lock the technical scope for the pilot.',
      },
      '2026-08-24T12:00:00.000Z',
    );

    const initial = await processContextSource(project, {
      sourceId: 'atlas-scope-source',
      filename: 'scope.txt',
      type: 'text',
      content: 'The scope choice is still open.',
    }, DEFAULT_USER_PROFILE, {
      genAI: modelResponse({
        summary: 'The technical scope choice remains open.',
        relevance: 'relevant',
        operations: [{
          op: 'OPEN_DECISION',
          text: 'Choose the technical scope for the Atlas pilot.',
          confidence: 0.98,
          impact: 0.95,
        }],
        relationships: [],
      }),
    });
    project = initial.project;

    const decision = project.nodes.find((node) => node.type === 'DECISION');
    expect(decision).toMatchObject({
      text: 'Choose the technical scope for the Atlas pilot.',
      status: 'OPEN',
    });
    expect(project.nodes.filter((node) => node.type === 'DECISION')).toHaveLength(1);

    const resolved = await processContextSource(project, {
      sourceId: 'atlas-resolution-source',
      filename: 'resolution.txt',
      type: 'text',
      content: 'The team chose the pilot scope.',
    }, DEFAULT_USER_PROFILE, {
      genAI: modelResponse({
        summary: 'The existing technical scope decision is resolved.',
        relevance: 'relevant',
        operations: [{
          op: 'RESOLVE_DECISION',
          targetNodeId: decision!.id,
          outcome: 'Use nightly CSV imports for the pilot.',
          confidence: 0.99,
        }],
        relationships: [],
      }),
      captureProcessingLog: true,
    });
    project = resolved.project;

    expect(project.nodes.filter((node) => node.type === 'DECISION')).toHaveLength(1);
    expect(project.nodes.find((node) => node.id === decision!.id)).toMatchObject({
      text: 'Choose the technical scope for the Atlas pilot.',
      status: 'RESOLVED',
      decision_outcome: 'Use nightly CSV imports for the pilot.',
    });
    expect(project.edges).toHaveLength(0);

    const resolutionLog = project.sources
      .find((source) => source.id === 'atlas-resolution-source')
      ?.processing_log?.stages
      .find((stage) => stage.name === 'ProjectPatch execution');
    expect(resolutionLog?.output).toMatchObject({
      executed_operations: [expect.objectContaining({ op: 'RESOLVE_DECISION' })],
      created_node_ids: [],
      updated_node_ids: [decision!.id],
      final_project_node_count: project.nodes.length,
    });

    const hypothetical = await processContextSource(project, {
      sourceId: 'atlas-hypothetical-source',
      filename: 'hypothetical.txt',
      type: 'text',
      content: 'If we changed the scope later, what might be affected?',
    }, DEFAULT_USER_PROFILE, {
      genAI: modelResponse({
        summary: 'This is a hypothetical question.',
        relevance: 'relevant',
        operations: [{ op: 'NO_CHANGE', confidence: 1 }],
        relationships: [],
      }),
    });

    expect(hypothetical.project.nodes).toHaveLength(project.nodes.length);
    expect(hypothetical.project.sources.find((source) => source.id === 'atlas-hypothetical-source')?.derived_node_ids).toEqual([]);
  });
});
