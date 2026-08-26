import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectHistory, snapshotForHistoryEvent } from '@/components/ProjectHistory';
import { createProjectFromInput } from '@/lib/projects/createProject';
import type { ProjectHistoryEvent } from '@/types/clarity';
import type { ProjectSnapshotSummary } from '@/types/projectSnapshot';

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

function summary(id: string, historyEventId: string): ProjectSnapshotSummary {
  return {
    id,
    projectId: 'project-history-test',
    sequence: Number(id.replace('snapshot-', '')),
    createdAt: '2026-08-25T12:00:00.000Z',
    trigger: { type: 'gap_resolved', historyEventId, nodeId: 'same-node' },
    label: id,
    counts: { nodes: 1, edges: 0, sources: 0, chats: 0, messages: 0, pendingProposals: 0 },
    schemaVersion: 2,
  };
}

function event(id: string): ProjectHistoryEvent {
  return {
    id,
    projectId: 'project-history-test',
    createdAt: '2026-08-25T12:00:00.000Z',
    type: 'gap_resolved',
    title: 'Question resolved',
    primaryNodeId: 'same-node',
  };
}

describe('ProjectHistory snapshot matching', () => {
  it('matches each event by history event ID even when the node is the same', () => {
    const snapshots = [summary('snapshot-1', 'event-1'), summary('snapshot-2', 'event-2')];

    expect(snapshotForHistoryEvent(event('event-1'), snapshots)?.id).toBe('snapshot-1');
    expect(snapshotForHistoryEvent(event('event-2'), snapshots)?.id).toBe('snapshot-2');
    expect(snapshotForHistoryEvent(event('event-3'), snapshots)).toBeUndefined();
  });

  it('maps only the project start marker to an unlinked creation snapshot', () => {
    const start: ProjectHistoryEvent = {
      ...event('started'),
      type: 'project_started',
      title: 'Project started',
    };
    const creation = {
      ...summary('snapshot-created', 'unrelated-event'),
      trigger: { type: 'project_created' as const },
    };

    expect(snapshotForHistoryEvent(start, [creation])?.id).toBe('snapshot-created');
    expect(snapshotForHistoryEvent(event('other'), [creation])).toBeUndefined();
  });
});
