import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HistoryEventCard, ProjectHistory, snapshotForHistoryEvent } from '@/components/ProjectHistory';
import { ProjectSnapshotModal } from '@/components/ProjectSnapshotModal';
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
    expect(html).not.toContain('Expand');
    expect(html).not.toContain('Collapse');
    expect(html).toContain('Show details for Planning context added');
    expect(html).toContain('2 things learned · 1 meaningful change');
    expect(html).toContain('dateTime="2026-08-22T12:00:00.000Z"');
    expect(html).toContain('dateTime="2026-08-23T12:00:00.000Z"');
    expect(html).toContain('NOW');
  });

  it('keeps the quiet overflow action in a stable top-right slot', () => {
    const project = createProjectFromInput({ name: 'Actions', goal: 'Keep actions readable.' });
    const eventWithDetails: ProjectHistoryEvent = {
      ...event('event-actions'),
      changes: [{ kind: 'learned', text: 'The schedule is confirmed.' }],
    };
    const html = renderToStaticMarkup(
      <HistoryEventCard
        project={project}
        event={eventWithDetails}
        expanded={false}
        onToggle={() => undefined}
        snapshot={summary('snapshot-actions', 'event-actions')}
        onViewSnapshot={() => undefined}
      />,
    );
    const groupStart = html.indexOf('aria-label="History event actions"');
    const groupEnd = html.indexOf('</div>', groupStart);
    const actions = html.slice(groupStart, groupEnd);

    expect(groupStart).toBeGreaterThan(-1);
    expect(actions).toContain('aria-haspopup="menu"');
    expect(actions).not.toContain('Open project at this moment');
    expect(actions).not.toContain('Create a new project from here');
    expect(actions).toContain('h-8');
    expect(actions).toContain('focus-visible:ring-2');
  });

  it('uses the summary row for details and keeps cards without details quiet', () => {
    const project = createProjectFromInput({ name: 'Single action', goal: 'Keep one action usable.' });
    const detailsOnly = renderToStaticMarkup(
      <HistoryEventCard
        project={project}
        event={{ ...event('event-details-only'), changes: [{ kind: 'learned', text: 'A detail.' }] }}
        expanded
        onToggle={() => undefined}
      />,
    );
    const noDetails = renderToStaticMarkup(
      <HistoryEventCard
        project={project}
        event={event('event-no-details')}
        expanded={false}
        onToggle={() => undefined}
      />,
    );

    expect(detailsOnly).toContain('aria-label="Hide details for Question resolved"');
    expect(detailsOnly).toContain('See what changed');
    expect(detailsOnly).toContain('aria-expanded="true"');
    expect(detailsOnly).toContain('Question resolved');
    expect(noDetails).not.toContain('aria-expanded');
    expect(noDetails).not.toContain('See what changed');
  });

  it('reserves a quiet disabled action slot while snapshot availability loads', () => {
    const html = renderToStaticMarkup(
      <HistoryEventCard
        project={createProjectFromInput({ name: 'Loading', goal: 'Keep loading stable.' })}
        event={event('event-loading')}
        expanded={false}
        onToggle={() => undefined}
        snapshotsLoading
      />,
    );

    expect(html).toContain('aria-label="Historical actions are loading"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('animate-spin');
  });

  it('opens the historical modal shell with skeleton content before materialization', () => {
    const html = renderToStaticMarkup(
      <ProjectSnapshotModal
        snapshot={null}
        summary={summary('snapshot-loading', 'event-loading')}
        isLoading
        onClose={() => undefined}
        onBranch={() => undefined}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Project at this moment');
    expect(html).toContain('Loading historical project state');
    expect(html).toContain('Create a new project from here');
    expect(html).toContain('disabled=""');
  });

  it('shows retry inside the snapshot modal when materialization fails', () => {
    const html = renderToStaticMarkup(
      <ProjectSnapshotModal
        snapshot={null}
        summary={summary('snapshot-error', 'event-error')}
        error="Historical state unavailable."
        onRetry={() => undefined}
        onClose={() => undefined}
        onBranch={() => undefined}
      />,
    );

    expect(html).toContain('Historical state unavailable.');
    expect(html).toContain('Retry');
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
