import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DecisionWorkspace } from '@/components/DecisionWorkspace';
import { createGoldenDemoProject } from '@/lib/demo/seed';

describe('DecisionWorkspace presentation', () => {
  it('keeps review focused while making guidance and decision wording available immediately', () => {
    const html = renderToStaticMarkup(
      <DecisionWorkspace
        project={createGoldenDemoProject()}
        targetNodeId="unknown_target_user"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onResolveQuestion={vi.fn()}
        onViewGraph={vi.fn()}
        onStartChat={vi.fn()}
      />,
    );

    expect(html).toContain('Needs answer');
    expect(html).toContain('Need help shaping this decision?');
    expect(html).toContain('Talk it through with Gapwise');
    expect(html).toContain('Resolved decision');
    expect(html).toContain('Previous decision');
    expect(html).toContain('Edit previous decision');
    expect(html).toContain('Update decision');
    expect(html).toContain('View in Decision Map');
    expect(html).not.toContain('No explicit options are recorded yet');
  });
});
