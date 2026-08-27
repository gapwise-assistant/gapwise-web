'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, GitBranch, MoreHorizontal } from 'lucide-react';
import type { ClarityNode, HistoryNodeSnapshot, Project, ProjectHistoryChange, ProjectHistoryEvent, ProjectHistoryFocus } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { historyCurrentFocus } from '@/lib/history/projectHistory';
import { authFetch } from '@/lib/auth/client';
import type { MaterializedProjectSnapshot, ProjectSnapshotSummary } from '@/types/projectSnapshot';
import { ProjectSnapshotModal } from '@/components/ProjectSnapshotModal';
import { boundedId } from '@/lib/ids/boundedId';
import { formatDateHeading, formatDateTime } from '@/lib/datetime/displayDateTime';

interface ProjectHistoryProps {
  project: Project;
  userId?: string;
  onNavigateToSource?: (sourceId: string) => void;
  onProjectBranched?: (project: Project) => void;
}

/**
 * History is keyed by the event that caused a snapshot, not by the source or
 * node involved in that event. This matters when the same source or node is
 * involved in several distinct moments.
 */
export function snapshotForHistoryEvent(
  event: ProjectHistoryEvent,
  snapshots: ProjectSnapshotSummary[],
): ProjectSnapshotSummary | undefined {
  const exact = snapshots.find((snapshot) => snapshot.trigger.historyEventId === event.id);
  if (exact) return exact;

  // Project creation predates the project_started history marker and its
  // creation snapshot intentionally has no historyEventId. Keep this one
  // explicit compatibility mapping; all other events require an exact link.
  if (event.type === 'project_started') {
    return snapshots.find((snapshot) =>
      snapshot.trigger.type === 'project_created' && !snapshot.trigger.historyEventId,
    );
  }
  return undefined;
}

export function historyBranchRequestId(snapshotId: string): string {
  return boundedId('history-branch', snapshotId, 180);
}

const CHANGE_LABELS: Record<ProjectHistoryChange['kind'], string> = {
  learned: 'Learned',
  resolved: 'Resolved',
  unblocked: 'Unblocked',
  became_actionable: 'Became actionable',
  invalidated: 'Invalidated',
  updated: 'Updated',
};

function displayOnlyProjectStartedEvent(project: Project): ProjectHistoryEvent {
  return {
    id: `${project.id}:history:project_started:${project.created_at}:display`,
    projectId: project.id,
    createdAt: project.created_at,
    type: 'project_started',
    title: 'Project started',
    summary: 'Created this project with its initial goal.',
  };
}

function nodeType(project: Project, nodeId?: string): string | undefined {
  if (!nodeId) return undefined;
  return project.nodes.find((node) => node.id === nodeId)?.type.replace('_', ' ');
}

function sourceName(project: Project, sourceId?: string): string | undefined {
  return sourceId ? project.sources.find((source) => source.id === sourceId)?.filename : undefined;
}

function eventHasDetails(event: ProjectHistoryEvent): boolean {
  // Only structured changes, affected nodes, or focus transitions create a
  // disclosure row; a source link alone is already available in the menu.
  return Boolean(event.changes?.length || event.affectedNodes?.length || event.affectedNodeIds?.length || event.focusBefore || event.focusAfter);
}

function compactSummary(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ');
}

function snapshotForChange(project: Project, change: ProjectHistoryChange): HistoryNodeSnapshot {
  if (change.snapshot) return change.snapshot;
  const node = project.nodes.find((candidate) => candidate.id === change.nodeId);
  return node
    ? { nodeId: node.id, text: change.text, type: node.type, status: node.status }
    : { nodeId: change.nodeId, text: change.text };
}

function workflowStatus(snapshot: HistoryNodeSnapshot): string | undefined {
  if (!snapshot.status || !snapshot.type) return undefined;
  if (!new Set(['DECISION', 'UNKNOWN', 'ASSUMPTION', 'RISK', 'NEXT_ACTION']).has(snapshot.type)) return undefined;
  if (snapshot.type === 'NEXT_ACTION' && snapshot.status === 'RESOLVED') return 'completed';
  return snapshot.status.toLowerCase();
}

