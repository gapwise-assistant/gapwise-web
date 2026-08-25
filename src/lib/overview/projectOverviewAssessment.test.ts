import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import {
  buildProjectOverviewReasoningPackage,
  generateProjectOverviewAssessment,
  type ProjectOverviewAssessment,
} from '@/lib/overview/projectOverviewAssessment';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import type { ProjectHistoryEvent } from '@/types/clarity';

const generateContent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/google/genai', () => ({
  getVertexGenAIClient: () => ({ models: { generateContent } }),
}));

function addNode(
  project: ReturnType<typeof createProjectFromInput>,
  node: {
    id: string;
    type: 'DECISION' | 'UNKNOWN' | 'RISK' | 'KNOWN' | 'NEXT_ACTION';
    text: string;
    status?: 'OPEN' | 'RESOLVED' | 'DEPRECATED';
    impact?: number;
  },
) {
  project.nodes.push({
    id: node.id,
    type: node.type,
    text: node.text,
    status: node.status ?? 'OPEN',
    confidence: 0.9,
    impact: node.impact ?? 0.8,
    source_refs: [],
    created_by: 'agent',
    created_at: project.created_at,
    updated_at: project.updated_at,
  });
}

function assessment(): ProjectOverviewAssessment {
  return {
    trajectory: {
      state: 'taking_shape',
      explanation: 'The project has a defined direction while one important uncertainty remains open.',
    },
    summary: 'The project has a clear direction and is moving from planning toward execution.',
    meaningfulChanges: [],
    goalImpact: {
      summary: 'Recent evidence makes the next step clearer.',
      positiveFactors: [],
      negativeFactors: [],
    },
    unsettled: [],
    criticalIssues: [],
    emergingInsights: [],
    confidence: 0.8,
  };
}

function focusFor(nodeId: string): FocusAssessment {
  return {
    kind: 'question',
    title: 'Resolve the most important open question.',
    sourceNodeIds: [nodeId],
    sourceIds: [],
    actionNodeId: nodeId,
    score: 0.9,
    confidence: 0.9,
  };
}

