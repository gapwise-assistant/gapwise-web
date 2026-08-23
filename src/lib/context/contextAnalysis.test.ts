import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { calculateClarityScore } from '@/lib/prioritization';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { analyzeContextItem, processContextSource } from '@/lib/context/contextAnalysis';
import { ingestContextSource } from '@/lib/context/ingestion';
import { rankGaps } from '@/lib/tools/graphTools';
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

  it('applies the batched Context Agent reconciliation to an existing canonical question', async () => {
    const project = projectWithGoal('Build a quiet PC within budget.');
    project.nodes.push({
      id: 'q_psu',
      type: 'UNKNOWN',
      text: 'Can the existing 650 W power supply safely run the selected GPU?',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-20T10:00:00.000Z',
      updated_at: '2026-08-20T10:00:00.000Z',
    });
    const genAI = mockGenAI({
      summary: 'The retailer has not guaranteed the older power supply.',
      nodes: [{ type: 'UNKNOWN', text: 'Is the old 650 W PSU safe for the chosen GPU?', confidence: 0.9, impact: 0.9 }],
      reconciliation: [{
        candidate_index: 0,
        classification: 'PARAPHRASE',
        canonical_question_id: 'q_psu',
        confidence: 0.96,
        reason: 'The candidate asks the same PSU safety question with shorter wording.',
      }],
    });

    const result = await processContextSource(project, input({
      sourceId: 'src_psu_quote',
      filename: 'retailer-quote.txt',
      content: 'Is the old 650 W PSU safe for the chosen GPU?',
    }), DEFAULT_USER_PROFILE, { genAI });

    expect(result.project.nodes.filter((node) => node.type === 'UNKNOWN')).toHaveLength(1);
    expect(result.project.nodes.find((node) => node.id === 'q_psu')).toMatchObject({
      source_refs: ['src_psu_quote'],
      question_aliases: ['Is the old 650 W PSU safe for the chosen GPU?'],
      reconciliation_status: 'reconciled',
    });
    expect(result.project.sources.find((source) => source.id === 'src_psu_quote')?.reconciliation_summary).toMatchObject({
      canonical_merge_count: 1,
      validation_status: 'passed',
    });
  });

  it('keeps explicit source wording when Gemini paraphrases a PC question', async () => {
    const project = projectWithGoal('Build a quiet PC within budget.');
    project.nodes.push({
      id: 'q_wifi',
      type: 'UNKNOWN',
      text: 'Does the build need built-in Wi-Fi, or can an Ethernet cable be used temporarily?',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.7,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-20T10:00:00.000Z',
      updated_at: '2026-08-20T10:00:00.000Z',
    });
    const genAI = mockGenAI({
      summary: 'The networking choice remains open.',
      nodes: [{
        type: 'UNKNOWN',
        text: 'Does the build require wireless network access?',
        confidence: 0.9,
        impact: 0.7,
      }],
    });

    const result = await processContextSource(project, input({
      sourceId: 'src_wifi_notes',
      filename: 'room-and-network-notes.txt',
      content: 'Does the build need built-in Wi-Fi, or can an Ethernet cable be used temporarily?',
    }), DEFAULT_USER_PROFILE, { genAI });

    const wifi = result.project.nodes.find((node) => node.id === 'q_wifi');
    expect(wifi?.text).toBe('Does the build need built-in Wi-Fi, or can an Ethernet cable be used temporarily?');
    expect(wifi?.text).not.toContain('wireless network access');
    expect(wifi?.source_refs).toContain('src_wifi_notes');
  });

  it('preserves model-declared new uncertainties returned by the same Context Agent response', async () => {
    const genAI = mockGenAI({
      summary: 'The operating-system choice is still open.',
      nodes: [
        { type: 'UNKNOWN', text: 'Do I need Windows Pro for Hyper-V and Remote Desktop, or is Windows Home sufficient?', confidence: 0.9, impact: 0.8 },
        { type: 'UNKNOWN', text: 'Is Windows Home sufficient for the project, or are Windows Pro features like Hyper-V and Remote Desktop required?', confidence: 0.88, impact: 0.8 },
      ],
      reconciliation: [
        { candidate_index: 0, classification: 'NEW_UNCERTAINTY', confidence: 0.8, reason: 'New operating-system uncertainty.' },
        { candidate_index: 1, classification: 'NEW_UNCERTAINTY', confidence: 0.8, reason: 'Another operating-system wording from the source.' },
      ],
    });
    const result = await processContextSource(projectWithGoal('Build a quiet PC within budget.'), input({
      sourceId: 'src_os_notes',
      filename: 'operating-system-notes.txt',
      content: [
        'The operating-system decision remains open.',
        'Do I need Windows Pro for Hyper-V and Remote Desktop, or is Windows Home sufficient?',
      ].join('\n'),
    }), DEFAULT_USER_PROFILE, { genAI });

    const questions = result.project.nodes.filter((node) => node.type === 'UNKNOWN' && node.source_refs.includes('src_os_notes'));
    expect(questions).toHaveLength(2);
    expect(questions.map((question) => question.text)).toEqual(expect.arrayContaining([
      'Do I need Windows Pro for Hyper-V and Remote Desktop, or is Windows Home sufficient?',
      'Is Windows Home sufficient for the project, or are Windows Pro features like Hyper-V and Remote Desktop required?',
    ]));
    expect(result.project.sources.find((source) => source.id === 'src_os_notes')?.reconciliation_summary).toMatchObject({
      canonical_merge_count: 0,
      new_question_count: 2,
      validation_status: 'passed',
    });
  });

  it('adds a missing-contingency question when the model returns only the risk', async () => {
    const genAI = mockGenAI({
      summary: 'The demo has no fallback for slow matching.',
      nodes: [
        { type: 'RISK', text: 'If matching takes longer than five seconds, there is no fallback screen.', confidence: 0.9, impact: 0.9 },
        { type: 'NEXT_ACTION', text: 'Test matching latency before the demo.', confidence: 0.9, impact: 0.8 },
      ],
    });

    const result = await processContextSource(projectWithGoal('Present a reliable working demo.'), input({
      sourceId: 'src_demo_risk',
      filename: 'demo-risk.txt',
      content: 'If matching takes longer than five seconds, we do not have a fallback screen.',
    }), DEFAULT_USER_PROFILE, { genAI });

    expect(result.project.nodes.map((node) => node.text)).toContain(
      'What fallback is available if matching takes longer than five seconds?'
    );
  });

  it('keeps an upload prerequisite actionable when the model returns it as a statement', async () => {
    const genAI = mockGenAI({
      summary: 'The upload credentials have not been verified together.',
      nodes: [
        {
          type: 'UNKNOWN',
          text: 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are mismatched because they were copied from different Supabase projects and have not been tested together.',
          confidence: 0.9,
          impact: 0.95,
        },
      ],
    });

    const result = await processContextSource(projectWithGoal('Present a reliable working demo of a lost-and-found app.'), input({
      sourceId: 'src_upload_status',
      filename: 'current-hackathon-status.txt',
      content: [
        'The upload endpoint is failing with 401 Unauthorized.',
        'In .env.local, NEXT_PUBLIC_SUPABASE_URL points to the new project, but SUPABASE_SERVICE_ROLE_KEY was copied from an older project.',
        'I have not tested both values from the same project.',
        'Our demo seed file contains a real phone number. I have not replaced it with fake data.',
      ].join('\n'),
    }), DEFAULT_USER_PROFILE, { genAI });

    const sourceNodes = result.project.nodes.filter((node) => node.source_refs.includes('src_upload_status'));
    const questions = sourceNodes.filter((node) => node.type === 'UNKNOWN');
    expect(questions).toHaveLength(1);
    expect(sourceNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Test both values from the same project.' }),
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Replace a real phone number with fake data.' }),
      expect.objectContaining({ type: 'EVIDENCE', text: 'I have not tested both values from the same project.' }),
      expect.objectContaining({ type: 'EVIDENCE', text: 'I have not replaced it with fake data.' }),
    ]));
    expect(questions[0]?.text).toMatch(/resolve|failure|endpoint|401/i);
  });

  it('keeps an outcome question while representing the known prerequisite as work', async () => {
    const genAI = mockGenAI({
      summary: 'A prerequisite action has not been tested.',
      nodes: [{
        type: 'UNKNOWN',
        text: 'What error occurs when both values from the same project are tested together?',
        confidence: 0.9,
        impact: 0.9,
      }],
    });

    const result = await processContextSource(projectWithGoal('Complete the project reliably.'), input({
      sourceId: 'src_unresolved_action',
      filename: 'status.txt',
      content: 'I have not tested both values from the same project.',
    }), DEFAULT_USER_PROFILE, { genAI });

    const questions = result.project.nodes.filter((node) =>
      node.type === 'UNKNOWN' && node.source_refs.includes('src_unresolved_action')
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]?.text).toBe('What error occurs when both values from the same project are tested together?');
    expect(result.project.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Test both values from the same project.' }),
    ]));
  });

  it('keeps a generic unresolved outcome alongside evidence and unfinished work', async () => {
    const genAI = mockGenAI({
      summary: 'The configuration has not been verified after the failure.',
      nodes: [{
        type: 'UNKNOWN',
        text: 'The two configuration values are inconsistent and the endpoint has not been tested after correction.',
        confidence: 0.9,
        impact: 0.9,
      }],
    });

    const result = await processContextSource(projectWithGoal('Ship a reliable service.'), input({
      sourceId: 'src_generic_outcome',
      filename: 'service-status.txt',
      content: 'The endpoint is failing. I have not tested the two configuration values together after correction.',
    }), DEFAULT_USER_PROFILE, { genAI });

    const sourceNodes = result.project.nodes.filter((node) => node.source_refs.includes('src_generic_outcome'));
    expect(sourceNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'EVIDENCE', text: 'I have not tested the two configuration values together after correction.' }),
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Test the two configuration values together after correction.' }),
    ]));
    expect(sourceNodes.filter((node) => node.type === 'UNKNOWN')).toHaveLength(1);
    expect(sourceNodes.find((node) => node.type === 'UNKNOWN')?.text).toMatch(/resolve|endpoint|failure/i);
  });

  it('does not infer an outcome when the model statement could link multiple actions', async () => {
    const genAI = mockGenAI({
      summary: 'The endpoint failure has not been checked through either corrective action.',
      nodes: [{
        type: 'UNKNOWN',
        text: 'The endpoint is failing and the corrected configuration has not been tested or reviewed.',
        confidence: 0.9,
        impact: 0.9,
      }],
    });

    const result = await processContextSource(projectWithGoal('Ship a reliable service.'), input({
      sourceId: 'src_ambiguous_outcome',
      filename: 'ambiguous-status.txt',
      content: 'The endpoint is failing. I have not tested the corrected configuration. I have not reviewed the corrected configuration.',
    }), DEFAULT_USER_PROFILE, { genAI });

    const sourceNodes = result.project.nodes.filter((node) => node.source_refs.includes('src_ambiguous_outcome'));
    expect(sourceNodes.filter((node) => node.type === 'UNKNOWN')).toHaveLength(0);
    expect(sourceNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Test the corrected configuration.' }),
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Review the corrected configuration.' }),
    ]));
  });

  it('does not manufacture a vague action when a negative pronoun has no safe antecedent', async () => {
    const genAI = mockGenAI({
      summary: 'A data replacement has not been completed.',
      nodes: [{ type: 'EVIDENCE', text: 'I have not replaced it with fictional data.', confidence: 0.9, impact: 0.8 }],
    });

    const result = await processContextSource(projectWithGoal('Prepare a safe demo.'), input({
      sourceId: 'src_unresolved_pronoun',
      filename: 'privacy-note.txt',
      content: 'I have not replaced it with fictional data.',
    }), DEFAULT_USER_PROFILE, { genAI });

    const sourceNodes = result.project.nodes.filter((node) => node.source_refs.includes('src_unresolved_pronoun'));
    expect(sourceNodes.some((node) => /referenced item|the user/i.test(node.text))).toBe(false);
    expect(sourceNodes.some((node) => node.type === 'NEXT_ACTION')).toBe(false);
    expect(sourceNodes.some((node) => node.type === 'EVIDENCE')).toBe(true);
  });

  it('keeps every explicit unresolved question even when the model returns only surrounding evidence', async () => {
    const genAI = mockGenAI({
      summary: 'The ClinicFlow brief has several launch gates.',
      nodes: [
        { type: 'KNOWN', text: 'The pilot has a September go/no-go deadline.', confidence: 0.95, impact: 0.85 },
        { type: 'RISK', text: 'Duplicate records would be unsafe.', confidence: 0.9, impact: 0.9 },
      ],
    });
    const result = await processContextSource(projectWithGoal('Make a safe ClinicFlow pilot decision.'), input({
      filename: 'clinicflow-brief.md',
      content: [
        'The go/no-go decision is blocked by four unresolved inputs:',
        '- Who owns clinical accountability for medication corrections?',
        '- Can offline retries avoid duplicate EHR records?',
        '- Is SMS consent approved for PHI intake?',
        '- Can one coordinator handle peak exception review?',
      ].join('\n'),
    }), DEFAULT_USER_PROFILE, { genAI });

    const questions = result.project.nodes.filter((node) => node.type === 'UNKNOWN' && node.source_refs.includes('src_japan_notes'));
    expect(questions.map((node) => node.text)).toEqual(expect.arrayContaining([
      'Who owns clinical accountability for medication corrections?',
      'Can offline retries avoid duplicate EHR records?',
      'Is SMS consent approved for PHI intake?',
      'Can one coordinator handle peak exception review?',
    ]));
    expect(questions).toHaveLength(4);
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
        { type: 'EVIDENCE', text: 'Comparable Kyoto hotels were recorded as fitting the available trip budget better.', confidence: 0.95, impact: 0.85 },
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
        { source_node_index: 0, target_node_id: 'new:1', type: 'supports', confidence: 0.99 },
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
    expect(result.project.edges.some((edge) => edge.source === budget?.id && edge.target === decision?.id && edge.type === 'supports')).toBe(false);
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
      nodes: [{ type: 'EVIDENCE', text: 'The trip budget is recorded as 3000 USD.', confidence: 0.9, impact: 0.9 }],
      relationships: [{ source_node_index: 0, target_node_id: 'unknown_existing_budget', type: 'resolves', confidence: 0.95 }],
    });

    const result = await processContextSource(project, input({
      content: 'The trip budget is recorded as 3000 USD.',
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

  it('consolidates surgery status candidates into one canonical insurance question', async () => {
    const modelQuestion = 'Has the insurance company approved the procedure authorization, or what was the outcome of the review expected by October 9?';
    const genAI = mockGenAI({
      summary: 'The surgery preparation note leaves authorization and preparation details to confirm.',
      nodes: [
        { type: 'UNKNOWN', text: modelQuestion, confidence: 0.4, impact: 0.96 },
        { type: 'UNKNOWN', text: 'What does the user need to know before the surgery?', confidence: 0.86, impact: 0.72 },
      ],
    });
    const result = await processContextSource(projectWithGoal('Complete my surgery preparation by October 9.'), input({
      sourceId: 'src_surgery_context',
      filename: 'surgery-preparation.txt',
      content: [
        'I am preparing for surgery on October 9.',
        'My insurance company told me the procedure authorization is still being reviewed.',
        'What should I confirm before the surgery?',
        'The surgical center has not confirmed the arrival instructions.',
      ].join('\n'),
    }), DEFAULT_USER_PROFILE, { genAI });

    const sourceNodeIds = new Set(result.project.sources.find((source) => source.id === 'src_surgery_context')?.derived_node_ids ?? []);
    const sourceQuestions = result.project.nodes.filter((node) => sourceNodeIds.has(node.id) && node.type === 'UNKNOWN');
    const insuranceQuestions = sourceQuestions.filter((node) => /insurance|authorization/i.test(node.text) && node.status === 'OPEN');
    expect(insuranceQuestions).toHaveLength(1);
    expect(insuranceQuestions[0]?.text).toBe(modelQuestion);
    expect(sourceQuestions.some((node) => /insurance company told me/i.test(node.text))).toBe(false);
    expect(sourceQuestions.some((node) => /the user/i.test(node.text))).toBe(false);
    expect(sourceQuestions.map((node) => node.text)).toContain('What should I confirm before the surgery?');
    expect(rankGaps(result.project).some((gap) => /insurance company told me/i.test(gap.question))).toBe(false);
    expect(result.project.active_question?.question).not.toMatch(/insurance company told me/i);
    expect(genAI.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('keeps a usable status question when the model is unavailable', async () => {
    const genAI = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error('Vertex unavailable')),
      },
    } as any;
    const result = await processContextSource(projectWithGoal('Complete my surgery preparation.'), input({
      sourceId: 'src_unavailable_status',
      content: 'My insurance company told me the procedure authorization is still being reviewed.',
    }), DEFAULT_USER_PROFILE, { genAI });

    expect(result.error).toBe('Vertex unavailable');
    expect(result.project.nodes.some((node) =>
      node.type === 'UNKNOWN'
      && node.source_refs.includes('src_unavailable_status')
      && node.text === 'What current status is recorded for procedure authorization?'
    )).toBe(true);
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
      model: 'gemini-3.5-flash-lite',
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
