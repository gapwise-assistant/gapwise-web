import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DecisionNodeFocus } from '@/components/DecisionNodeFocus';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { buildDecisionNodeFocus } from '@/lib/graph/decisionFocus';

describe('DecisionNodeFocus', () => {
  it('renders the breadcrumb, persisted context, decision CTA, risk, and goal path', () => {
    const project = createBakeryDemoProject();
    const focus = buildDecisionNodeFocus(project, 'bakery_location_decision');
    if (!focus) throw new Error('Focus fixture is missing.');

    const html = renderToStaticMarkup(
      <DecisionNodeFocus
        focus={focus}
        focusAssessment={{
          kind: 'decision',
          title: focus.node.text,
          actionNodeId: focus.node.id,
          sourceNodeIds: [focus.node.id],
          sourceIds: focus.node.source_refs,
          score: 0.9,
          confidence: 0.8,
        }}
        onBack={vi.fn()}
        onInspectNode={vi.fn()}
        onReviewDecision={vi.fn()}
      />,
    );

    expect(html).toContain('Project story');
    expect(html).toContain('What informs this');
    expect(html).toContain('things inform this decision');
    expect(html).toContain('Expand');
    expect(html).toContain('Decide');
    expect(html).toContain('Choosing a location too late');
    expect(html).toContain('What this unlocks');
    expect(html).toContain('Set initial prices');
    expect(html).toContain('Toward the goal');
  });
});
