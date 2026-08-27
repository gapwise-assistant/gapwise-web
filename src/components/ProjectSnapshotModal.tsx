'use client';

import { X } from 'lucide-react';
import type { MaterializedProjectSnapshot, ProjectSnapshotSummary } from '@/types/projectSnapshot';
import { formatDateTime } from '@/lib/datetime/displayDateTime';
import { projectTitlePresentation } from '@/lib/projects/projectTitle';

interface ProjectSnapshotModalProps {
  snapshot: MaterializedProjectSnapshot | null;
  summary?: ProjectSnapshotSummary | null;
  isLoading?: boolean;
  isBranching?: boolean;
  error?: string;
  onRetry?: () => void;
  onClose: () => void;
  onBranch: () => void;
}

function countNodes(project: MaterializedProjectSnapshot['project'], type: string, status?: string): number {
  return project.nodes.filter((node) =>
    node.type === type && (!status || node.status === status),
  ).length;
}

function SnapshotSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading historical project state">
      <div className="space-y-2">
        <div className="h-4 w-2/5 animate-pulse rounded bg-slate-800" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-slate-900" />
        <div className="h-3 w-3/5 animate-pulse rounded bg-slate-900" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-900" />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-20 animate-pulse rounded-xl bg-cyan-950/30" />
        <div className="h-20 animate-pulse rounded-xl bg-slate-900" />
      </div>
      <div className="h-16 animate-pulse rounded-lg bg-slate-900" />
    </div>
  );
}

function SnapshotContent({ materialized }: { materialized: MaterializedProjectSnapshot }) {
  const { snapshot, project, ask, assessments, missingReferences } = materialized;
  const pendingProposals = ask.messages
    .flatMap((message) => message.contextProposals ?? message.proposals ?? [])
    .filter((proposal) => {
      const confirmationStatus = proposal.confirmationStatus ?? (proposal.status as unknown);
      return confirmationStatus !== 'added' && confirmationStatus !== 'dismissed';
    });
  const focus = assessments.today?.focusAssessment ?? assessments.focus;
  const openQuestions = countNodes(project, 'UNKNOWN', 'OPEN') + countNodes(project, 'ASSUMPTION', 'OPEN');
  const openDecisions = countNodes(project, 'DECISION', 'OPEN');
  const resolvedDecisions = countNodes(project, 'DECISION', 'RESOLVED');
  const activeSources = project.sources.filter((source) => source.processing_status !== 'failed').length;

  return (
    <>
      {snapshot.summary && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{snapshot.summary}</p>}

      <section>
        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Project state</p>
        <p className="mt-2 text-base font-bold text-slate-100">{projectTitlePresentation(project.title).title}</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">{project.goal}</p>
        {project.branch?.snapshotCreatedAt && (
          <p className="mt-2 text-xs text-slate-500">
            Branched from the source project at {formatDateTime(project.branch.snapshotCreatedAt)}.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Open questions', openQuestions],
            ['Open decisions', openDecisions],
            ['Resolved decisions', resolvedDecisions],
            ['Sources', activeSources],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-extrabold text-slate-100">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-300">Recommended focus</p>
          <p className="mt-2 text-sm font-bold leading-relaxed text-slate-100">{focus?.title ?? 'No focus assessment was saved at this moment.'}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Ask activity</p>
          <p className="mt-2 text-sm text-slate-300">{ask.chats.length} chat{ask.chats.length === 1 ? '' : 's'} · {ask.messages.length} message{ask.messages.length === 1 ? '' : 's'}</p>
          <p className="mt-1 text-xs text-slate-500">{pendingProposals.length} pending project update{pendingProposals.length === 1 ? '' : 's'}</p>
        </div>
      </section>

      {assessments.overview && (
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Overview at this moment</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">{assessments.overview.summary}</p>
        </section>
      )}

      {missingReferences.length > 0 && (
        <p role="status" className="text-xs text-amber-300">
          Some historical records are unavailable: {missingReferences.map((item) => `${item.type}:${item.id}`).join(', ')}.
        </p>
      )}
    </>
  );
}

export function ProjectSnapshotModal({ snapshot: materialized, summary, isLoading = false, isBranching = false, error, onRetry, onClose, onBranch }: ProjectSnapshotModalProps) {
  const snapshotMeta = materialized?.snapshot ?? summary;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-snapshot-title"
        className="flex max-h-[min(780px,calc(100vh-1.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl sm:max-h-[calc(100vh-3rem)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">Project history</p>
            <h2 id="project-snapshot-title" className="mt-1 text-lg font-extrabold text-slate-100">Project at this moment</h2>
            <p className="mt-1 text-xs text-slate-500">
              {snapshotMeta ? `${formatDateTime(snapshotMeta.createdAt)} · ${snapshotMeta.label}` : 'Loading historical state…'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <p className="text-sm leading-relaxed text-slate-400">
            This shows the project, conversations, decisions, and context as they existed at this point in its history.
          </p>
          {materialized ? <SnapshotContent materialized={materialized} /> : isLoading ? <SnapshotSkeleton /> : null}
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          {!materialized && !isLoading && !error && <p role="status" className="text-sm text-slate-400">This historical moment is unavailable.</p>}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-slate-500 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80">Close</button>
          {error && onRetry && (
            <button type="button" onClick={onRetry} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-slate-500 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80">Retry</button>
          )}
          <button type="button" onClick={onBranch} disabled={isBranching || isLoading || !materialized} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-wait disabled:opacity-60">
            {isBranching ? 'Creating project…' : 'Create a new project from here'}
          </button>
        </footer>
      </section>
    </div>
  );
}
