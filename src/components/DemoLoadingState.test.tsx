import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DemoLoadingState } from '@/components/DemoLoadingState';

describe('DemoLoadingState', () => {
  it('explains the active demo load and renders content skeletons', () => {
    const html = renderToStaticMarkup(<DemoLoadingState label="Scientific AI assistant" />);

    expect(html).toContain('Loading Scientific AI assistant');
    expect(html).toContain('Replacing project data and refreshing your briefing');
    expect(html).toContain('aria-busy="true"');
    expect((html.match(/animate-pulse/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
