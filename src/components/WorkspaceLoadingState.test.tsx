import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceLoadingState } from '@/components/WorkspaceLoadingState';

describe('WorkspaceLoadingState', () => {
  it('uses the real brand mark, accessible status, and restrained glow', () => {
    const html = renderToStaticMarkup(<WorkspaceLoadingState />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Loading your workspace…');
    expect(html).toContain('g-logo.png');
    expect(html).toContain('alt=""');
    expect(html).toContain('workspace-loading-glow');
    expect(html).toContain('min-h-[100dvh]');
    expect(html).not.toContain('Loading persistent workspace state');
  });
});
