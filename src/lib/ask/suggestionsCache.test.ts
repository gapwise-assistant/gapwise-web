import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import {
  askSuggestionsProjectStateVersion,
  clearAskSuggestionsInFlightForTests,
  getCachedAskSuggestions,
} from '@/lib/ask/suggestionsCache';

describe('Ask suggestions cache', () => {
  beforeEach(() => {
    clearAskSuggestionsInFlightForTests();
  });

  it('versions semantic state without changing for persistence timestamps alone', async () => {
    const project = createGoldenDemoProject();
    project.history.push({
      question: 'What is the next decision?',
      answer: 'Use the current plan.',
      timestamp: '2026-08-20T10:00:00.000Z',
      graph_diff_summary: 'A semantic history event.',
    });
    const initialVersion = await askSuggestionsProjectStateVersion(project);

    project.updated_at = '2030-01-01T00:00:00.000Z';
    project.nodes[0].updated_at = '2030-01-01T00:00:00.000Z';
    project.sources[0].extracted_at = '2030-01-01T00:00:00.000Z';
    project.sources[0].processed_at = '2030-01-01T00:00:00.000Z';
    project.history[project.history.length - 1].timestamp = '2030-01-01T00:00:00.000Z';
    if (project.historyEvents?.[0]) project.historyEvents[0].createdAt = '2030-01-01T00:00:00.000Z';
    project.sources.push({
      id: 'ask-meta-source',
      filename: 'Ask meta message',
      type: 'note',
      content: 'Why is this the recommended focus?',
      extracted_at: '2030-01-01T00:00:00.000Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });

    await expect(askSuggestionsProjectStateVersion(project)).resolves.toBe(initialVersion);

    project.nodes[0].text = `${project.nodes[0].text} with a changed requirement`;
    await expect(askSuggestionsProjectStateVersion(project)).resolves.not.toBe(initialVersion);
  });

  it('ignores persistence-only IDs and processing metadata', async () => {
    const project = createGoldenDemoProject();
    project.historyEvents = [{
      id: 'event-2026-08-20T10:00:00.000Z',
      projectId: project.id,
      createdAt: '2026-08-20T10:00:00.000Z',
      type: 'context_changed',
      title: 'Context changed',
      summary: 'A meaningful context change.',
      sourceId: 'src_1',
      sourceNodeIds: ['node_known_track'],
      affectedNodeIds: ['node_known_track'],
      primaryNodeId: 'node_known_track',
      changes: [{
        kind: 'learned',
        nodeId: 'node_known_track',
        text: 'Track requirements are known.',
        snapshot: {
          nodeId: 'node_known_track',
          text: 'Track requirements are known.',
          type: 'KNOWN',
          status: 'RESOLVED',
        },
      }],
    }];
    const initialVersion = await askSuggestionsProjectStateVersion(project);

    const source = project.sources.find((candidate) => candidate.id === 'src_1');
    if (!source) throw new Error('Expected a seeded source.');
    source.id = 'source-id-after-migration';
    source.filename = 'renamed-source.pdf';
    source.processing_status = 'processing';
    source.extraction_summary = 'A different processing summary.';
    source.extraction_hash = 'different-extraction-run';
    source.relevance = 'possibly_not_relevant';
    source.discarded_at = '2030-01-01T00:00:00.000Z';
    for (const node of project.nodes) {
      node.source_refs = node.source_refs.map((sourceId) => (
        sourceId === 'src_1' ? source.id : sourceId
      ));
    }
    project.historyEvents[0] = {
      ...project.historyEvents[0],
      id: 'event-2030-01-01T00:00:00.000Z',
      createdAt: '2030-01-01T00:00:00.000Z',
      sourceId: source.id,
      sourceNodeIds: ['renamed-node-id'],
      affectedNodeIds: ['renamed-node-id'],
      primaryNodeId: 'renamed-node-id',
      changes: [{
        ...project.historyEvents[0].changes![0],
        nodeId: 'renamed-node-id',
        snapshot: {
          ...project.historyEvents[0].changes![0].snapshot!,
          nodeId: 'renamed-node-id',
        },
      }],
    };

    await expect(askSuggestionsProjectStateVersion(project)).resolves.toBe(initialVersion);
  });

  it('changes when meaningful project state changes', async () => {
    const cases = [
      (project: ReturnType<typeof createGoldenDemoProject>) => {
        project.goal = `${project.goal} with a clearer outcome`;
      },
      (project: ReturnType<typeof createGoldenDemoProject>) => {
        project.deadline = '2030-01-01';
      },
      (project: ReturnType<typeof createGoldenDemoProject>) => {
        project.nodes[0].text = `${project.nodes[0].text} with a changed requirement`;
      },
      (project: ReturnType<typeof createGoldenDemoProject>) => {
        project.nodes[0].status = 'RESOLVED';
      },
      (project: ReturnType<typeof createGoldenDemoProject>) => {
        project.nodes[0].decision_outcome = 'Use the selected plan.';
      },
      (project: ReturnType<typeof createGoldenDemoProject>) => {
        project.edges[0].type = 'informs';
      },
      (project: ReturnType<typeof createGoldenDemoProject>) => {
        project.history.push({
          question: 'Which plan should be used?',
          answer: 'Use the selected plan.',
          timestamp: '2026-08-20T10:00:00.000Z',
          graph_diff_summary: 'A confirmed answer.',
        });
      },
      (project: ReturnType<typeof createGoldenDemoProject>) => {
        const source = project.sources.find((candidate) => candidate.id === 'src_1');
        if (!source) throw new Error('Expected a seeded source.');
        source.content = `${source.content} An additional requirement was confirmed.`;
      },
    ];

    for (const change of cases) {
      const project = createGoldenDemoProject();
      const initialVersion = await askSuggestionsProjectStateVersion(project);
      change(project);
      await expect(askSuggestionsProjectStateVersion(project)).resolves.not.toBe(initialVersion);
    }
  });

  it('returns a temporary fallback without saving it and retries the same state', async () => {
    const project = createGoldenDemoProject();
    const storage = {
      getAskSuggestionsCache: vi.fn().mockResolvedValue(null),
      saveAskSuggestionsCache: vi.fn().mockResolvedValue(undefined),
    };
    const generate = vi.fn()
      .mockResolvedValueOnce({
        suggestions: { top: ['Fallback question?'], other: [] },
        generatedBy: 'local-fallback',
        cacheable: false,
      })
      .mockResolvedValueOnce({
        suggestions: { top: ['Recovered AI question?'], other: [] },
        generatedBy: 'gapswise-agent',
        cacheable: true,
      });
    const params = {
      userId: 'demo-user',
      project,
      projectId: project.id,
      scopeKey: `project:${project.id}`,
      generate,
    };

    const first = await getCachedAskSuggestions(params, { storage: storage as never });
    const second = await getCachedAskSuggestions(params, { storage: storage as never });

    expect(first).toMatchObject({ top: ['Fallback question?'], cached: false });
    expect(second).toMatchObject({ top: ['Recovered AI question?'], cached: false });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledOnce();
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledWith(
      'demo-user',
      expect.objectContaining({ generatedBy: 'gapswise-agent' }),
    );
  });

  it('reuses a persisted result for the same semantic state', async () => {
    const project = createGoldenDemoProject();
    let savedRecord: Record<string, unknown> | null = null;
    const storage = {
      getAskSuggestionsCache: vi.fn(async () => savedRecord),
      saveAskSuggestionsCache: vi.fn(async (_userId: string, record: Record<string, unknown>) => {
        savedRecord = record;
      }),
    };
    const generate = vi.fn(async () => ({
      suggestions: { top: ['What should I clarify first?'], other: ['What can wait?'] },
      generatedBy: 'gapswise-agent',
      cacheable: true,
    }));

    const first = await getCachedAskSuggestions({
      userId: 'demo-user',
      project,
      projectId: project.id,
      scopeKey: `project:${project.id}`,
      generate,
    }, { storage: storage as never });
    const second = await getCachedAskSuggestions({
      userId: 'demo-user',
      project,
      projectId: project.id,
      scopeKey: `project:${project.id}`,
      generate,
    }, { storage: storage as never });

    expect(first).toMatchObject({ top: ['What should I clarify first?'], cached: false });
    expect(second).toMatchObject({ top: ['What should I clarify first?'], cached: true });
    expect(generate).toHaveBeenCalledOnce();
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledOnce();

    project.nodes[0].text = `${project.nodes[0].text} after new context`;
    const changedState = await getCachedAskSuggestions({
      userId: 'demo-user',
      project,
      projectId: project.id,
      scopeKey: `project:${project.id}`,
      generate,
    }, { storage: storage as never });

    expect(changedState.cached).toBe(false);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(storage.saveAskSuggestionsCache).toHaveBeenCalledTimes(2);
  });

  it('deduplicates simultaneous generation for the same cache key', async () => {
    const project = createGoldenDemoProject();
    let release!: () => void;
    const storage = {
      getAskSuggestionsCache: vi.fn().mockResolvedValue(null),
      saveAskSuggestionsCache: vi.fn().mockResolvedValue(undefined),
    };
    const generate = vi.fn(() => new Promise<{
      suggestions: { top: string[]; other: string[] };
      generatedBy: string;
      cacheable: boolean;
    }>((resolve) => {
      release = () => resolve({
        suggestions: { top: ['One generated question?'], other: [] },
        generatedBy: 'gapswise-agent',
        cacheable: true,
      });
    }));

    const params = {
      userId: 'demo-user',
      project,
      projectId: project.id,
      scopeKey: `project:${project.id}`,
      generate,
    };
    const first = getCachedAskSuggestions(params, { storage: storage as never });
    const second = getCachedAskSuggestions(params, { storage: storage as never });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(generate).toHaveBeenCalledOnce();

    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ top: ['One generated question?'] }),
      expect.objectContaining({ top: ['One generated question?'] }),
    ]);
  });
});
