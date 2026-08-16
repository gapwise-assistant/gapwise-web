import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { IdontKnowModal } from '@/components/IdontKnowModal';
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
  it('renders each strategy as an explicit button with async status semantics', () => {
    const html = renderToStaticMarkup(
      <IdontKnowModal
        gap={gap}
        onSelectStrategy={vi.fn(async () => ({ message: 'Updated.' }))}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('Search uploaded context inbox');
    expect(html).toContain('Propose a tiny resolution experiment');
    expect(html).toContain('Create a temporary assumption');
    expect(html).toContain('Defer this gap for now');
    expect(html.match(/type="button"/g)).toHaveLength(5);
  });
});
