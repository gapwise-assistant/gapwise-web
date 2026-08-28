'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, LoaderCircle, X } from 'lucide-react';

export interface HistoryResetPreview {
  projects: number;
  snapshots: number;
  askChats: number;
  askMessages: number;
  sources: number;
  cloudObjects: number;
}

export type HistoryRebuildPhase =
  | 'Deleting old data…'
  | 'Creating Harbor…'
  | 'Creating Riverside…'
  | 'Preparing workspace history…'
  | 'Complete';

interface RebuildHistoryDemosModalProps {
  preview: HistoryResetPreview | null;
  previewError?: string;
  phase: HistoryRebuildPhase;
  isLoadingPreview: boolean;
  isRunning: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}

const CONFIRMATION = 'DELETE_MY_LOCAL_DATA_AND_REBUILD_DEMOS';
const PHASES: HistoryRebuildPhase[] = [
  'Deleting old data…',
  'Creating Harbor…',
  'Creating Riverside…',
  'Preparing workspace history…',
  'Complete',
];

export function RebuildHistoryDemosModal({
  preview,
  previewError,
  phase,
  isLoadingPreview,
  isRunning,
  error,
  onConfirm,
  onClose,
}: RebuildHistoryDemosModalProps) {
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRunning) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRunning, onClose]);

  const phaseIndex = PHASES.indexOf(phase);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !isRunning) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="rebuild-history-demos-title"
        className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl shadow-slate-950/70 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-rose-300">Developer-only reset</p>
            <h2 id="rebuild-history-demos-title" className="mt-2 text-xl font-bold text-slate-100">Rebuild Harbor + Riverside</h2>
          </div>
          <button type="button" onClick={onClose} disabled={isRunning} aria-label="Close" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {isRunning ? (
          <div className="mt-6" aria-live="polite" aria-busy="true">
            <p className="text-sm font-semibold text-slate-200">{phase}</p>
            <div className="mt-4 space-y-2">
              {PHASES.map((item, index) => (
                <div key={item} className={`flex items-center gap-2 text-xs ${index < phaseIndex ? 'text-emerald-300' : index === phaseIndex ? 'text-cyan-200' : 'text-slate-600'}`}>
                  {index < phaseIndex ? <Check className="h-4 w-4" aria-hidden="true" /> : index === phaseIndex ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <span className="ml-1.5 h-1 w-1 rounded-full bg-current" />}
                  {item}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5 flex gap-3 rounded-xl border border-rose-900/70 bg-rose-950/30 p-4 text-sm text-rose-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />
              <p>This permanently deletes the current authenticated local user’s workspaces, history, snapshots, Ask data, and uploaded demo PDFs before creating two fresh demos.</p>
            </div>
            {isLoadingPreview ? (
              <div className="mt-5 h-24 animate-pulse rounded-xl bg-slate-950/70" aria-label="Loading reset preview" />
            ) : preview ? (
              <dl className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                {Object.entries(preview).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <dt className="text-slate-500">{label.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</dt>
                    <dd className="mt-1 text-lg font-bold text-slate-100">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {(previewError || error) && <p role="alert" className="mt-4 text-xs text-rose-300">{previewError ?? error}</p>}
            <label className="mt-5 block text-xs font-semibold text-slate-300" htmlFor="history-reset-confirmation">
              Type <code className="rounded bg-slate-950 px-1.5 py-0.5 text-rose-200">{CONFIRMATION}</code> to enable the reset.
              <input id="history-reset-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none focus:border-rose-500" autoComplete="off" />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-slate-100">Cancel</button>
              <button type="button" onClick={onConfirm} disabled={confirmation !== CONFIRMATION || isLoadingPreview} className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40">Delete and rebuild</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
