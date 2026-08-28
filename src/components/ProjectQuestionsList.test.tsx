import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectQuestionsList } from '@/components/ProjectQuestionsList';

describe('ProjectQuestionsList', () => {
  it('shows one searchable gap view without exposing answer text in collapsed rows', () => {
    const html = renderToStaticMarkup(
      <ProjectQuestionsList
        openQuestions={[{
          id: 'question_upload',
          type: 'UNKNOWN',
          text: 'What is blocking the upload?',
          status: 'OPEN',
          confidence: 0.8,
          impact: 0.9,
          source_refs: [],
          created_by: 'agent',
          created_at: '2026-08-22T10:00:00.000Z',
          updated_at: '2026-08-22T10:00:00.000Z',
        }]}
        answeredQuestions={[{
          question: 'Which credentials should the upload use?',
          answer: 'Use credentials from the current project.',
          timestamp: '2026-08-22T10:01:00.000Z',
          graph_diff_summary: 'Resolved question.',
        }]}
        openDecisions={[{
          id: 'decision_fallback',
          type: 'DECISION',
          text: 'Decide whether to add a fallback screen.',
          status: 'OPEN',
          confidence: 0.8,
          impact: 0.9,
          source_refs: [],
          created_by: 'agent',
          created_at: '2026-08-22T10:00:00.000Z',
          updated_at: '2026-08-22T10:00:00.000Z',
        }]}
        resolvedDecisions={[]}
        projectId="project_demo"
        onAnswerQuestion={vi.fn()}
        onEditAnsweredQuestion={vi.fn()}
        onReviewDecision={vi.fn()}
      />,
    );

    expect(html).toContain('GAPS');
    expect(html).toContain('Search gaps');
    expect(html).toContain('Hide resolved gaps');
    expect(html).toContain('What is blocking the upload?');
    expect(html).toContain('Decide whether to add a fallback screen.');
    expect(html).toContain('Which credentials should the upload use?');
    expect(html).toContain('Open');
    expect(html).toContain('Resolved');
    expect(html).not.toContain('Unanswered');
    expect(html).not.toContain('Use credentials from the current project.');
  });

  it('renders resolved questions, assumptions, and decisions from one shared projection', () => {
    const html = renderToStaticMarkup(
      <ProjectQuestionsList
        openQuestions={[]}
        answeredQuestions={[]}
        openDecisions={[]}
        resolvedGaps={[
          {
            nodeId: 'question_1',
            projectId: 'project_demo',
            kind: 'question',
            prompt: 'When should the supplier deliver?',
            resolution: 'By Friday.',
            timestamp: '2026-08-22T10:01:00.000Z',
          },
          {
            nodeId: 'assumption_1',
            projectId: 'project_demo',
            kind: 'assumption',
            prompt: 'The first group will need a helper.',
            resolution: 'A helper is available.',
            timestamp: '2026-08-22T10:02:00.000Z',
          },
          {
            nodeId: 'decision_1',
            projectId: 'project_demo',
            kind: 'decision',
            prompt: 'Which venue should we use?',
            resolution: 'Use the community hall.',
            timestamp: '2026-08-22T10:03:00.000Z',
          },
        ]}
        projectId="project_demo"
        onAnswerQuestion={vi.fn()}
        onEditAnsweredQuestion={vi.fn()}
        onReviewDecision={vi.fn()}
      />,
    );

    expect(html).toContain('When should the supplier deliver?');
    expect(html).toContain('The first group will need a helper.');
    expect(html).toContain('Which venue should we use?');
    expect(html).not.toContain('By Friday.');
    expect(html).not.toContain('A helper is available.');
    expect(html).not.toContain('Use the community hall.');
  });
});
