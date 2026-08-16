import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DecisionWorkspace } from '@/components/DecisionWorkspace';
import { createGoldenDemoProject } from '@/lib/demo/seed';

describe('DecisionWorkspace presentation', () => {
  it('keeps review focused and collapses the decision form', () => {
    const html = renderToStaticMarkup(
      <DecisionWorkspace
        project={createGoldenDemoProject()}
        targetNodeId="unknown_target_user"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onResolveQuestion={vi.fn()}
        onViewGraph={vi.fn()}
      />,
    );

    expect(html).toContain('Needs answer');
    expect(html).toContain('Ready to decide?');
    expect(html).toContain('Make decision');
    expect(html).toContain('View in Decision Map');
    expect(html).not.toContain('Decision being made');
    expect(html).not.toContain('No explicit options are recorded yet');
  });
});
