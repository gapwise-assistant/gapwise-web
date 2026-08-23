import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { answeredQuestionHistory } from '@/lib/questions/history';

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
});
