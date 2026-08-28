import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { answeredQuestionHistory, resolvedGapRecords } from '@/lib/questions/history';

describe('answered question history', () => {
  it('keeps every answered question with its answer, newest first', () => {
    const project = createGoldenDemoProject();
    project.history = [
      {
        question: 'What is the primary audience?',
        answer: 'Independent builders.',
        timestamp: '2026-08-10T10:00:00.000Z',
        graph_diff_summary: 'Added a decision.',
      },
      {
        question: 'What should the demo show?',
        answer: 'A focused decision path.',
        timestamp: '2026-08-11T10:00:00.000Z',
        graph_diff_summary: 'Resolved an open question.',
      },
    ];

    expect(answeredQuestionHistory(project)).toEqual([
      project.history[1],
      project.history[0],
    ]);
    expect(answeredQuestionHistory(project)[0]).toMatchObject({
      question: 'What should the demo show?',
      answer: 'A focused decision path.',
    });
  });

  it('does not project decision confirmations as answered questions', () => {
    const project = createGoldenDemoProject();
    project.history = [{
      question: 'Should I use a helper for the upstairs windows?',
      answer: 'Use a helper as a spotter.',
      timestamp: '2026-08-12T10:00:00.000Z',
      graph_diff_summary: 'Decision confirmed: "Use a helper as a spotter."',
    }];

    expect(answeredQuestionHistory(project)).toEqual([]);
  });

  it('projects resolved questions, assumptions, and decisions with their saved resolutions', () => {
    const project = createGoldenDemoProject();
    const question = project.nodes.find((node) => node.id === 'unknown_target_user')!;
    const assumption = project.nodes.find((node) => node.id === 'node_assumption_visual')!;
    const decision = project.nodes.find((node) => node.id === 'node_decision_track')!;
    question.status = 'RESOLVED';
    assumption.status = 'RESOLVED';
    decision.decision_outcome = 'Build the focused partner workflow.';
    project.history = [
      {
        question: question.text,
        answer: 'The first audience is independent makers.',
        timestamp: '2026-08-12T10:00:00.000Z',
        graph_diff_summary: 'Question resolved.',
        nodeId: question.id,
        projectId: project.id,
      },
      {
        question: assumption.text,
        answer: 'Keep the visual graph as part of the first release.',
        timestamp: '2026-08-13T10:00:00.000Z',
        graph_diff_summary: 'Assumption confirmed.',
        nodeId: assumption.id,
        projectId: project.id,
      },
      {
        question: decision.text,
        answer: decision.decision_outcome,
        timestamp: '2026-08-14T10:00:00.000Z',
        graph_diff_summary: 'Decision confirmed.',
        nodeId: decision.id,
        projectId: project.id,
      },
    ];

    expect(resolvedGapRecords(project)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: question.id,
        kind: 'question',
        prompt: question.text,
        resolution: 'The first audience is independent makers.',
      }),
      expect.objectContaining({
        nodeId: assumption.id,
        kind: 'assumption',
        resolution: 'Keep the visual graph as part of the first release.',
      }),
      expect.objectContaining({
        nodeId: decision.id,
        kind: 'decision',
        prompt: decision.text,
        resolution: 'Build the focused partner workflow.',
      }),
    ]));
  });

  it('recovers a question resolution from an incoming resolves edge when history is missing', () => {
    const project = createGoldenDemoProject();
    const question = project.nodes.find((node) => node.id === 'unknown_target_user')!;
    question.status = 'RESOLVED';
    project.history = [];
    project.nodes.push({
      ...question,
      id: 'answer_target_user',
      type: 'KNOWN',
      text: 'Independent makers are the primary target audience.',
      status: 'RESOLVED',
      created_by: 'user',
    });
    project.edges.push({
      id: 'answer_resolves_target_user',
      source: 'answer_target_user',
      target: question.id,
      type: 'resolves',
    });

    expect(resolvedGapRecords(project).find((record) => record.nodeId === question.id)).toMatchObject({
      resolution: 'Independent makers are the primary target audience.',
    });
  });

  it('keeps a resolved item visible without opening an empty editor when resolution data is missing', () => {
    const project = createGoldenDemoProject();
    const decision = project.nodes.find((node) => node.id === 'node_decision_track')!;
    decision.decision_outcome = undefined;
    project.history = [];

    expect(resolvedGapRecords(project).find((record) => record.nodeId === decision.id)).toMatchObject({
      kind: 'decision',
      resolution: '',
    });
  });

  it('uses legacy history text only when no stable nodeId exists', () => {
    const project = createGoldenDemoProject();
    const question = project.nodes.find((node) => node.id === 'unknown_target_user')!;
    question.status = 'RESOLVED';
    project.history = [{
      question: question.text,
      answer: 'Legacy answer retained.',
      timestamp: '2026-08-15T10:00:00.000Z',
      graph_diff_summary: 'Resolved question.',
    }];

    expect(resolvedGapRecords(project).find((record) => record.nodeId === question.id)).toMatchObject({
      resolution: 'Legacy answer retained.',
    });
  });
});
