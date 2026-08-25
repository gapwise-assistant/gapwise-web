import { describe, expect, it } from 'vitest';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { buildDecisionMapDebugTrace } from './decisionMapDebug';
import { buildDecisionMapProjection } from './decisionMapProjection';
import {
  buildDecisionMapActivityFingerprint,
  decisionMapWarningCodes,
  summarizeDecisionMapActivity,
} from './decisionMapActivity';

describe('Decision Map Activity semantics', () => {
  const focus = {
    kind: 'decision' as const,
    title: 'Choose the bakery location',
    actionNodeId: 'bakery_location_decision',
    representedNodeIds: ['bakery_location_decision'],
    sourceNodeIds: ['bakery_location_decision'],
    sourceIds: ['bakery_launch_planning_notes'],
    score: 0.9,
    confidence: 0.8,
  };

  it('fingerprints semantic graph state independently of array order', () => {
    const project = createBakeryDemoProject();
    const reordered = {
      ...project,
      nodes: [...project.nodes].reverse(),
      edges: [...project.edges].reverse(),
    };

    expect(buildDecisionMapActivityFingerprint(project, focus)).toBe(
      buildDecisionMapActivityFingerprint(reordered, focus),
    );

    reordered.nodes[0] = { ...reordered.nodes[0], status: 'RESOLVED' };
    expect(buildDecisionMapActivityFingerprint(reordered, focus)).not.toBe(
      buildDecisionMapActivityFingerprint(project, focus),
    );
  });

  it('summarizes an activity without exposing raw graph data in the card model', () => {
    const project = createBakeryDemoProject();
    const debug = buildDecisionMapDebugTrace(project, {
      filter: 'all',
      selectedNodeId: null,
      focusMode: false,
      pathMode: false,
      focusAssessment: focus,
      projection: buildDecisionMapProjection(project, focus),
    });
    const summary = summarizeDecisionMapActivity({
      id: 'trace_1',
      userId: 'user_1',
      route: '/ui/decision-map',
      label: 'Decision Map activity',
      started_at: debug.capturedAt,
      duration_ms: 0,
      agentNames: [],
      contextIds: [],
      scores: [],
      toolCalls: [],
      decisionMapActivity: {
        projectId: project.id,
        type: 'map_built',
        fingerprint: 'semantic-fingerprint',
        trigger: 'Bakery Launch Planning Notes',
        change: 'Initial semantic graph captured.',
        focus: 'Choose the bakery location',
        warningCodes: [],
      },
      decisionMapDebug: debug,
    });

    expect(summary).toMatchObject({
      title: 'Map built',
      trigger: 'Bakery Launch Planning Notes',
      focus: 'Choose the bakery location',
      relationships: project.edges.length,
    });
    expect(summary).not.toHaveProperty('rawProjectGraph');
    expect(decisionMapWarningCodes(debug)).toEqual(expect.any(Array));
  });
});
