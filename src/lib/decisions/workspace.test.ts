import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { buildDecisionWorkspace, confirmDecision, decisionQuestionForDisplay, findDecisionForNode } from '@/lib/decisions/workspace';

describe('decision workspace', () => {
  it('finds the decision blocked by an unresolved question', () => {
    const project = createGoldenDemoProject();
    const decision = findDecisionForNode(project, 'unknown_target_user');
    const workspace = buildDecisionWorkspace(project, 'unknown_target_user');

    expect(decision?.id).toBe('node_decision_track');
    expect(workspace?.decision.id).toBe('node_decision_track');
    expect(workspace?.decisionInputs.map((item) => item.node.id)).toContain('unknown_target_user');
  });

  it('shows a recommendation only when explicit options have separated evidence', () => {
    const project = createGoldenDemoProject();
    project.nodes.find((node) => node.id === 'unknown_target_user')!.status = 'RESOLVED';
    project.nodes.find((node) => node.id === 'unknown_pricing')!.status = 'RESOLVED';
    project.nodes.push(
      {
        ...project.nodes[0],
        id: 'option_a',
        type: 'KNOWN',
        text: 'Option A: Lower rent',
        confidence: 0.95,
        source_refs: ['src_1'],
      },
      {
        ...project.nodes[0],
        id: 'option_b',
        type: 'KNOWN',
        text: 'Option B: Shorter commute',
        confidence: 0.7,
        source_refs: ['src_3'],
      },
    );
    project.edges.push(
      { id: 'option_edge_a', source: 'option_a', target: 'node_decision_track', type: 'supports' },
      { id: 'option_edge_b', source: 'option_b', target: 'node_decision_track', type: 'supports' },
    );

    const workspace = buildDecisionWorkspace(project, 'node_decision_track');

    expect(workspace?.options.map((option) => option.label)).toEqual(['Option A', 'Option B']);
    expect(workspace?.recommendation?.option.label).toBe('Option A');
    expect(workspace?.sources.map((source) => source.filename)).toEqual(expect.arrayContaining(['hackathon-rules.pdf', 'arch-sketch.png']));
  });

  it('confirms an existing decision without creating a duplicate and can resolve its blocker', () => {
    const project = createGoldenDemoProject();
    const updated = confirmDecision(project, {
      decisionNodeId: 'unknown_target_user',
      customDecision: 'Build the four-minute persona demo',
      reason: 'The target persona is now explicit enough to commit.',
      resolveQuestionIds: ['unknown_target_user'],
    });

    expect(updated.nodes.filter((node) => node.type === 'DECISION')).toHaveLength(1);
    expect(updated.nodes.find((node) => node.id === 'node_decision_track')?.text).toBe('Build Gapwise: Find the question that unlocks the next decision');
    expect(updated.nodes.find((node) => node.id === 'node_decision_track')?.decision_outcome).toBe('Build the four-minute persona demo');
    expect(updated.nodes.find((node) => node.id === 'unknown_target_user')?.status).toBe('RESOLVED');
    expect(updated.edges.some((edge) => edge.source === 'node_decision_track' && edge.target === 'unknown_target_user' && edge.type === 'resolves')).toBe(true);
    expect(updated.history.at(-1)?.answer).toBe('Build the four-minute persona demo');
    expect(updated.clarity_score).not.toBe(project.clarity_score);
  });

  it('uses the original decision question as the display title after confirmation', () => {
    const project = createGoldenDemoProject();
    const updated = confirmDecision(project, {
      decisionNodeId: 'node_decision_track',
      customDecision: 'Ask a helper to act as a spotter.',
    });
    const decision = updated.nodes.find((node) => node.id === 'node_decision_track');

    expect(decision).toBeDefined();
    expect(decision?.text).toBe('Build Gapwise: Find the question that unlocks the next decision');
    expect(decision?.decision_outcome).toBe('Ask a helper to act as a spotter.');
    expect(decisionQuestionForDisplay(updated, decision!)).toBe('Build Gapwise: Find the question that unlocks the next decision');
  });

  it('prefers the recorded outcome and updates the same decision history entry when edited', () => {
    const project = createGoldenDemoProject();
    const decision = project.nodes.find((node) => node.id === 'node_decision_track')!;
    decision.decision_outcome = 'Build the first workflow.';
    project.history = [{
      question: decision.text,
      answer: 'Build the first workflow.',
      timestamp: '2026-08-20T10:00:00.000Z',
      graph_diff_summary: 'Decision confirmed.',
      nodeId: decision.id,
      projectId: project.id,
    }];

    const updated = confirmDecision(project, {
      decisionNodeId: decision.id,
      customDecision: 'Build the focused partner workflow.',
      historyTimestamp: '2026-08-20T10:00:00.000Z',
    });

    expect(updated.nodes.find((node) => node.id === decision.id)).toMatchObject({
      text: decision.text,
      decision_outcome: 'Build the focused partner workflow.',
      status: 'RESOLVED',
    });
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0]).toMatchObject({
      nodeId: decision.id,
      projectId: project.id,
      answer: 'Build the focused partner workflow.',
    });
  });

  it('closes a NEXT_ACTION whose explicitly linked decision is confirmed', () => {
    const project = createGoldenDemoProject();
    const decision = project.nodes.find((node) => node.id === 'node_decision_track')!;
    decision.status = 'OPEN';
    project.nodes.push({
      ...decision,
      id: 'action_choose_track',
      type: 'NEXT_ACTION',
      text: 'Choose the project track.',
      status: 'OPEN',
    });
    project.edges.push({
      id: 'edge_action_choose_track',
      source: 'action_choose_track',
      target: decision.id,
      type: 'satisfies',
    });

    const updated = confirmDecision(project, {
      decisionNodeId: decision.id,
      customDecision: 'Build the Gapwise collaborative partner.',
    });

    expect(updated.nodes.find((item) => item.id === 'action_choose_track')?.status).toBe('RESOLVED');
  });

  it('does not leave an equivalent open decision actionable after canonical confirmation', () => {
    const project = createGoldenDemoProject();
    const canonical = project.nodes.find((node) => node.id === 'node_decision_track')!;
    project.nodes.push({
      ...canonical,
      id: 'decision_track_alias',
      text: 'Choose the project direction.',
      status: 'OPEN',
      canonical_node_id: canonical.id,
      reconciliation_classification: 'EQUIVALENT',
    });

    const updated = confirmDecision(project, {
      decisionNodeId: 'decision_track_alias',
      customDecision: 'Build the collaborative partner.',
    });

    expect(updated.nodes.find((node) => node.id === canonical.id)?.status).toBe('RESOLVED');
    expect(updated.nodes.find((node) => node.id === 'decision_track_alias')?.status).toBe('DEPRECATED');
  });
});
