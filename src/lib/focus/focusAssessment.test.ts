import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { calculateAttentionScore } from '@/lib/attention/scoring';
import { focusActionNodeForAssessment, focusAssessmentToGuidance } from '@/lib/focus/presentation';
import { focusAssessmentPromptSection, generateFocusAssessment } from '@/lib/focus/focusAssessment';
import { focusProjectStateVersion, getCachedFocusAssessment } from '@/lib/focus/focusCache';
import { RecommendedFocus } from '@/components/RecommendedFocus';
import type { FocusAssessmentCacheRecord, StorageProvider } from '@/lib/storage/types';

const generateContent = vi.fn();
vi.mock('@/lib/google/genai', () => ({
  getVertexGenAIClient: () => ({ models: { generateContent } }),
}));

describe('shared Focus Assessment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GAPSWISE_DEMO_MODE;
  });

  it('gives Today and focus-related Ask the same derived priority without persisting it', async () => {
    const project = createProjectFromInput({
      name: 'Community repair exchange',
      goal: 'Launch a useful neighborhood repair exchange without committing to an unneeded format.',
    }, '2026-08-23T10:00:00.000Z');
    project.nodes.push({
      id: 'decision_schedule',
      type: 'DECISION',
      text: 'Choose whether exchanges happen weekly or monthly.',
      status: 'OPEN',
      confidence: 0.9,
      impact: 0.92,
      source_refs: ['source_notes'],
      created_by: 'user',
      created_at: project.created_at,
      updated_at: project.updated_at,
    });
    project.sources.push({
      id: 'source_notes',
      filename: 'initial-notes.txt',
      type: 'note',
      content: 'The organizer has not yet checked whether neighbors would participate or which repair problems they have.',
      extracted_at: project.created_at,
      derived_node_ids: ['decision_schedule'],
      processing_status: 'completed',
    });
    const contextPack = buildContextPack({
      userId: 'focus-user',
      query: 'What needs my attention today?',
      project,
      profile: DEFAULT_USER_PROFILE,
      includeBroadContext: true,
    });
    const before = JSON.stringify(project);
    const factors = {
      goal_alignment: 0.98,
      impact: 0.95,
      urgency: 0.72,
      actionability: 0.96,
      evidence_confidence: 0.85,
      unresolved_risk: 0.95,
      momentum: 0.9,
      estimated_effort: 0.18,
    };
    generateContent.mockResolvedValue({ text: JSON.stringify({
      candidates: [{
        kind: 'action',
        title: 'Test whether neighbors have enough demand before fixing the recurring schedule.',
        nextAction: 'Invite a small group to one trial exchange and record participation and repair needs.',
        whyNow: 'Demand is still unverified, so schedule optimization would commit logistics before validating the premise.',
        sourceNodeIds: ['decision_schedule'],
        sourceIds: ['source_notes'],
        actionNodeId: 'decision_schedule',
        confidence: 0.88,
        factors,
      }],
    }) });

    const assessment = await generateFocusAssessment(project, contextPack, DEFAULT_USER_PROFILE);

    expect(assessment?.kind).toBe('action');
    expect(assessment?.actionNodeId).toBe('decision_schedule');
    expect(assessment?.score).toBe(calculateAttentionScore(factors));
    const actionNode = focusActionNodeForAssessment(project, assessment);
    const todayMarkup = renderToStaticMarkup(React.createElement(RecommendedFocus, {
      guidance: focusAssessmentToGuidance(assessment!),
      ...(actionNode?.type === 'DECISION' ? { onDecide: vi.fn() } : {}),
    }));
    expect(todayMarkup).toContain(assessment!.title);
    expect(todayMarkup).toContain('Decide');
    expect(focusAssessmentPromptSection(assessment, true)).toContain(`Title: ${assessment!.title}`);
    expect(focusAssessmentPromptSection(assessment, true)).toContain('Action node ID: decision_schedule');
    expect(focusAssessmentPromptSection(assessment, true)).toContain('selected current project priority');
    const derivedPrompt = JSON.stringify(generateContent.mock.calls[0]);
    expect(derivedPrompt).toContain('sourceNodeIds are supporting provenance and must not be treated as the action target');
    expect(derivedPrompt).toContain('Do not use a generic planning or prioritization action as actionNodeId');
    expect(JSON.stringify(project)).toBe(before);
  });

  it('does not treat provenance as an action target when actionNodeId is absent', () => {
    const project = createProjectFromInput({ name: 'Pricing check', goal: 'Choose a viable initial price.' });
    project.nodes.push({
      id: 'pricing_decision',
      type: 'DECISION',
      text: 'Determine the pricing strategy.',
      status: 'OPEN',
      confidence: 0.9,
      impact: 0.9,
      source_refs: [],
      created_by: 'user',
      created_at: project.created_at,
      updated_at: project.updated_at,
    });

    expect(focusActionNodeForAssessment(project, {
      kind: 'action',
      title: 'Evaluate the initial price.',
      sourceNodeIds: ['pricing_decision'],
      sourceIds: [],
      score: 0.8,
      confidence: 0.9,
    })).toBeNull();
  });

  it('selects an actionable prerequisite over a higher-scoring blocked derived focus', async () => {
    const project = createProjectFromInput({ name: 'Meal pricing', goal: 'Set a profitable initial meal price.' });
    const timestamp = project.created_at;
    project.nodes.push({
      id: 'cost_question', type: 'UNKNOWN', text: 'What is the actual cost per meal?', status: 'OPEN',
      confidence: 0.4, impact: 0.75, source_refs: [], created_by: 'user', created_at: timestamp, updated_at: timestamp,
    }, {
      id: 'pricing_decision', type: 'DECISION', text: 'Set the initial meal price.', status: 'OPEN',
      confidence: 0.9, impact: 0.98, source_refs: [], created_by: 'user', created_at: timestamp, updated_at: timestamp,
    });
    project.edges.push({ id: 'cost_blocks_price', source: 'cost_question', target: 'pricing_decision', type: 'blocks' });
    const contextPack = buildContextPack({
      userId: 'focus-user', query: 'What needs my attention today?', project, profile: DEFAULT_USER_PROFILE,
    });
    generateContent.mockResolvedValue({ text: JSON.stringify({ candidates: [{
      kind: 'decision',
      title: 'Set the initial meal price now.',
      nextAction: 'Choose the price.',
      whyNow: 'Pricing has high impact.',
      sourceNodeIds: ['pricing_decision'],
      sourceIds: [],
      actionNodeId: 'pricing_decision',
      confidence: 0.95,
      factors: {
        goal_alignment: 1, impact: 1, urgency: 1, actionability: 1,
        evidence_confidence: 1, unresolved_risk: 1, momentum: 1, estimated_effort: 0.05,
      },
    }] }) });

    const assessment = await generateFocusAssessment(project, contextPack, DEFAULT_USER_PROFILE);

    expect(assessment?.actionNodeId).toBe('cost_question');
    expect(assessment?.title).toBe('What is the actual cost per meal?');
    const prompt = JSON.stringify(generateContent.mock.calls[0]);
    expect(prompt).toContain('cost_question');
    expect(prompt).toContain('pricing_decision');
    expect(prompt).toContain('blocks');
    expect(prompt).toContain('For depends_on, the source depends on the target. For blocks, the source blocks the target.');
  });

  it('rejects a derived recommendation that explicitly targets a satisfied NEXT_ACTION', async () => {
    const project = createProjectFromInput({ name: 'Cooking workshop', goal: 'Launch a viable paid workshop.' });
    const timestamp = project.created_at;
    project.nodes.push({
      id: 'venue', type: 'DECISION', text: 'Use Riverside Kitchen.', status: 'RESOLVED',
      confidence: 1, impact: 0.9, source_refs: [], created_by: 'user', created_at: timestamp, updated_at: timestamp,
    }, {
      id: 'venue_action', type: 'NEXT_ACTION', text: 'Decide which venue model to use.', status: 'OPEN',
      confidence: 0.9, impact: 0.95, source_refs: [], created_by: 'agent', created_at: timestamp, updated_at: timestamp,
    }, {
      id: 'pricing', type: 'DECISION', text: 'Determine the ticket price.', status: 'OPEN',
      confidence: 0.8, impact: 0.85, source_refs: [], created_by: 'user', created_at: timestamp, updated_at: timestamp,
    });
    project.edges.push({ id: 'venue_action_outcome', source: 'venue_action', target: 'venue', type: 'satisfies' });
    const contextPack = buildContextPack({
      userId: 'focus-user', query: 'What needs my attention today?', project, profile: DEFAULT_USER_PROFILE,
    });
    generateContent.mockResolvedValue({ text: JSON.stringify({ candidates: [{
      kind: 'action',
      title: 'Choose the venue model.',
      nextAction: 'Decide which venue to use.',
      whyNow: 'The venue matters.',
      sourceNodeIds: ['venue_action', 'venue'],
      sourceIds: [],
      actionNodeId: 'venue_action',
      confidence: 1,
      factors: {
        goal_alignment: 1, impact: 1, urgency: 1, actionability: 1,
        evidence_confidence: 1, unresolved_risk: 1, momentum: 1, estimated_effort: 0,
      },
    }] }) });

    const assessment = await generateFocusAssessment(project, contextPack, DEFAULT_USER_PROFILE);

    expect(assessment?.actionNodeId).toBe('pricing');
    expect(assessment?.title).toBe('Determine the ticket price.');
  });

  it('reuses the cached assessment when a meta chat source is added without semantic graph changes', async () => {
    const project = createProjectFromInput({ name: 'Pop-up cinema', goal: 'Validate a useful first screening.' });
    const contextPack = buildContextPack({
      userId: 'focus-user',
      query: 'What needs my attention today?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });
    const records = new Map<string, FocusAssessmentCacheRecord>();
    const storage = {
      getFocusAssessment: vi.fn(async (_userId: string, id: string) => records.get(id) ?? null),
      saveFocusAssessment: vi.fn(async (_userId: string, record: FocusAssessmentCacheRecord) => {
        records.set(record.id, record);
      }),
    } as unknown as StorageProvider;
    const generated = {
      kind: 'discovery' as const,
      title: 'Check whether the intended audience will attend one trial screening.',
      sourceNodeIds: [],
      sourceIds: [],
      score: 0.82,
      confidence: 0.9,
    };
    const generate = vi.fn(async () => generated);

    const todayFocus = await getCachedFocusAssessment('focus-user', project, contextPack, DEFAULT_USER_PROFILE, { storage, generate });
    const initialVersion = await focusProjectStateVersion(project, contextPack, DEFAULT_USER_PROFILE);
    project.sources.push({
      id: 'ask_meta_message',
      filename: 'Ask follow-up.txt',
      type: 'note',
      content: 'Why is that the most important thing to focus on?',
      extracted_at: '2026-08-23T11:00:00.000Z',
      processed_at: '2026-08-23T11:00:01.000Z',
      derived_node_ids: [],
      processing_status: 'completed',
      origin: 'user',
    });
    project.updated_at = '2026-08-23T11:00:01.000Z';
    const contextAfterMetaMessage = buildContextPack({
      userId: 'focus-user',
      query: 'What needs my attention today?',
      project,
      profile: DEFAULT_USER_PROFILE,
      includeBroadContext: true,
    });
    const afterMetaVersion = await focusProjectStateVersion(project, contextAfterMetaMessage, DEFAULT_USER_PROFILE);
    const askFocus = await getCachedFocusAssessment('focus-user', project, contextAfterMetaMessage, DEFAULT_USER_PROFILE, { storage, generate });

    expect(afterMetaVersion).toBe(initialVersion);
    expect(askFocus).toEqual(todayFocus);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cached assessment when a new evidence node changes semantic project state', async () => {
    const project = createProjectFromInput({ name: 'Tool library', goal: 'Validate a useful neighborhood tool library.' });
    const initialPack = buildContextPack({ userId: 'focus-user', query: 'What needs my attention today?', project, profile: DEFAULT_USER_PROFILE });
    const records = new Map<string, FocusAssessmentCacheRecord>();
    const storage = {
      getFocusAssessment: vi.fn(async (_userId: string, id: string) => records.get(id) ?? null),
      saveFocusAssessment: vi.fn(async (_userId: string, record: FocusAssessmentCacheRecord) => records.set(record.id, record)),
    } as unknown as StorageProvider;
    const generate = vi.fn(async () => ({
      kind: 'discovery' as const,
      title: `Generated focus ${generate.mock.calls.length}`,
      sourceNodeIds: [],
      sourceIds: [],
      score: 0.8,
      confidence: 0.9,
    }));

    const beforeVersion = await focusProjectStateVersion(project, initialPack, DEFAULT_USER_PROFILE);
    await getCachedFocusAssessment('focus-user', project, initialPack, DEFAULT_USER_PROFILE, { storage, generate });
    project.nodes.push({
      id: 'evidence_interest',
      type: 'EVIDENCE',
      text: 'Nine of twelve surveyed neighbors said they would use the tool library.',
      status: 'OPEN',
      confidence: 0.95,
      impact: 0.85,
      source_refs: ['survey_notes'],
      created_by: 'user',
      created_at: '2026-08-23T12:00:00.000Z',
      updated_at: '2026-08-23T12:00:00.000Z',
    });
    const updatedPack = buildContextPack({ userId: 'focus-user', query: 'What needs my attention today?', project, profile: DEFAULT_USER_PROFILE });
    const afterVersion = await focusProjectStateVersion(project, updatedPack, DEFAULT_USER_PROFILE);
    await getCachedFocusAssessment('focus-user', project, updatedPack, DEFAULT_USER_PROFILE, { storage, generate });

    expect(afterVersion).not.toBe(beforeVersion);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