describe('Project Overview Assessment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a bounded package that retains goal, focus, open, and recent project state', () => {
    const project = createProjectFromInput({
      name: 'Pilot rollout',
      goal: 'Launch a dependable pilot for the first customers.',
    }, '2026-08-24T10:00:00.000Z');
    addNode(project, {
      id: 'open-decision',
      type: 'DECISION',
      text: 'Choose the first pilot scope.',
      impact: 0.98,
    });
    addNode(project, {
      id: 'recent-risk',
      type: 'RISK',
      text: 'The test environment may not support the pilot load.',
      impact: 0.95,
    });
    project.edges.push({
      id: 'goal-to-decision',
      source: project.nodes[0].id,
      target: 'open-decision',
      type: 'affects',
    });
    const historyEvent: ProjectHistoryEvent = {
      id: 'history-scope',
      projectId: project.id,
      createdAt: '2026-08-24T11:00:00.000Z',
      type: 'decision_resolved',
      title: 'Pilot scope changed',
      summary: 'The pilot scope was narrowed after a review.',
      sourceNodeIds: ['open-decision'],
      affectedNodeIds: ['open-decision'],
      changes: [{
        kind: 'updated',
        nodeId: 'open-decision',
        text: 'Choose the first pilot scope.',
      }],
    };

    const reasoningPackage = buildProjectOverviewReasoningPackage(
      project,
      [historyEvent],
      focusFor('open-decision'),
      undefined,
    );

    expect(reasoningPackage.project.goal).toContain('dependable pilot');
    expect(reasoningPackage.canonicalNodes.some((node) => node.id === 'open-decision')).toBe(true);
    expect(reasoningPackage.currentFocus?.actionNodeId).toBe('open-decision');
    expect(reasoningPackage.recentHistory.map((event) => event.id)).toContain('history-scope');
    expect(reasoningPackage.canonicalRelationships).toEqual([
      { source: project.nodes[0].id, target: 'open-decision', type: 'affects' },
    ]);

    for (let index = 0; index < 50; index += 1) {
      addNode(project, {
        id: `fact-${index}`,
        type: 'KNOWN',
        text: `Additional project fact ${index}.`,
        impact: 0.1,
      });
    }
    const bounded = buildProjectOverviewReasoningPackage(project, [historyEvent], focusFor('open-decision'));
    expect(bounded.canonicalNodes.length).toBeLessThanOrEqual(40);
  });

  it('keeps only grounded assessment items and rejects unsupported references', async () => {
    const project = createProjectFromInput({
      name: 'Pilot rollout',
      goal: 'Launch a dependable pilot for the first customers.',
    }, '2026-08-24T10:00:00.000Z');
    addNode(project, {
      id: 'open-risk',
      type: 'RISK',
      text: 'The pilot may miss the reliability target.',
    });
    addNode(project, {
      id: 'known-progress',
      type: 'KNOWN',
      text: 'The core workflow works in the test environment.',
      status: 'RESOLVED',
    });
    addNode(project, {
      id: 'open-question',
      type: 'UNKNOWN',
      text: 'Will the pilot meet the reliability target?',
    });
    addNode(project, {
      id: 'next-action',
      type: 'NEXT_ACTION',
      text: 'Run the reliability test.',
    });
    const historyEvent: ProjectHistoryEvent = {
      id: 'history-test',
      projectId: project.id,
      createdAt: '2026-08-24T11:00:00.000Z',
      type: 'context_changed',
      title: 'Test result recorded',
      sourceNodeIds: ['known-progress'],
      affectedNodeIds: ['open-risk'],
      changes: [{ kind: 'learned', nodeId: 'known-progress', text: 'The core workflow works in the test environment.' }],
    };
    generateContent.mockResolvedValue({ text: JSON.stringify({
      trajectory: {
        state: 'moving_forward',
        explanation: 'The core workflow is working, but reliability still needs attention.',
      },
      summary: 'The pilot is becoming more concrete while reliability remains the central concern.',
      meaningfulChanges: [
        {
          title: 'Core workflow tested',
          whatChanged: 'A test confirmed the main workflow works.',
          consequence: 'This removes one implementation uncertainty.',
          sourceNodeIds: ['known-progress', 'unknown-node'],
          historyEventIds: ['history-test'],
        },
        {
          title: 'Unsupported change',
          whatChanged: 'This should not survive validation.',
          consequence: 'It has no grounded project evidence.',
          sourceNodeIds: ['unknown-node'],
          historyEventIds: ['missing-history'],
        },
      ],
      goalImpact: {
        summary: 'The test helps, but the open risk remains.',
        positiveFactors: [
          { text: 'The core workflow is working.', sourceNodeIds: ['known-progress'] },
          { text: 'Unsupported factor.', sourceNodeIds: ['unknown-node'] },
        ],
        negativeFactors: [
          { text: 'Reliability is not yet demonstrated.', sourceNodeIds: ['open-risk'] },
        ],
      },
      unsettled: [
        { title: 'Reliability target remains open', explanation: 'The pilot result is not yet confirmed.', sourceNodeIds: ['open-question'] },
        { title: 'Resolved fact presented as unsettled', explanation: 'This should be removed.', sourceNodeIds: ['known-progress'] },
      ],
      criticalIssues: [
        { severity: 'high', title: 'Reliability risk', explanation: 'The pilot may fail its reliability target.', sourceNodeIds: ['open-risk'] },
        { severity: 'watch', title: 'Unsupported issue', explanation: 'This has no source.', sourceNodeIds: ['unknown-node'] },
        { severity: 'watch', title: 'Unfinished work', explanation: 'This is tactical work, not a strategic issue.', sourceNodeIds: ['next-action'] },
      ],
      emergingInsights: [
        { text: 'Testing is narrowing the remaining uncertainty.', sourceNodeIds: ['known-progress', 'open-risk'] },
        { text: 'Unsupported insight.', sourceNodeIds: ['unknown-node'] },
      ],
      confidence: 0.82,
    }) });

    const result = await generateProjectOverviewAssessment(
      project,
      [historyEvent],
      focusFor('open-risk'),
      undefined,
      { model: 'test-model' },
    );

    expect(result.meaningfulChanges).toHaveLength(1);
    expect(result.meaningfulChanges[0].sourceNodeIds).toEqual(['known-progress']);
    expect(result.meaningfulChanges[0].historyEventIds).toEqual(['history-test']);
    expect(result.goalImpact.positiveFactors).toHaveLength(1);
    expect(result.unsettled).toHaveLength(1);
    expect(result.unsettled[0].sourceNodeIds).toEqual(['open-question']);
    expect(result.criticalIssues).toHaveLength(1);
    expect(result.emergingInsights).toHaveLength(1);
    expect(result.emergingInsights[0].sourceNodeIds).toEqual(['known-progress', 'open-risk']);

    const prompt = JSON.stringify(generateContent.mock.calls[0]);
    expect(prompt).toContain('canonical project state');
    expect(prompt).toContain('one strong 3–5 sentence synthesis');
    expect(prompt).toContain('Do not repeat the trajectory explanation');
    expect(prompt).toContain('Do not use tactical Today-style wording');
    expect(prompt).toContain('Do not invent facts, progress percentages, deadlines');
    expect(generateContent.mock.calls[0][0].config.maxOutputTokens).toBe(4096);
  });
});
