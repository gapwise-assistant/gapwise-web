import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { buildDecisionWorkspace, confirmDecision, findDecisionForNode } from '@/lib/decisions/workspace';

describe('decision workspace', () => {
  it('finds the decision blocked by an unresolved question', () => {
    const project = createGoldenDemoProject();
    const decision = findDecisionForNode(project, 'unknown_target_user');
    const workspace = buildDecisionWorkspace(project, 'unknown_target_user');

    expect(decision?.id).toBe('node_decision_track');
    expect(workspace?.decision.id).toBe('node_decision_track');
    expect(workspace?.remainingQuestions.map((item) => item.node.id)).toContain('unknown_target_user');
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
    expect(updated.nodes.find((node) => node.id === 'node_decision_track')?.text).toBe('Build the four-minute persona demo');
    expect(updated.nodes.find((node) => node.id === 'unknown_target_user')?.status).toBe('RESOLVED');
    expect(updated.edges.some((edge) => edge.source === 'node_decision_track' && edge.target === 'unknown_target_user' && edge.type === 'resolves')).toBe(true);
    expect(updated.history.at(-1)?.answer).toBe('Build the four-minute persona demo');
    expect(updated.clarity_score).not.toBe(project.clarity_score);
  });
});
