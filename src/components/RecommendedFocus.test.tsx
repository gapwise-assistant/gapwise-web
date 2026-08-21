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
  it('renders the four-part Gap Agent recommendation without scores or internal identifiers', () => {
    const html = renderToStaticMarkup(
      <RecommendedFocus guidance={guidance} onResolve={vi.fn()} onViewDecisionMap={vi.fn()} />,
    );

    expect(html).toContain('Recommended focus');
    expect(html).toContain('Gap Agent');
    expect(html).toContain(guidance.focus);
    expect(html).toContain('Why now');
    expect(html).toContain(guidance.whyNow);
    expect(html).toContain('Next step');
    expect(html).toContain(guidance.nextStep);
    expect(html).toContain('What could change');
    expect(html).toContain(guidance.whatCouldChange);
    expect(html).toContain('Resolve question');
    expect(html).toContain('View in Decision Map');
    expect(html).not.toContain('unknown_role_fit');
    expect(html).not.toContain('priority');
    expect(html).not.toContain('Decision value');
    expect(html).not.toContain('confidence');
  });

  it('labels deterministic fallback guidance honestly', () => {
    const html = renderToStaticMarkup(
      <RecommendedFocus guidance={{ ...guidance, generatedBy: 'deterministic' }} />,
    );

    expect(html).toContain('Project analysis');
    expect(html).not.toContain('Gap Agent');
  });
});
