import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DecisionWorkspace } from '@/components/DecisionWorkspace';
import { createGoldenDemoProject } from '@/lib/demo/seed';

describe('DecisionWorkspace presentation', () => {
  it('keeps the decision review compact and preserves the decision controls', () => {
    const project = createGoldenDemoProject();
    project.nodes.find((node) => node.id === 'node_decision_track')!.decision_outcome = 'Build the four-minute persona demo.';
    const html = renderToStaticMarkup(
      <DecisionWorkspace
        project={project}
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
    expect(html).toContain('Recorded decision');
    expect(html).toContain('Build the four-minute persona demo.');
    expect(html).toContain('Edit previous decision');
    expect(html).toContain('Update decision');
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain('View in Decision Map');
    expect(html).not.toContain('No explicit options are recorded yet');
  });

  it('does not open a resolved decision with an empty editor when its outcome is missing', () => {
    const project = createGoldenDemoProject();
    const html = renderToStaticMarkup(
      <DecisionWorkspace
        project={project}
        targetNodeId="node_decision_track"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('The recorded resolution is unavailable.');
    expect(html).toContain('Record replacement resolution');
    expect(html).not.toContain('id="custom-decision"');
  });
});
