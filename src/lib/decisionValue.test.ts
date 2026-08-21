import { describe, expect, it } from 'vitest';
import { calculateDecisionValue } from '@/lib/decisionValue';
import { calculateGapPriority, selectTopGap } from '@/lib/prioritization';
import { decisionValueForTrace } from '@/lib/observability/decisionValueTrace';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { rankGaps } from '@/lib/tools/graphTools';
import type { ClarityNode, Project, UserMemoryProfile } from '@/types/clarity';

const profile: UserMemoryProfile = {
  answer_density: 'balanced',
  question_frequency: 'moderate',
  challenge_level: 'high',
  evidence_preference: 'research_first',
  brainstorm_style: 'direct_to_solution',
  uncertainty_style: 'explicit',
};

function node(
  id: string,
  type: ClarityNode['type'],
  text: string,
  overrides: Partial<ClarityNode> = {},
): ClarityNode {
  return {
    id,
    type,
    text,
    status: 'OPEN',
    confidence: type === 'UNKNOWN' ? 0.25 : 0.8,
    impact: 0.8,
    source_refs: [],
    created_by: 'agent',
    created_at: '2026-08-20T12:00:00.000Z',
    updated_at: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

function project(nodes: ClarityNode[], edges: Project['edges'] = []): Project {
  return {
    id: 'decision-value-test',
    title: 'Decision value test',
    goal: 'Choose the safest useful next step',
    deadline: '2026-08-27',
    clarity_score: 0,
    nodes,
    edges,
    sources: [],
    history: [],
    active_question: null,
    created_at: '2026-08-20T12:00:00.000Z',
    updated_at: '2026-08-20T12:00:00.000Z',
  };
}

describe('decision value', () => {
  it('keeps the Golden Demo target-persona blocker decision-relevant', () => {
    const [top] = rankGaps(createGoldenDemoProject());

    expect(top.node_id).toBe('unknown_target_user');
    expect(['medium', 'high']).toContain(top.decision_value?.level);
  });

  it('makes expected change in a live decision the strongest ranking signal', () => {
    const boundary = node('gap_boundary', 'UNKNOWN', 'Is the safety boundary acceptable?', { impact: 0.8 });
    const noise = node('gap_noise', 'UNKNOWN', 'What other implementation details exist?', { impact: 1 });
    const decision = node('decision_launch', 'DECISION', 'Decide whether to launch the pilot', { impact: 1, confidence: 0.5 });
    const lowTargets = Array.from({ length: 8 }, (_, index) =>
      node(`risk_${index}`, 'RISK', `Minor implementation risk ${index}`, { impact: 0.2 }),
    );
    const valueProject = project(
      [boundary, noise, decision, ...lowTargets],
      [
        { id: 'boundary_blocks_launch', source: boundary.id, target: decision.id, type: 'blocks' },
        ...lowTargets.map((target, index) => ({
          id: `noise_${index}`,
          source: noise.id,
          target: target.id,
          type: 'informs' as const,
        })),
      ],
    );

    const selected = selectTopGap(valueProject, profile);

    expect(selected?.node_id).toBe(boundary.id);
    expect(selected?.decision_value?.expected_action_change).toBe('could_flip_decision');
    expect(selected?.decision_value?.level).toBe('high');
  });

  it('does not reward duplicate edges or raw graph degree', () => {
    const gap = node('gap_budget', 'UNKNOWN', 'Is the budget acceptable?');
    const decision = node('decision_buy', 'DECISION', 'Decide whether to buy', { impact: 0.9 });
    const oneEdge = project([gap, decision], [
      { id: 'edge_1', source: gap.id, target: decision.id, type: 'blocks' },
    ]);
    const repeatedEdges = project([gap, decision], Array.from({ length: 12 }, (_, index) => ({
      id: `edge_${index}`,
      source: gap.id,
      target: decision.id,
      type: 'blocks' as const,
    })));

    const one = calculateDecisionValue(gap, oneEdge, profile, { now: new Date('2026-08-20T12:00:00Z') });
    const repeated = calculateDecisionValue(gap, repeatedEdges, profile, { now: new Date('2026-08-20T12:00:00Z') });

    expect(repeated.score).toBe(one.score);
    expect(repeated.meaningful_effect_count).toBe(1);
  });

  it('records the strongest relationship path and meaningful downstream targets', () => {
    const gap = node('gap_approval', 'UNKNOWN', 'Do we have approval to proceed?');
    const decision = node('decision_pilot', 'DECISION', 'Decide whether to run the clinic pilot', { impact: 0.95 });
    const goal = node('goal_outcome', 'GOAL', 'Reduce intake waiting time', { impact: 1 });
    const valueProject = project([gap, decision, goal], [
      { id: 'gap_blocks_decision', source: gap.id, target: decision.id, type: 'blocks' },
      { id: 'decision_affects_goal', source: decision.id, target: goal.id, type: 'affects' },
    ]);

    const result = calculateDecisionValue(gap, valueProject, profile, { now: new Date('2026-08-20T12:00:00Z') });

    expect(result.affected_targets.map((target) => target.node_id)).toEqual(['decision_pilot', 'goal_outcome']);
    expect(result.strongest_path?.path_node_ids).toEqual(['gap_approval', 'decision_pilot']);
    expect(result.strongest_path?.relationship).toBe('blocks');
    expect(result.reason).toContain('Decide whether to run the clinic pilot');
  });

  it('keeps disconnected questions low even when their node impact is high', () => {
    const gap = node('gap_orphan', 'UNKNOWN', 'What else should we learn?', { impact: 1, confidence: 0.05 });
    const result = calculateDecisionValue(gap, project([gap]), profile, {
      now: new Date('2026-08-20T12:00:00Z'),
    });

    expect(result.level).toBe('none');
    expect(result.expected_action_change).toBe('same_action');
    expect(result.affected_targets).toEqual([]);
    expect(result.score).toBeLessThanOrEqual(0.21);
  });

  it('separates deadline urgency from structural leverage', () => {
    const gap = node('gap_timing', 'UNKNOWN', 'When is the approval available?');
    const action = node('action_submit', 'NEXT_ACTION', 'Submit the pilot request', { impact: 0.9 });
    const base = project([gap, action], [
      { id: 'gap_blocks_action', source: gap.id, target: action.id, type: 'blocks' },
    ]);
    const later = { ...base, deadline: '2026-12-20' };

    const urgentValue = calculateDecisionValue(gap, base, profile, { now: new Date('2026-08-26T12:00:00Z') });
    const laterValue = calculateDecisionValue(gap, later, profile, { now: new Date('2026-08-20T12:00:00Z') });

    expect(urgentValue.structural_leverage).toBe(laterValue.structural_leverage);
    expect(urgentValue.urgency_contribution).toBeGreaterThan(laterValue.urgency_contribution);
    expect(urgentValue.score).toBeGreaterThan(laterValue.score);
  });

  it('makes answer cost and evidence inspectable without overriding structural impact', () => {
    const preferenceGap = node('gap_preference', 'UNKNOWN', 'Is this tradeoff acceptable given my preference?', {
      source_refs: ['source_preferences'],
    });
    const experimentGap = node('gap_experiment', 'UNKNOWN', 'What benchmark experiment must we run to measure this?');
    const decision = node('decision_choose', 'DECISION', 'Decide which option to choose', { impact: 0.9 });
    const valueProject = project([preferenceGap, experimentGap, decision], [
      { id: 'preference_blocks', source: preferenceGap.id, target: decision.id, type: 'blocks' },
      { id: 'experiment_informs', source: experimentGap.id, target: decision.id, type: 'informs' },
    ]);
    valueProject.sources.push({
      id: 'source_preferences',
      filename: 'preferences.txt',
      type: 'text',
      content: 'The user recorded the relevant preference.',
      extracted_at: '2026-08-20T12:00:00.000Z',
      derived_node_ids: [preferenceGap.id],
    });

    const preference = calculateGapPriority(preferenceGap, valueProject, profile, {
      now: new Date('2026-08-20T12:00:00Z'),
    });
    const experiment = calculateGapPriority(experimentGap, valueProject, profile, {
      now: new Date('2026-08-20T12:00:00Z'),
    });

    expect(preference.decision_value?.acquisition_difficulty).toBe('low');
    expect(preference.decision_value?.evidence_strength).toBe('partial');
    expect(experiment.decision_value?.acquisition_difficulty).toBe('high');
    expect(preference.priority).toBeGreaterThan(experiment.priority);
  });

  it('excludes resolved downstream decisions from current value', () => {
    const gap = node('gap_resolved_target', 'UNKNOWN', 'Is the old plan acceptable?');
    const decision = node('decision_done', 'DECISION', 'Choose the completed plan', {
      impact: 1,
      status: 'RESOLVED',
    });
    const result = calculateDecisionValue(gap, project([gap, decision], [
      { id: 'old_block', source: gap.id, target: decision.id, type: 'blocks' },
    ]), profile, { now: new Date('2026-08-20T12:00:00Z') });

    expect(result.affected_targets).toEqual([]);
    expect(result.level).toBe('none');
  });

  it('records explicit downstream reversibility and produces a sanitized trace summary', () => {
    const gap = node('gap_contract', 'ASSUMPTION', 'Can we accept the binding contract terms?', {
      confidence: 0.55,
    });
    const decision = node('decision_sign', 'DECISION', 'Decide whether to sign the binding contract', {
      impact: 1,
      why_it_matters: ['Signing the contract cannot be undone without a termination penalty.'],
    });
    const valueProject = project([gap, decision], [
      { id: 'contract_blocks_signing', source: gap.id, target: decision.id, type: 'blocks' },
    ]);

    const candidate = calculateGapPriority(gap, valueProject, profile, {
      now: new Date('2026-08-20T12:00:00Z'),
    });
    const trace = decisionValueForTrace(candidate);

    expect(candidate.decision_value?.downstream_reversibility).toBe('hard_to_reverse');
    expect(trace).toEqual(expect.objectContaining({
      level: candidate.decision_value?.level,
      expectedActionChange: 'could_flip_decision',
      downstreamReversibility: 'hard_to_reverse',
      strongestPathNodeIds: ['gap_contract', 'decision_sign'],
    }));
    expect(JSON.stringify(trace)).not.toContain('cannot be undone');
    expect(JSON.stringify(trace)).not.toContain('Decide whether to sign');
  });
});
