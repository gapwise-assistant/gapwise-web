import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AnswerQuestionModal } from '@/components/AnswerQuestionModal';

describe('AnswerQuestionModal', () => {
  it('uses concise presentation copy and keeps help behind I don\'t know yet', () => {
    const html = renderToStaticMarkup(
      <AnswerQuestionModal
        target={{
          question: 'Does this role remain acceptable?',
          presentationTitle: 'Decide if the Northstar role is worth pursuing',
          presentationSummary: 'The role may be 70–80% frontend, which conflicts with your direction.',
          answerSuggestion: {
            suggestedAnswer: 'Ask whether frontend ownership drops below 40% after launch.',
            whyItMatters: 'This clarifies the role-fit conflict before the interview decision.',
          },
        }}
        onSubmit={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('Resolve');
    expect(html).toContain('Decide if the Northstar role is worth pursuing');
    expect(html).toContain('The role may be 70–80% frontend, which conflicts with your direction.');
    expect(html).toContain('Your answer');
    expect(html).not.toContain('Discuss with Gapswise');
    expect(html).not.toContain('Suggested from your context');
    expect(html).not.toContain('Use suggestion');
    expect(html).not.toContain('Chat about suggestion');
  });

  it('starts accordions collapsed, hides empty sections, and keeps map navigation in overflow', () => {
    const html = renderToStaticMarkup(
      <AnswerQuestionModal
        target={{
          nodeId: 'question-1',
          question: 'Does this role remain acceptable?',
          explanation: {
            whyThisMatters: 'This affects the next career decision.',
            whatThisBlocks: ['The interview decision is waiting on role fit.'],
            whatGapswiseKnows: ['The role is mostly frontend.', 'Financial stability is a priority.'],
            whatCouldChange: ['The recommended interview path may change.'],
            evidence: [{ sourceId: 'source-1', title: 'Role brief', excerpt: 'Role details.' }],
            reasoningPath: { nodeIds: ['question-1', 'decision-1'], edgeIds: ['edge-1'] },
          },
        }}
        onSubmit={vi.fn(async () => undefined)}
        onNavigateToSource={vi.fn()}
        onViewDecisionMap={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Where this comes from');
    expect(html).toContain('What this affects');
    expect(html).toContain('What your answer could change');
    expect(html).toContain('Sources');
    expect(html).not.toContain('What we know');
    expect(html).not.toContain('Decision options');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('Blocks');
    expect(html).not.toContain('Decision this unlocks');
    expect(html).toContain('View in Decision Map');
    expect(html).not.toContain('More actions');
  });

  it('shows decision options as a collapsed expandable section', () => {
    const html = renderToStaticMarkup(
      <AnswerQuestionModal
        target={{
          nodeId: 'question-1',
          question: 'Which path should we take?',
          decisionTitle: 'Choose the next path',
          decisionSupport: {
            options: [
              { id: 'option_a', label: 'Option A', text: 'Continue with the current plan.' },
              { id: 'option_b', label: 'Option B', text: 'Pause and gather more evidence.' },
            ],
            currentPicture: ['The current plan has partial support.'],
            recommendation: { optionId: 'option_a', label: 'Option A', explanation: 'It has the strongest recorded support.' },
          },
        }}
        onSubmit={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Decision options');
    expect(html).not.toContain('Continue with the current plan.');
    expect(html).not.toContain('Simulate on Decision Map');
    expect(html).not.toContain('Chat about this option');
  });

  it('offers the unresolved-gap strategy action when the question is eligible', () => {
    const html = renderToStaticMarkup(
      <AnswerQuestionModal
        target={{ question: 'What is still unknown?', nodeId: 'question-1' }}
        onSubmit={vi.fn(async () => undefined)}
        onDontKnow={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('I don&#x27;t know yet');
  });

  it('renders the complete saved answer, including multiline and encoded text, on the first render', () => {
    const answer = 'First line\nSecond line with a non-breaking space\u00a0and <encoded> & text.';
    const html = renderToStaticMarkup(
      <AnswerQuestionModal
        target={{
          projectId: 'project_demo',
          nodeId: 'question_demo',
          historyTimestamp: '2026-08-25T12:00:00.000Z',
          question: 'What should the project confirm?',
          initialAnswer: answer,
          mode: 'edit',
        }}
        onSubmit={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('First line\nSecond line with a non-breaking space');
    expect(html).toContain('&lt;encoded&gt; &amp; text.');
    expect(html).toMatch(/&nbsp;|\u00a0/);
  });

  it('shows an explicit error instead of an empty editor for a missing saved answer', () => {
    const html = renderToStaticMarkup(
      <AnswerQuestionModal
        target={{
          projectId: 'project_demo',
          nodeId: 'question_demo',
          historyTimestamp: '2026-08-25T12:00:00.000Z',
          question: 'What should the project confirm?',
          initialAnswer: '',
          mode: 'edit',
        }}
        onSubmit={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('The saved response could not be loaded.');
    expect(html).not.toContain('id="question-answer"');
  });
});
