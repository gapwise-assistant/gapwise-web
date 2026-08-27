'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, GitBranch } from 'lucide-react';
import type { ClarityNode, HistoryNodeSnapshot, Project, ProjectHistoryChange, ProjectHistoryEvent, ProjectHistoryFocus } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { historyCurrentFocus } from '@/lib/history/projectHistory';
import { authFetch } from '@/lib/auth/client';
import type { MaterializedProjectSnapshot, ProjectSnapshotSummary } from '@/types/projectSnapshot';
import { ProjectSnapshotModal } from '@/components/ProjectSnapshotModal';

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
  return `history-branch:${snapshotId.slice(-96)}`;
}

const CHANGE_LABELS: Record<ProjectHistoryChange['kind'], string> = {
  learned: 'Learned',
  resolved: 'Resolved',
  unblocked: 'Unblocked',
  became_actionable: 'Became actionable',
  invalidated: 'Invalidated',
  updated: 'Updated',
};

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}

function timestampLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
}

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
  return Boolean(event.changes?.length || event.affectedNodes?.length || event.affectedNodeIds?.length || event.sourceId || event.focusBefore || event.focusAfter);
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

function HistoryEventCard({
  project,
  event,
  expanded,
  onToggle,
  onNavigateToSource,
  snapshot,
  onViewSnapshot,
  snapshotLoading,
}: {
  project: Project;
  event: ProjectHistoryEvent;
  expanded: boolean;
  onToggle: () => void;
  onNavigateToSource?: (sourceId: string) => void;
  snapshot?: ProjectSnapshotSummary;
  onViewSnapshot?: () => void;
  snapshotLoading?: boolean;
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

  return (
    <article className={`relative rounded-xl border bg-slate-900/80 p-4 sm:p-5 ${event.type === 'project_started' ? 'border-emerald-800/80' : 'border-slate-800'}`}>
      <span className={`absolute -left-[1.56rem] top-5 h-3 w-3 rounded-full border-2 bg-slate-950 ${event.type === 'project_started' ? 'border-emerald-400' : 'border-cyan-400'}`} aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {event.type === 'project_started' && <span className="mb-1 inline-flex rounded-full border border-emerald-700/80 bg-emerald-950/50 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-emerald-300">Project start</span>}
          <h3 className="text-sm font-extrabold text-slate-100">{event.title}</h3>
          <time dateTime={event.createdAt} className="mt-1 block text-xs font-medium text-slate-500">{timestampLabel(event.createdAt)}</time>
          {source && <p className="mt-1 text-xs font-semibold text-cyan-300">{source}</p>}
        </div>
        {eventHasDetails(event) && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
          >
            {expanded ? 'Hide details' : 'Show details'}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
        {snapshot && (
          <button
            type="button"
            onClick={onViewSnapshot}
            disabled={snapshotLoading}
            className="inline-flex shrink-0 items-center rounded-md border border-cyan-800/80 bg-cyan-950/30 px-2.5 py-1.5 text-xs font-bold text-cyan-200 hover:border-cyan-500 hover:bg-cyan-900/40"
          >
            {snapshotLoading ? 'Loading…' : 'View this moment'}
          </button>
        )}
      </div>

      {event.summary && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-300">{event.summary}</p>}

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

          {source && onNavigateToSource && event.sourceId && (
            <button type="button" onClick={() => onNavigateToSource(event.sourceId!)} className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-300 hover:text-cyan-100">
              Open source <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
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
  const [selectedSnapshot, setSelectedSnapshot] = useState<MaterializedProjectSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [loadingSnapshotId, setLoadingSnapshotId] = useState<string | null>(null);
  const [branchingSnapshotId, setBranchingSnapshotId] = useState<string | null>(null);
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
    if (!userId) {
      setSnapshots([]);
      return;
    }
    const controller = new AbortController();
    setSnapshotError('');
    authFetch(`/api/projects/${encodeURIComponent(project.id)}/snapshots?userId=${encodeURIComponent(userId)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Project history snapshots unavailable');
        return response.json() as Promise<{ snapshots?: ProjectSnapshotSummary[] }>;
      })
      .then((body) => setSnapshots(Array.isArray(body.snapshots) ? body.snapshots : []))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSnapshots([]);
        setSnapshotError('Historical snapshots are temporarily unavailable.');
      });
    return () => controller.abort();
  }, [project.id, userId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedSnapshot(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const openSnapshot = async (summary: ProjectSnapshotSummary) => {
    if (!userId) return;
    setLoadingSnapshotId(summary.id);
    setSnapshotError('');
    try {
      const response = await authFetch(`/api/projects/${encodeURIComponent(project.id)}/snapshots/${encodeURIComponent(summary.id)}?userId=${encodeURIComponent(userId)}`);
      const body = await response.json().catch(() => ({})) as MaterializedProjectSnapshot & { error?: string };
      if (!response.ok || !body.project || !body.snapshot) throw new Error(body.error ?? 'This historical moment is temporarily unavailable.');
      setSelectedSnapshot(body);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : 'This historical moment is temporarily unavailable.');
    } finally {
      setLoadingSnapshotId(null);
    }
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
      setSelectedSnapshot(null);
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
      </div>

      <div className="relative ml-4 space-y-4 border-l border-slate-800 pl-6">
        {events.map((event, index) => {
          const previous = events[index - 1];
          const showDate = !previous || dateLabel(previous.createdAt) !== dateLabel(event.createdAt);
          const snapshot = snapshotForHistoryEvent(event, snapshots);
          return (
            <React.Fragment key={event.id}>
              {showDate && <p className="-ml-6 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">{dateLabel(event.createdAt)}</p>}
              <HistoryEventCard
                project={project}
                event={event}
                expanded={Boolean(expandedEvents[event.id])}
                onToggle={() => setExpandedEvents((current) => ({ ...current, [event.id]: !current[event.id] }))}
                onNavigateToSource={onNavigateToSource}
                snapshot={snapshot}
                snapshotLoading={snapshot?.id === loadingSnapshotId}
                onViewSnapshot={() => snapshot && void openSnapshot(snapshot)}
              />
            </React.Fragment>
          );
        })}
      </div>

      {snapshotError && !selectedSnapshot && <p role="status" className="text-xs text-amber-300">{snapshotError}</p>}

      <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4 sm:p-5">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-300">NOW</p>
        <p className="mt-2 text-sm font-bold leading-relaxed text-slate-100">{currentFocus?.title ?? 'No current focus is recorded yet.'}</p>
      </div>

      {selectedSnapshot && (
        <ProjectSnapshotModal
          snapshot={selectedSnapshot}
          isBranching={branchingSnapshotId === selectedSnapshot.snapshot.id}
          error={snapshotError}
          onClose={() => setSelectedSnapshot(null)}
          onBranch={branchSelectedSnapshot}
        />
      )}
    </section>
  );
}
