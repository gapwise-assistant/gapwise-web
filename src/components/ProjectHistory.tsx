'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, GitBranch } from 'lucide-react';
import type { ClarityNode, HistoryNodeSnapshot, Project, ProjectHistoryChange, ProjectHistoryEvent, ProjectHistoryFocus } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { historyCurrentFocus } from '@/lib/history/projectHistory';
import { authFetch } from '@/lib/auth/client';

interface ProjectHistoryProps {
  project: Project;
  userId?: string;
  onNavigateToSource?: (sourceId: string) => void;
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
}: {
  project: Project;
  event: ProjectHistoryEvent;
  expanded: boolean;
  onToggle: () => void;
  onNavigateToSource?: (sourceId: string) => void;
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
    <article className="relative rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
      <span className="absolute -left-[1.56rem] top-5 h-3 w-3 rounded-full border-2 border-cyan-400 bg-slate-950" aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-slate-100">{event.title}</h3>
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
    actionNodeId: assessment.actionNodeId,
    sourceNodeIds: assessment.sourceNodeIds,
    sourceIds: assessment.sourceIds,
  };
}

export function ProjectHistory({ project, userId, onNavigateToSource }: ProjectHistoryProps) {
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});
  const [sharedFocus, setSharedFocus] = useState<ProjectHistoryFocus | null | undefined>(undefined);
  const events = useMemo(
    () => [...(project.historyEvents ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [project.historyEvents],
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
          return (
            <React.Fragment key={event.id}>
              {showDate && <p className="-ml-6 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">{dateLabel(event.createdAt)}</p>}
              <HistoryEventCard
                project={project}
                event={event}
                expanded={Boolean(expandedEvents[event.id])}
                onToggle={() => setExpandedEvents((current) => ({ ...current, [event.id]: !current[event.id] }))}
                onNavigateToSource={onNavigateToSource}
              />
            </React.Fragment>
          );
        })}
      </div>

      <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4 sm:p-5">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-300">NOW</p>
        <p className="mt-2 text-sm font-bold leading-relaxed text-slate-100">{currentFocus?.title ?? 'No current focus is recorded yet.'}</p>
      </div>
    </section>
  );
}
