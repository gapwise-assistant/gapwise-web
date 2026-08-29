import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DemoLoadingState } from '@/components/DemoLoadingState';

describe('DemoLoadingState', () => {
  it('uses the shared branded full-page loading state', () => {
    const html = renderToStaticMarkup(<DemoLoadingState label="Scientific AI assistant" />);

    expect(html).toContain('Preparing Scientific AI assistant…');
    expect(html).toContain('g-logo.png');
    expect(html).toContain('workspace-loading-glow');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('LoaderCircle');
    expect(html).not.toContain('Replacing workspace data');
  });
});
