import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectHistory } from '@/components/ProjectHistory';
import { createProjectFromInput } from '@/lib/projects/createProject';

describe('ProjectHistory', () => {
  it('shows the project start marker for a newly created project', () => {
    const html = renderToStaticMarkup(
      <ProjectHistory project={createProjectFromInput({ name: 'Empty', goal: 'Start carefully.' })} />,
    );

    expect(html).toContain('Project start');
    expect(html).toContain('Project started');
    expect(html).toContain('Created this project with its initial goal.');
  });

  it('synthesizes a display-only project start for older projects', () => {
    const project = createProjectFromInput({ name: 'Legacy', goal: 'Keep the work safe.' }, '2026-08-20T12:00:00.000Z');
    project.historyEvents = [{
      id: 'legacy_event',
      projectId: project.id,
      createdAt: '2026-08-21T12:00:00.000Z',
      type: 'context_added',
      title: 'Context added',
      summary: 'A later note was added.',
    }];

    const html = renderToStaticMarkup(<ProjectHistory project={project} />);

    expect(html.indexOf('Project started')).toBeLessThan(html.indexOf('Context added'));
    expect(html).toContain(`dateTime="${project.created_at}"`);
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
    expect(html).toContain('dateTime="2026-08-22T12:00:00.000Z"');
    expect(html).toContain('dateTime="2026-08-23T12:00:00.000Z"');
    expect(html).toContain('NOW');
  });
});
