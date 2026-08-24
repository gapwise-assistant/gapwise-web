import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Today } from '@/components/Today';
import { createProjectFromInput } from '@/lib/projects/createProject';

describe('Today', () => {
  it('hides Open Questions when there are no visible questions', () => {
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

    expect(html).not.toContain('Open questions · 0');
    expect(html).not.toContain('No visible questions right now.');
  });
});
