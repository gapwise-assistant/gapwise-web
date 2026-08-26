'use client';

import { X } from 'lucide-react';
import type { ProjectSnapshot } from '@/types/projectSnapshot';

interface ProjectSnapshotModalProps {
  snapshot: ProjectSnapshot;
  isBranching?: boolean;
  error?: string;
  onClose: () => void;
  onBranch: () => void;
}

function countNodes(snapshot: ProjectSnapshot, type: string, status?: string): number {
  return snapshot.project.nodes.filter((node) =>
    node.type === type && (!status || node.status === status),
  ).length;
}

function timestamp(value: string): string {
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

export function ProjectSnapshotModal({ snapshot, isBranching = false, error, onClose, onBranch }: ProjectSnapshotModalProps) {
  const pendingProposals = snapshot.ask.messages
    .flatMap((message) => message.contextProposals ?? message.proposals ?? [])
    .filter((proposal) => (proposal.confirmationStatus ?? 'pending') === 'pending');
  const focus = snapshot.assessments.today?.focusAssessment ?? snapshot.assessments.focus;
  const openQuestions = countNodes(snapshot, 'UNKNOWN', 'OPEN') + countNodes(snapshot, 'ASSUMPTION', 'OPEN');
  const openDecisions = countNodes(snapshot, 'DECISION', 'OPEN');
  const resolvedDecisions = countNodes(snapshot, 'DECISION', 'RESOLVED');
  const activeSources = snapshot.project.sources.filter((source) => source.processing_status !== 'failed').length;

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
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">Historical snapshot</p>
            <h2 id="project-snapshot-title" className="mt-1 text-lg font-extrabold text-slate-100">Project at this moment</h2>
            <p className="mt-1 text-xs text-slate-500">{timestamp(snapshot.createdAt)} · {snapshot.label}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close snapshot" className="rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-slate-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {snapshot.summary && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{snapshot.summary}</p>}

          <section>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Project state</p>
            <p className="mt-2 text-base font-bold text-slate-100">{snapshot.project.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">{snapshot.project.goal}</p>
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
              <p className="mt-2 text-sm text-slate-300">{snapshot.ask.chats.length} chat{snapshot.ask.chats.length === 1 ? '' : 's'} · {snapshot.ask.messages.length} message{snapshot.ask.messages.length === 1 ? '' : 's'}</p>
              <p className="mt-1 text-xs text-slate-500">{pendingProposals.length} pending project update{pendingProposals.length === 1 ? '' : 's'}</p>
            </div>
          </section>

          {snapshot.assessments.overview && (
            <section>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Overview at this moment</p>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">{snapshot.assessments.overview.summary}</p>
            </section>
          )}

          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 hover:border-slate-500 hover:text-slate-100">Close</button>
          <button type="button" onClick={onBranch} disabled={isBranching} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-400 disabled:cursor-wait disabled:opacity-60">
            {isBranching ? 'Creating project…' : 'Create project from this moment'}
          </button>
        </footer>
      </section>
    </div>
  );
}
