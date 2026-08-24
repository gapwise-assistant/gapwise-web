import { describe, expect, it } from 'vitest';
import type { ClarityNode, DecisionValueAssessment, Project } from '@/types/clarity';
import { createDeterministicGapGuidance } from '@/lib/agents/gapGuidance';

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
    confidence: type === 'UNKNOWN' ? 0.2 : 0.9,
    impact: 0.8,
    source_refs: [],
    created_by: 'agent',
    created_at: '2026-08-23T12:00:00.000Z',
    updated_at: '2026-08-23T12:00:00.000Z',
    ...overrides,
  };
}

function project(nodes: ClarityNode[], edges: Project['edges'] = [], deadline?: string): Project {
  return {
    id: 'guidance-test',
    title: 'Guidance test',
    goal: 'Prepare a reliable first launch',
    ...(deadline ? { deadline } : {}),
    clarity_score: 0,
    nodes,
    edges,
    sources: [],
    history: [],
    active_question: null,
    created_at: '2026-08-23T12:00:00.000Z',
    updated_at: '2026-08-23T12:00:00.000Z',
  };
}

function value(overrides: Partial<DecisionValueAssessment> = {}): DecisionValueAssessment {
  return {
    score: 0.8,
    level: 'high',
    expected_action_change: 'could_flip_decision',
    structural_leverage: 0.8,
    affected_targets: [],
    strongest_path: null,
    urgency_contribution: 0.2,
    answerability_contribution: 0.7,
    acquisition_cost: 0.3,
    acquisition_difficulty: 'medium',
    evidence_strength: 'none',
    downstream_reversibility: 'unknown',
    meaningful_effect_count: 0,
    reason: 'The answer may change the next project choice.',
    ...overrides,
  };
}

describe('deterministic Gap guidance', () => {
  it('uses the linked decision and does not invent a deadline', () => {
    const gap = node('gap_demand', 'UNKNOWN', 'Would local creators pay for regular access?');
    const decision = node(
      'decision_model',
      'DECISION',
      'Choose between memberships and one-off workshops',
      { why_it_matters: ['Determines whether the project can provide predictable monthly income.'] },
    );
    const state = project([gap, decision], [
      { id: 'edge_demand_model', source: gap.id, target: decision.id, type: 'informs' },
    ]);
    const guidance = createDeterministicGapGuidance({
      node: gap,
      project: state,
      decisionValue: value({
        strongest_path: {
          node_id: decision.id,
          node_type: 'DECISION',
          label: decision.text,
          importance: 0.9,
          relationship: 'informs',
          path_node_ids: [gap.id, decision.id],
          path_edge_ids: ['edge_demand_model'],
        },
      }),
    });

    expect(guidance.whyNow).toContain('predictable monthly income');
    expect(guidance.whyNow).not.toContain('project deadline');
    expect(guidance.nextStep).toContain(gap.text.replace('?', ''));
    expect(guidance.whatCouldChange).toMatch(/If .*; if not,/i);
    expect(guidance.whyNow).not.toMatch(/strongest unresolved input/i);
    expect(guidance.nextStep).not.toMatch(/review the linked evidence/i);
  });

  it('connects a standalone uncertainty to the project goal', () => {
    const gap = node('gap_backup', 'UNKNOWN', 'What backup exists before the first launch?');
    const state = project([gap]);
    const guidance = createDeterministicGapGuidance({
      node: gap,
      project: state,
      decisionValue: value({
        strongest_path: null,
        expected_action_change: 'same_action',
      }),
    });

    expect(guidance.whyNow).toContain(state.goal);
    expect(guidance.nextStep).toContain(gap.text.replace('?', ''));
    expect(guidance.whatCouldChange).toContain(state.goal);
    expect(guidance.whyNow).not.toContain('before the project deadline');
  });

  it('uses a linked next action as the concrete next step', () => {
    const gap = node('gap_test', 'UNKNOWN', 'Does the import work with the real file?');
    const action = node('action_test', 'NEXT_ACTION', 'Run the import against the real file');
    const decision = node('decision_release', 'DECISION', 'Decide whether to release the workflow');
    const state = project([gap, action, decision], [
      { id: 'edge_gap_action', source: gap.id, target: action.id, type: 'depends_on' },
      { id: 'edge_action_decision', source: action.id, target: decision.id, type: 'informs' },
    ]);
    const guidance = createDeterministicGapGuidance({
      node: gap,
      project: state,
      decisionValue: value({
        strongest_path: {
          node_id: decision.id,
          node_type: 'DECISION',
          label: decision.text,
          importance: 0.9,
          relationship: 'depends_on',
          path_node_ids: [gap.id, action.id, decision.id],
          path_edge_ids: ['edge_gap_action', 'edge_action_decision'],
        },
      }),
    });

    expect(guidance.nextStep).toContain(action.text.replace(' ', ' '));
    expect(guidance.nextStep).not.toMatch(/record the answer|review the linked evidence/i);
  });

  it('mentions a real deadline when one exists', () => {
    const gap = node('gap_deadline', 'UNKNOWN', 'Is the final test complete?');
    const state = project([gap], [], '2026-09-12');
    const guidance = createDeterministicGapGuidance({
      node: gap,
      project: state,
      decisionValue: value({ strongest_path: null }),
    });

    expect(guidance.whyNow).toContain('September 12, 2026');
  });
});
