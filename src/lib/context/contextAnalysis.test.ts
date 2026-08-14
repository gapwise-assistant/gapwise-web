import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { calculateClarityScore } from '@/lib/prioritization';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { analyzeContextItem, processContextSource } from '@/lib/context/contextAnalysis';
import { ingestContextSource } from '@/lib/context/ingestion';
import { Project } from '@/types/clarity';

function projectWithGoal(goal = 'Plan a 10 day Japan trip for October'): Project {
  return createProjectFromInput({ name: 'Japan trip', goal }, '2026-08-13T12:00:00.000Z');
}

function mockGenAI(payload: unknown) {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify(payload),
        modelVersion: 'gemini-test-version',
      }),
    },
  } as any;
}

function input(overrides: Partial<Parameters<typeof processContextSource>[1]> = {}) {
  return {
    sourceId: 'src_japan_notes',
    filename: 'japan-notes.txt',
    type: 'text' as const,
    content: 'The trip is 10 days and includes Tokyo and Kyoto.',
    ...overrides,
  };
}

describe('AI context graph analysis', () => {
  const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

  afterEach(() => {
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  });

  it('creates multiple source-backed UNKNOWN nodes from explicit uncertainty', async () => {
    const genAI = mockGenAI({
      summary: 'The note leaves two important Japan trip questions unresolved.',
      nodes: [
        { type: 'UNKNOWN', text: 'What are pink things?', confidence: 0.91, impact: 0.8, why_it_matters: ['This affects the choice being considered.'] },
        { type: 'UNKNOWN', text: 'Are green things better than pink things?', confidence: 0.88, impact: 0.79, why_it_matters: ['This affects the choice being considered.'] },
      ],
    });
    const project = projectWithGoal('Decide which things to choose for the Japan trip.');
    const result = await processContextSource(project, input({
      content: "I need to know if green things might be better than pink things, and I don't know what pink things are.",
    }), DEFAULT_USER_PROFILE, { genAI });

    const source = result.project.sources.find((item) => item.id === 'src_japan_notes');
    const nodes = result.project.nodes.filter((node) => source?.derived_node_ids.includes(node.id));
    expect(genAI.models.generateContent).toHaveBeenCalledTimes(1);
    expect(nodes.map((node) => node.text)).toEqual([
      'What are pink things?',
      'Are green things better than pink things?',
    ]);
    expect(nodes.every((node) => node.type === 'UNKNOWN' && node.status === 'OPEN' && node.created_by === 'agent')).toBe(true);
    expect(nodes.every((node) => node.source_refs.includes('src_japan_notes'))).toBe(true);
    expect(nodes.map((node) => node.id)).toContain(result.project.active_question?.node_id);
    expect(result.project.clarity_score).toBe(calculateClarityScore(result.project));
  });

  it('allows a small goal-relevant inferred gap and rejects generic unknowns', async () => {
    const genAI = mockGenAI({
      summary: 'The trip outline is missing a decision-driving budget.',
      nodes: [
        { type: 'UNKNOWN', text: 'What is the trip budget?', confidence: 0.7, impact: 0.9, why_it_matters: ['Budget determines which itinerary is feasible.'] },
        { type: 'UNKNOWN', text: 'What should I do next?', confidence: 0.7, impact: 0.9 },
        { type: 'UNKNOWN', text: 'What else should I consider?', confidence: 0.7, impact: 0.9 },
      ],
    });
    const result = await processContextSource(projectWithGoal(), input(), DEFAULT_USER_PROFILE, { genAI });
    const unknowns = result.project.nodes.filter((node) => node.type === 'UNKNOWN');
    expect(unknowns.map((node) => node.text)).toEqual(['What is the trip budget?']);
  });

  it('reconciles new evidence with assumptions and unresolved questions', async () => {
    const project = projectWithGoal('Plan a Japan trip and choose hotels responsibly.');
    project.nodes.push(
      {
        id: 'assumption_hotel_area',
        type: 'ASSUMPTION',
        text: 'Hotels near Shinjuku are the best option.',
        status: 'OPEN',
        confidence: 0.8,
        impact: 0.8,
        source_refs: [],
        created_by: 'user',
        created_at: '2026-08-13T10:00:00.000Z',
        updated_at: '2026-08-13T10:00:00.000Z',
      },
      {
        id: 'unknown_trip_budget',
        type: 'UNKNOWN',
        text: 'What is my Japan trip budget?',
        status: 'OPEN',
        confidence: 0.7,
        impact: 0.9,
        source_refs: [],
        created_by: 'agent',
        created_at: '2026-08-13T10:00:00.000Z',
        updated_at: '2026-08-13T10:00:00.000Z',
      }
    );
    const genAI = mockGenAI({
      summary: 'New hotel research challenges the old area assumption and answers the budget question.',
      nodes: [
        { type: 'EVIDENCE', text: 'Comparable Kyoto hotels fit the available trip budget better.', confidence: 0.95, impact: 0.85 },
      ],
      relationships: [
        { source_node_index: 0, target_node_id: 'assumption_hotel_area', type: 'contradicts', confidence: 0.95 },
        { source_node_index: 0, target_node_id: 'unknown_trip_budget', type: 'resolves', confidence: 0.92 },
      ],
    });

    const result = await processContextSource(project, input({
      content: 'Hotel research shows Kyoto options fit the budget better than Shinjuku.',
    }), DEFAULT_USER_PROFILE, { genAI });
    const assumption = result.project.nodes.find((node) => node.id === 'assumption_hotel_area');
    const budget = result.project.nodes.find((node) => node.id === 'unknown_trip_budget');

    expect(result.project.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'assumption_hotel_area', type: 'contradicts', confidence: 0.95 }),
      expect.objectContaining({ target: 'unknown_trip_budget', type: 'resolves', confidence: 0.92 }),
    ]));
    expect(assumption).toEqual(expect.objectContaining({ status: 'DEFERRED', source_refs: ['src_japan_notes'] }));
    expect(assumption?.why_it_matters?.join(' ')).toContain('Questioned by newer evidence');
    expect(budget).toEqual(expect.objectContaining({ status: 'RESOLVED', source_refs: ['src_japan_notes'] }));
    expect(budget?.why_it_matters?.join(' ')).toContain('Resolved by newer evidence');
  });

  it('connects goal-relevant gaps to decisions without creating speculative edges', async () => {
    const project = projectWithGoal('Plan a Japan trip.');
    const goalId = project.nodes[0].id;
    const genAI = mockGenAI({
      summary: 'Budget is needed before hotel selection.',
      nodes: [
        { type: 'UNKNOWN', text: 'What is the trip budget?', confidence: 0.9, impact: 0.9 },
        { type: 'DECISION', text: 'Which hotels should I book?', confidence: 0.9, impact: 0.85 },
      ],
      relationships: [
        { source_node_index: 0, target_node_id: 'new:1', type: 'blocks', confidence: 0.93 },
        { source_node_index: 1, target_node_id: goalId, type: 'affects', confidence: 0.9 },
        { source_node_index: 0, target_node_id: 'missing_node', type: 'supports', confidence: 0.99 },
      ],
    });

    const result = await processContextSource(project, input({
      content: 'I need a budget before deciding which hotels to book.',
    }), DEFAULT_USER_PROFILE, { genAI });
    const budget = result.project.nodes.find((node) => node.text === 'What is the trip budget?');
    const decision = result.project.nodes.find((node) => node.text === 'Which hotels should I book?');

    expect(result.project.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: budget?.id, target: decision?.id, type: 'blocks' }),
      expect.objectContaining({ source: decision?.id, target: goalId, type: 'affects' }),
    ]));
    expect(result.project.edges.some((edge) => edge.target === 'missing_node')).toBe(false);
  });

  it('resolves an existing question when the new analysis repeats its meaning', async () => {
    const project = projectWithGoal('Plan a Japan trip.');
    project.nodes.push({
      id: 'unknown_existing_budget',
      type: 'UNKNOWN',
      text: 'What is the trip budget?',
      status: 'OPEN',
      confidence: 0.4,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-13T10:00:00.000Z',
      updated_at: '2026-08-13T10:00:00.000Z',
    });
    const genAI = mockGenAI({
      summary: 'The note answers the existing budget question.',
      nodes: [{ type: 'UNKNOWN', text: 'What is the trip budget?', confidence: 0.9, impact: 0.9 }],
      relationships: [{ source_node_index: 0, target_node_id: 'unknown_existing_budget', type: 'resolves', confidence: 0.95 }],
    });

    const result = await processContextSource(project, input({
      content: 'The trip budget is 3000 USD.',
    }), DEFAULT_USER_PROFILE, { genAI });

    expect(result.project.nodes.filter((node) => node.text === 'What is the trip budget?')).toHaveLength(1);
    expect(result.project.nodes.find((node) => node.id === 'unknown_existing_budget')).toEqual(
      expect.objectContaining({ status: 'RESOLVED', source_refs: ['src_japan_notes'] })
    );
  });

  it('preserves historical nodes when a source is reprocessed', async () => {
    const project = projectWithGoal();
    const first = await ingestContextSource(project, {
      sourceId: 'src_reprocessed',
      filename: 'changing-note.txt',
      type: 'text',
      content: 'The original hotel plan.',
      derivedNodes: [{ type: 'KNOWN', text: 'The original hotel plan.', confidence: 0.8 }],
    }, DEFAULT_USER_PROFILE);
    const second = await ingestContextSource(first, {
      sourceId: 'src_reprocessed',
      filename: 'changing-note.txt',
      type: 'text',
      content: 'The updated hotel plan.',
      derivedNodes: [{ type: 'KNOWN', text: 'The updated hotel plan.', confidence: 0.9 }],
    }, DEFAULT_USER_PROFILE);

    expect(second.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'The original hotel plan.', status: 'DEPRECATED' }),
      expect.objectContaining({ text: 'The updated hotel plan.', status: 'RESOLVED' }),
    ]));
    expect(second.sources).toHaveLength(1);
    expect(second.sources[0].derived_node_ids).toHaveLength(1);
  });

  it('persists an advisory possibly-not-relevant flag without discarding the source', async () => {
    const genAI = mockGenAI({
      summary: 'A note that may belong to another project.',
      relevance: 'possibly_not_relevant',
      nodes: [{ type: 'KNOWN', text: 'The note discusses a separate topic.', confidence: 0.8, impact: 0.4 }],
    });
    const result = await processContextSource(projectWithGoal(), input({ content: 'A separate topic unrelated to the trip.' }), DEFAULT_USER_PROFILE, { genAI });
    const source = result.project.sources.find((item) => item.id === 'src_japan_notes');

    expect(source?.relevance).toBe('possibly_not_relevant');
    expect(source?.discarded_at).toBeUndefined();
    expect(source?.derived_node_ids).toHaveLength(1);
    expect(genAI.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('deduplicates unchanged context without a second Gemini call', async () => {
    const genAI = mockGenAI({
      summary: 'A useful note.',
      nodes: [{ type: 'KNOWN', text: 'Tokyo and Kyoto are in the itinerary.', confidence: 0.9, impact: 0.6 }],
    });
    const project = projectWithGoal();
    const first = await processContextSource(project, input(), DEFAULT_USER_PROFILE, { genAI });
    const second = await processContextSource(first.project, input(), DEFAULT_USER_PROFILE, { genAI });

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(genAI.models.generateContent).toHaveBeenCalledTimes(1);
    expect(second.project.sources).toHaveLength(1);
  });

  it('does not call Gemini in demo mode and keeps deterministic ingestion', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const genAI = mockGenAI({ summary: 'Must not run', nodes: [] });
    const result = await processContextSource(projectWithGoal(), input(), DEFAULT_USER_PROFILE, { genAI });

    expect(genAI.models.generateContent).not.toHaveBeenCalled();
    expect(result.project.sources).toHaveLength(1);
    expect(result.project.nodes.some((node) => node.source_refs.includes('src_japan_notes'))).toBe(true);
  });

  it('keeps context analysis isolated to the project supplied to it', async () => {
    const projectA = projectWithGoal('Plan a Japan trip.');
    const projectB = projectWithGoal('Ship a hackathon project.');
    projectB.nodes[0].id = 'goal_project_b_private';
    const genAI = mockGenAI({
      summary: 'Private project note.',
      nodes: [{ type: 'KNOWN', text: 'Private trip detail.', confidence: 0.9, impact: 0.6 }],
      relationships: [{ source_node_index: 0, target_node_id: projectB.nodes[0].id, type: 'supports', confidence: 0.99 }],
    });
    const result = await processContextSource(projectA, input({ sourceId: 'src_private_a' }), DEFAULT_USER_PROFILE, { genAI });

    expect(result.project.sources.some((source) => source.id === 'src_private_a')).toBe(true);
    expect(projectB.sources).toEqual([]);
    expect(projectB.nodes).toHaveLength(1);
    expect(result.project.edges).toEqual([]);
  });

  it('requests the configured structured graph schema and compact project state', async () => {
    const genAI = mockGenAI({ summary: 'Summary.', nodes: [] });
    await analyzeContextItem({ ...input({ sourceId: 'src_schema' }), genAI }, projectWithGoal());

    expect(genAI.models.generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.5-flash-lite',
      config: expect.objectContaining({
        responseMimeType: 'application/json',
        responseSchema: expect.objectContaining({
          properties: expect.objectContaining({
            relevance: expect.objectContaining({
              enum: ['relevant', 'possibly_not_relevant'],
            }),
            nodes: expect.objectContaining({
              items: expect.objectContaining({
                properties: expect.objectContaining({
                  type: expect.objectContaining({
                    enum: expect.arrayContaining(['KNOWN', 'UNKNOWN', 'EXPERIMENT', 'PREFERENCE']),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
      contents: expect.arrayContaining([
        expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({ text: expect.stringContaining('Plan a 10 day Japan trip for October') }),
          ]),
        }),
      ]),
    }));
  });
});
