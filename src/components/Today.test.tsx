import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_COMING_UP_COPY, Today } from '@/components/Today';
import { createProjectFromInput } from '@/lib/projects/createProject';

describe('Today', () => {
  it('shows a loading skeleton instead of local or stale attention data', () => {
    const project = createProjectFromInput({
      name: 'Decision complete',
      goal: 'Complete the project.',
    });
    project.nodes.push({
      id: 'decision_resolved',
      type: 'DECISION',
      text: 'Use the selected venue.',
      status: 'RESOLVED',
      confidence: 1,
      impact: 0.9,
      source_refs: [],
      created_by: 'user',
      created_at: project.created_at,
      updated_at: project.updated_at,
    });

    const html = renderToStaticMarkup(
      <Today
        userId="test-user"
        project={project}
        projectRefreshVersion={0}
        scope={{ type: 'project', projectId: project.id }}
        memories={[]}
        feedbackEvents={[]}
        onUpdateMemories={vi.fn()}
        onFeedbackEvent={vi.fn()}
      />,
    );

    expect(html).toContain('Loading Today');
    expect(html).toContain('What deserves attention now');
    expect(html).not.toContain('Open questions · 0');
    expect(html).not.toContain('Nothing needs your attention right now');
    expect(html).not.toContain('grid-cols-3');
  });

  it('uses clear product language for an empty Coming Up section', () => {
    expect(EMPTY_COMING_UP_COPY).toBe('Nothing scheduled soon.');
    expect(EMPTY_COMING_UP_COPY).not.toContain('Context Pack');
  });
});