function ChangeRow({ project, change }: { project: Project; change: ProjectHistoryChange }) {
  const snapshot = snapshotForChange(project, change);
  const type = snapshot.type ? snapshot.type.replace('_', ' ') : nodeType(project, change.nodeId);
  const status = workflowStatus(snapshot);
  return (
    <div className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
      <span className="mt-1 text-emerald-300" aria-hidden="true">✓</span>
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
          {type ?? CHANGE_LABELS[change.kind]}{status ? ` · ${status}` : ''}
        </p>
        <p>{snapshot.text}</p>
      </div>
    </div>
  );
}

interface HistoryActionsMenuProps {
  hasSnapshot?: boolean;
  hasSource?: boolean;
  snapshotsLoading?: boolean;
  onOpenSnapshot?: () => void;
  onOpenSource?: () => void;
}

/** The compact action menu keeps inspection and branching actions together. */
export function HistoryActionsMenu({
  hasSnapshot = false,
  hasSource = false,
  snapshotsLoading = false,
  onOpenSnapshot,
  onOpenSource,
}: HistoryActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const items = [
    ...(hasSnapshot && onOpenSnapshot
      ? [{ label: 'Open project at this moment', onSelect: onOpenSnapshot }]
      : []),
    ...(hasSource && onOpenSource ? [{ label: 'Open source', onSelect: onOpenSource }] : []),
  ];

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!items.length) return;
      const currentIndex = menuItemRefs.current.findIndex((item) => item === document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = currentIndex < 0
          ? (direction === 1 ? 0 : items.length - 1)
          : (currentIndex + direction + items.length) % items.length;
        menuItemRefs.current[nextIndex]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        menuItemRefs.current[event.key === 'Home' ? 0 : items.length - 1]?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    const frame = window.requestAnimationFrame(() => menuItemRefs.current[0]?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [items.length, open]);

  if (!items.length && !snapshotsLoading) return null;
  const loadingWithoutAction = snapshotsLoading && items.length === 0;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={loadingWithoutAction ? 'Historical actions are loading' : 'History event actions'}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={loadingWithoutAction}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 text-slate-400 hover:border-cyan-700 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-wait disabled:opacity-80"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="History event actions menu"
          className="absolute right-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-2xl"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => { menuItemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="flex w-full items-center rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-cyan-200 focus-visible:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoryEventCard({
  project,
  event,
  expanded,
  onToggle,
  onNavigateToSource,
  snapshot,
  snapshotsLoading,
  onViewSnapshot,
}: {
  project: Project;
  event: ProjectHistoryEvent;
  expanded: boolean;
  onToggle: () => void;
  onNavigateToSource?: (sourceId: string) => void;
  snapshot?: ProjectSnapshotSummary;
  snapshotsLoading?: boolean;
  onViewSnapshot?: () => void;
}) {
  const source = sourceName(project, event.sourceId);
  const affectedNodes: HistoryNodeSnapshot[] = event.affectedNodes?.length
    ? event.affectedNodes
    : (event.affectedNodeIds ?? [])
      .map((nodeId) => project.nodes.find((node) => node.id === nodeId))
      .filter((node): node is ClarityNode => Boolean(node))
      .map((node) => ({ nodeId: node.id, text: node.text, type: node.type, status: node.status }));
  const changes = event.type === 'decision_resolved'
    ? (event.changes ?? []).filter((change) => change.nodeId !== event.primaryNodeId)
    : event.changes ?? [];
  const hasDetails = eventHasDetails(event);
  const hasSnapshotAction = Boolean(snapshot && onViewSnapshot);
  const hasSourceAction = Boolean(source && event.sourceId && onNavigateToSource);
  const hasHistoryActions = hasSnapshotAction || hasSourceAction || snapshotsLoading;
  const disclosureLabel = expanded
    ? `Hide details for ${event.title}`
    : `Show details for ${event.title}`;

  return (
    <article className={`relative rounded-xl border bg-slate-900/80 p-4 sm:p-5 ${event.type === 'project_started' ? 'border-emerald-800/80' : 'border-slate-800'}`}>
      <span className={`absolute -left-[1.56rem] top-5 h-3 w-3 rounded-full border-2 bg-slate-950 ${event.type === 'project_started' ? 'border-emerald-400' : 'border-cyan-400'}`} aria-hidden="true" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {event.type === 'project_started' && <span className="mb-1 inline-flex rounded-full border border-emerald-700/80 bg-emerald-950/50 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-emerald-300">Project start</span>}
          <h3 className="text-sm font-extrabold text-slate-100">{event.title}</h3>
          <time dateTime={event.createdAt} className="mt-1 block text-xs font-medium text-slate-500">{formatDateTime(event.createdAt)}</time>
          {source && <p className="mt-1 text-xs font-semibold text-cyan-300">{source}</p>}
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center self-start sm:ml-4" aria-label="History event actions">
          {hasHistoryActions ? (
            <HistoryActionsMenu
              hasSnapshot={hasSnapshotAction}
              hasSource={hasSourceAction}
              snapshotsLoading={snapshotsLoading}
              onOpenSnapshot={onViewSnapshot}
              onOpenSource={event.sourceId ? () => onNavigateToSource?.(event.sourceId!) : undefined}
            />
          ) : <span className="block h-8 w-8" aria-hidden="true" />}
        </div>
      </div>

      {hasDetails ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={disclosureLabel}
          className="mt-2 flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs leading-relaxed text-slate-500 transition-colors hover:bg-slate-800/60 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
        >
          <span className="min-w-0">{event.summary ? compactSummary(event.summary) : 'See what changed'}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      ) : event.summary ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{compactSummary(event.summary)}</p>
      ) : null}

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
          {changes.length > 0 && (
            <section className="space-y-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
                {event.type === 'decision_resolved' ? 'This changed' : 'Gapwise learned / changed'}
              </p>
              <div className="space-y-3">
                {changes.map((change, index) => <ChangeRow key={`${change.nodeId ?? change.text}-${index}`} project={project} change={change} />)}
              </div>
            </section>
          )}

          {affectedNodes.length > 0 && (
            <section className="space-y-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Affected</p>
              <ul className="space-y-2">
                {affectedNodes.map((node, index) => (
                  <li key={`${node.nodeId ?? node.text}-${index}`} className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
                    <span className="text-cyan-300" aria-hidden="true">→</span>
                    <span>{node.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(event.focusBefore || event.focusAfter) && (
            <section className="rounded-lg border border-cyan-900/70 bg-cyan-950/20 p-3">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-300">Focus changed</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-200">
                <span>{event.focusBefore?.title ?? 'No focus yet'}</span>
                <GitBranch className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
                <span>{event.focusAfter?.title ?? 'No current focus'}</span>
              </div>
            </section>
          )}

        </div>
      )}
    </article>
  );
}

function focusFromAssessment(assessment: FocusAssessment): ProjectHistoryFocus {
  return {
    title: assessment.title,
    actionNodeId: assessment.targetNodeId ?? assessment.actionNodeId,
    sourceNodeIds: assessment.sourceNodeIds,
    sourceIds: assessment.sourceIds,
  };
}

export function ProjectHistory({ project, userId, onNavigateToSource, onProjectBranched }: ProjectHistoryProps) {
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});
  const [sharedFocus, setSharedFocus] = useState<ProjectHistoryFocus | null | undefined>(undefined);
  const [snapshots, setSnapshots] = useState<ProjectSnapshotSummary[]>([]);
  const [snapshotsProjectId, setSnapshotsProjectId] = useState<string | null>(null);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [selectedSnapshot, setSelectedSnapshot] = useState<MaterializedProjectSnapshot | null>(null);
  const [selectedSnapshotSummary, setSelectedSnapshotSummary] = useState<ProjectSnapshotSummary | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [snapshotIndexError, setSnapshotIndexError] = useState('');
  const [snapshotLoadingId, setSnapshotLoadingId] = useState<string | null>(null);
  const [branchingSnapshotId, setBranchingSnapshotId] = useState<string | null>(null);
  const activeProjectIdRef = useRef(project.id);
  const snapshotRequestIdRef = useRef(0);
  const snapshotControllerRef = useRef<AbortController | null>(null);
  const events = useMemo(
    () => {
      const persisted = [...(project.historyEvents ?? [])];
      if (!persisted.some((event) => event.type === 'project_started')) {
        persisted.push(displayOnlyProjectStartedEvent(project));
      }
      return persisted.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    [project],
  );
  React.useEffect(() => {
    if (!userId) {
      setSharedFocus(undefined);
      return;
    }
    const controller = new AbortController();
    setSharedFocus(undefined);
    authFetch('/api/internal/focus-assessment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, projectId: project.id }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Focus assessment unavailable');
        return response.json() as Promise<{ focusAssessment?: FocusAssessment | null }>;
      })
      .then((body) => setSharedFocus(body.focusAssessment ? focusFromAssessment(body.focusAssessment) : null))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSharedFocus(undefined);
      });
    return () => controller.abort();
  }, [project.id, project.updated_at, userId]);

  React.useEffect(() => {
    activeProjectIdRef.current = project.id;
    setSelectedSnapshot(null);
    setSelectedSnapshotSummary(null);
    setSnapshotError('');
    snapshotRequestIdRef.current += 1;
    snapshotControllerRef.current?.abort();
    snapshotControllerRef.current = null;
    setSnapshotLoadingId(null);
    setBranchingSnapshotId(null);
    setSnapshotsProjectId(null);
    setSnapshotsLoading(true);
    setSnapshots([]);
    setSnapshotIndexError('');
    if (!userId) {
      setSnapshots([]);
      setSnapshotsProjectId(project.id);
      setSnapshotsLoading(false);
      return;
    }
    const controller = new AbortController();
    setSnapshotError('');
    let active = true;
    authFetch(`/api/projects/${encodeURIComponent(project.id)}/snapshots?userId=${encodeURIComponent(userId)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Project history snapshots unavailable');
        return response.json() as Promise<{ snapshots?: ProjectSnapshotSummary[] }>;
      })
      .then((body) => {
        if (!active) return;
        setSnapshots(Array.isArray(body.snapshots) ? body.snapshots : []);
        setSnapshotsProjectId(project.id);
        setSnapshotsLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSnapshots([]);
        setSnapshotsProjectId(project.id);
        setSnapshotsLoading(false);
        setSnapshotIndexError('Historical project actions are temporarily unavailable.');
      });
    return () => {
      active = false;
      controller.abort();
      setSnapshotsLoading(false);
    };
  }, [project.id, userId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSnapshot();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const loadSnapshot = async (summary: ProjectSnapshotSummary) => {
    if (!userId) return;
    const requestId = snapshotRequestIdRef.current + 1;
    snapshotRequestIdRef.current = requestId;
    snapshotControllerRef.current?.abort();
    const controller = new AbortController();
    snapshotControllerRef.current = controller;
    const requestedProjectId = project.id;
    setSelectedSnapshot(null);
    setSnapshotError('');
    setSnapshotLoadingId(summary.id);
    try {
      const response = await authFetch(`/api/projects/${encodeURIComponent(requestedProjectId)}/snapshots/${encodeURIComponent(summary.id)}?userId=${encodeURIComponent(userId)}`, {
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as MaterializedProjectSnapshot & { error?: string };
      if (!response.ok || !body.project || !body.snapshot) throw new Error(body.error ?? 'This historical moment is temporarily unavailable.');
      if (snapshotRequestIdRef.current !== requestId || activeProjectIdRef.current !== requestedProjectId) return;
      setSelectedSnapshot(body);
    } catch (error) {
      if (controller.signal.aborted || snapshotRequestIdRef.current !== requestId || activeProjectIdRef.current !== requestedProjectId) return;
      setSnapshotError(error instanceof Error ? error.message : 'This historical moment is temporarily unavailable.');
    } finally {
      if (snapshotRequestIdRef.current === requestId) {
        setSnapshotLoadingId(null);
        snapshotControllerRef.current = null;
      }
    }
  };

  const openSnapshot = (summary: ProjectSnapshotSummary) => {
    if (!userId || snapshotLoadingId === summary.id) return;
    setSelectedSnapshotSummary(summary);
    setSelectedSnapshot(null);
    setSnapshotError('');
    void loadSnapshot(summary);
  };

  const closeSnapshot = () => {
    snapshotRequestIdRef.current += 1;
    snapshotControllerRef.current?.abort();
    snapshotControllerRef.current = null;
    setSnapshotLoadingId(null);
    setSelectedSnapshot(null);
    setSelectedSnapshotSummary(null);
    setSnapshotError('');
  };

  const branchSelectedSnapshot = async () => {
    if (!selectedSnapshot || !userId) return;
    setBranchingSnapshotId(selectedSnapshot.snapshot.id);
    setSnapshotError('');
    try {
      const branchRequestId = historyBranchRequestId(selectedSnapshot.snapshot.id);
      const response = await authFetch(`/api/projects/${encodeURIComponent(project.id)}/snapshots/${encodeURIComponent(selectedSnapshot.snapshot.id)}/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, clientRequestId: branchRequestId }),
      });
      const body = await response.json().catch(() => ({})) as { project?: Project; error?: string };
      if (!response.ok || !body.project) throw new Error(body.error ?? 'The project could not be created from this moment.');
      closeSnapshot();
      onProjectBranched?.(body.project);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : 'The project could not be created from this moment.');
    } finally {
      setBranchingSnapshotId(null);
    }
  };

  const currentFocus = sharedFocus !== undefined
    ? sharedFocus ?? undefined
    : historyCurrentFocus(project);
  const projectSnapshotsLoading = snapshotsLoading || snapshotsProjectId !== project.id;
  const visibleSnapshots = snapshotsProjectId === project.id ? snapshots : [];
  const visibleSelectedSnapshotSummary = selectedSnapshotSummary?.projectId === project.id ? selectedSnapshotSummary : null;
  const visibleSelectedSnapshot = selectedSnapshot?.project.id === project.id ? selectedSnapshot : null;

  if (events.length === 0) {
    return (
      <section className="mx-auto max-w-3xl rounded-xl border border-dashed border-slate-700 bg-slate-950/60 p-8 text-center">
        <h2 className="text-lg font-extrabold text-slate-100">No project history yet.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          Important changes will appear here as you add context, resolve gaps, and make decisions.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-5" aria-label="Project history">
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">PROJECT HISTORY</p>
        <h2 className="mt-2 text-xl font-extrabold text-slate-100">How this project got here</h2>
        <p className="mt-1 text-sm text-slate-400">Meaningful changes in the project understanding, decisions, and priorities.</p>
        {projectSnapshotsLoading && (
          <div className="mt-3" role="status" aria-label="Loading historical actions">
            <div className="h-px w-full animate-pulse bg-slate-700/80" />
            <span className="sr-only">Loading historical actions</span>
          </div>
        )}
        {snapshotIndexError && (
          <p role="status" className="mt-3 text-xs leading-relaxed text-amber-300">
            Historical project actions are temporarily unavailable.<br />
            The timeline details are still available.
          </p>
        )}
      </div>

      <div className="relative ml-4 space-y-4 border-l border-slate-800 pl-6">
        {events.map((event, index) => {
          const previous = events[index - 1];
          const showDate = !previous || formatDateHeading(previous.createdAt) !== formatDateHeading(event.createdAt);
          const snapshot = snapshotForHistoryEvent(event, visibleSnapshots);
          return (
            <React.Fragment key={event.id}>
              {showDate && <p className="-ml-6 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">{formatDateHeading(event.createdAt)}</p>}
              <HistoryEventCard
                project={project}
                event={event}
                expanded={Boolean(expandedEvents[event.id])}
                onToggle={() => setExpandedEvents((current) => ({ ...current, [event.id]: !current[event.id] }))}
                onNavigateToSource={onNavigateToSource}
                snapshot={snapshot}
                snapshotsLoading={projectSnapshotsLoading}
                onViewSnapshot={() => snapshot && void openSnapshot(snapshot)}
              />
            </React.Fragment>
          );
        })}
      </div>

      <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4 sm:p-5">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-300">NOW</p>
        <p className="mt-2 text-sm font-bold leading-relaxed text-slate-100">{currentFocus?.title ?? 'No current focus is recorded yet.'}</p>
      </div>

      {visibleSelectedSnapshotSummary && (
        <ProjectSnapshotModal
          snapshot={visibleSelectedSnapshot}
          summary={visibleSelectedSnapshotSummary}
          isLoading={snapshotLoadingId === visibleSelectedSnapshotSummary.id && !visibleSelectedSnapshot}
          isBranching={branchingSnapshotId === visibleSelectedSnapshotSummary.id}
          error={snapshotError}
          onRetry={visibleSelectedSnapshot ? undefined : () => void loadSnapshot(visibleSelectedSnapshotSummary)}
          onClose={closeSnapshot}
          onBranch={branchSelectedSnapshot}
        />
      )}
    </section>
  );
}
