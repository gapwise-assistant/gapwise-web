import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProjectStoryGraph from '@/components/ProjectStoryGraph';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { buildDecisionMapProjection } from '@/lib/graph/decisionMapProjection';

describe('ProjectStoryGraph', () => {
  it('renders story nodes as full-card buttons', () => {
    const project = createBakeryDemoProject();
    const projection = buildDecisionMapProjection(project, null, 'story', new Set());
    const html = renderToStaticMarkup(
      <ProjectStoryGraph
        project={project}
        projection={projection}
        selectedNodeId={null}
        focusNodeId="bakery_location_decision"
        onViewportChange={vi.fn()}
        onSelectNode={vi.fn()}
        onLayoutDiagnostics={vi.fn()}
      />,
    );

    expect(html).toContain('Choose the launch location for the weekend bakery pop-up');
    expect(html).toContain('type="button"');
    expect(html).toContain('★ Current focus');
  });
});
