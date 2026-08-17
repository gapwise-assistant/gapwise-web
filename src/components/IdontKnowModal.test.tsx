import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { conciseQuestionToAsk, IdontKnowModal } from '@/components/IdontKnowModal';
import type { CandidateGap } from '@/types/clarity';

const gap: CandidateGap = {
  node_id: 'question-1',
  question: 'Is this role still acceptable?',
  uncertainty: 0.8,
  downstream_impact: 0.9,
  dependency_count: 1,
  urgency: 0.8,
  answerability: 0.7,
  user_relevance: 0.9,
  interruption_cost: 0.2,
  priority: 0.88,
  reasons: ['This affects the next decision.'],
  blocked_decision_ids: ['decision-1'],
};

describe('IdontKnowModal', () => {
  it('turns a graph question into a concise question for another person', () => {
    expect(conciseQuestionToAsk('Does this primarily frontend role remain acceptable given your preference to avoid frontend-heavy roles?')).toBe(
      'Is this role still a good fit despite the frontend-heavy work?'
    );
  });

  it('renders the three plain-language next steps', () => {
    const html = renderToStaticMarkup(
      <IdontKnowModal
        gap={gap}
        onHelp={vi.fn()}
        onDecideLater={vi.fn(async () => ({ message: 'Snoozed.' }))}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('I don&#x27;t know yet');
    expect(html).toContain('What would help?');
    expect(html).toContain('Help me figure this out');
    expect(html).toContain('I need to ask someone');
    expect(html).toContain('Decide later');
    expect(html).not.toContain('Search uploaded context');
    expect(html).not.toContain('Temporary assumption');
  });
});
