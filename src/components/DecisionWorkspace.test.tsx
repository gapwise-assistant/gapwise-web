import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DecisionWorkspace } from '@/components/DecisionWorkspace';
import { createGoldenDemoProject } from '@/lib/demo/seed';

describe('DecisionWorkspace presentation', () => {
  it('keeps the decision review compact and preserves the decision controls', () => {
    const html = renderToStaticMarkup(
      <DecisionWorkspace
        project={createGoldenDemoProject()}
        targetNodeId="unknown_target_user"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onViewGraph={vi.fn()}
        onStartChat={vi.fn()}
      />,
    );

    expect(html).toContain('What could change this decision');
    expect(html).toContain('Where this comes from');
    expect(html).toContain('Sources');
    expect(html).toContain('Edit previous decision');
    expect(html).toContain('I don');
    expect(html).not.toContain('Current picture');
    expect(html).not.toContain('Gapwise analysis');
    expect(html).not.toContain('Talk it through with Gapwise');
    expect(html).not.toContain('Needs answer');
    expect(html).toContain('Resolved decision');
    expect(html).toContain('Previous decision');
    expect(html).toContain('Edit previous decision');
    expect(html).toContain('Update decision');
    expect(html).toContain('View in Decision Map');
    expect(html).not.toContain('No explicit options are recorded yet');
  });
});
