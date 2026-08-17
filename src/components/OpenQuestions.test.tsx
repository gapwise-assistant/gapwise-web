import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenQuestions,
  openQuestionProgress,
  questionOverflowLabels,
  OpenQuestionRowItem,
} from '@/components/OpenQuestions';

function row(id: string, question: string, overrides: Partial<OpenQuestionRowItem> = {}): OpenQuestionRowItem {
  return {
    id,
    question: {
      id: `question_${id}`,
      question,
      reason: 'A decision depends on this answer.',
      provenance: 'Graph node: test',
      sourceNodeIds: [id],
    },
    context: 'Blocks the next decision.',
    ...overrides,
  };
}

describe('OpenQuestions', () => {
  it('groups open and answered rows with compact progress and one priority marker', () => {
    const items = [
      row('persona', 'Who is the primary target persona?', { priority: true }),
      row('scenario', 'What should the demo show?'),
      row('deadline', 'What is the final deadline?', { answered: true, answer: 'August 31, 2026.' }),
    ];
    const html = renderToStaticMarkup(
      <OpenQuestions
        items={items}
        summary="Resolve these before deciding the demo direction."
        onAnswer={vi.fn()}
        onHide={vi.fn()}
      />
    );

    expect(html).toContain('Open questions');
    expect(html).not.toContain('Resolve the unknowns');
    expect(html).toContain('Open questions · 2');
    expect(html).toContain('Resolve these before deciding the demo direction.');
    expect(html).toContain('Who is the primary target persona?');
    expect(html).toContain('Blocks the next decision.');
    expect(html).toContain('Resolve');
    expect(html).not.toContain('Why this matters');
    expect(html).not.toContain('Review decision');
    expect(html).toContain('Edit');
    expect(html).toContain('August 31, 2026.');
    expect((html.match(/>Priority</g) ?? []).length).toBe(1);
    expect((html.match(/aria-haspopup="menu"/g) ?? []).length).toBe(0);
    expect(html).not.toContain('QUESTION');
  });

  it('keeps overflow actions aligned with unresolved and answered row states', () => {
    expect(questionOverflowLabels({ canHide: true })).toEqual(['Hide from Today']);
    expect(questionOverflowLabels({ answered: true, canHide: true })).toEqual([]);
    expect(openQuestionProgress([{ answered: false }, { answered: true }, { answered: false }])).toEqual({
      openCount: 2,
      answeredCount: 1,
    });
  });

  it('renders presentation copy while retaining the raw question for Resolve', () => {
    const item = row('role', 'Does this role remain acceptable?', {
      question: {
        ...row('role', 'Does this role remain acceptable?').question,
        presentationTitle: 'Decide if the Northstar role is worth pursuing',
        presentationSummary: 'The role may conflict with your preferred direction.',
      },
    });
    const html = renderToStaticMarkup(
      <OpenQuestions items={[item]} summary="Resolve this before the next decision." onAnswer={vi.fn()} />
    );

    expect(html).toContain('Decide if the Northstar role is worth pursuing');
    expect(html).toContain('The role may conflict with your preferred direction.');
    expect(html).not.toContain('Does this role remain acceptable?');
  });
});
