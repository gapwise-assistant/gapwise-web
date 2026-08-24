import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectHistory } from '@/components/ProjectHistory';
import { createProjectFromInput } from '@/lib/projects/createProject';

describe('ProjectHistory', () => {
  it('shows an empty state for a project with no meaningful history', () => {
    const html = renderToStaticMarkup(
      <ProjectHistory project={createProjectFromInput({ name: 'Empty', goal: 'Start carefully.' })} />,
    );

    expect(html).toContain('No project history yet.');
  });

  it('renders events chronologically, collapsed with expandable details, and shows Now', () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run a useful workshop.' });
    project.historyEvents = [
      {
        id: 'event_later',
        projectId: project.id,
        createdAt: '2026-08-23T12:00:00.000Z',
        type: 'decision_resolved',
        title: 'Decision made',
        summary: 'Use the community hall.',
        changes: [{ kind: 'resolved', nodeId: 'decision_venue', text: 'Choose the venue.' }],
      },
      {
        id: 'event_first',
        projectId: project.id,
        createdAt: '2026-08-22T12:00:00.000Z',
        type: 'context_added',
        title: 'Planning context added',
        summary: '2 things learned · 1 meaningful change',
        changes: [{ kind: 'learned', text: 'The workshop has a Saturday constraint.' }],
      },
    ];

    const html = renderToStaticMarkup(<ProjectHistory project={project} />);

    expect(html.indexOf('Planning context added')).toBeLessThan(html.indexOf('Decision made'));
    expect(html).toContain('Show details');
    expect(html).toContain('NOW');
  });
});
