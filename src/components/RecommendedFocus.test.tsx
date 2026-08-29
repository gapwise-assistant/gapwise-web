import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecommendedFocus } from '@/components/RecommendedFocus';
import type { GapGuidance } from '@/types/clarity';

const guidance: GapGuidance = {
  focus: 'Decide whether the Northstar role is worth pursuing.',
  whyNow: 'The recruiter call is today, and this answer controls whether the interview should continue.',
  nextStep: 'Ask how much frontend work remains after launch and who sponsors the backend transition.',
  whatCouldChange: 'The answer could stop the process or justify continuing to the full interview loop.',
  supportingIds: ['unknown_role_fit', 'decision_continue', 'source_role'],
  generatedBy: 'gap-agent',
};

describe('RecommendedFocus', () => {
  it('renders only the focus and available actions without internal guidance details', () => {
    const html = renderToStaticMarkup(
      <RecommendedFocus guidance={guidance} onResolve={vi.fn()} onViewDecisionMap={vi.fn()} />,
    );

    expect(html).toContain('Recommended focus');
    expect(html).toContain(guidance.focus);
    expect(html).not.toContain('Gap Agent');
    expect(html).not.toContain(guidance.whyNow);
    expect(html).not.toContain(guidance.nextStep);
    expect(html).not.toContain(guidance.whatCouldChange);
    expect(html).toContain('>Resolve<');
    expect(html).not.toContain('Resolve question');
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain('View in Decision Map');
    expect(html).not.toContain('unknown_role_fit');
    expect(html).not.toContain('priority');
    expect(html).not.toContain('Decision value');
    expect(html).not.toContain('confidence');
  });

  it('does not expose the guidance generator in the compact view', () => {
    const html = renderToStaticMarkup(
      <RecommendedFocus guidance={{ ...guidance, generatedBy: 'deterministic' }} />,
    );

    expect(html).not.toContain('Gap Agent');
    expect(html).not.toContain('Project analysis');
  });

  it('renders a Decide action for an open decision focus', () => {
    const html = renderToStaticMarkup(
      <RecommendedFocus guidance={guidance} onDecide={vi.fn()} onViewDecisionMap={vi.fn()} />,
    );

    expect(html).toContain('Decide');
    expect(html).not.toContain('Resolve question');
    expect(html).toContain('View in Decision Map');
  });

  it('renders a read-only view action when mutation is unavailable', () => {
    const html = renderToStaticMarkup(
      <RecommendedFocus guidance={guidance} onViewDecision={vi.fn()} />,
    );

    expect(html).toContain('View decision');
    expect(html).not.toContain('>Decide<');
    expect(html).not.toContain('Resolve question');
  });
});
