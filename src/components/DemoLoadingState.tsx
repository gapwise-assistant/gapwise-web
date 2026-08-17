'use client';

import React from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';

interface DemoLoadingStateProps {
  label: string;
}

/** A calm transition state while a deterministic demo replaces project data. */
export const DemoLoadingState: React.FC<DemoLoadingStateProps> = ({ label }) => (
  <section
    className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
    aria-busy="true"
    aria-live="polite"
    role="status"
  >
    <div className="rounded-2xl border border-cyan-900/60 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20 sm:p-7">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-800/70 bg-cyan-950/50 text-cyan-300">
          <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-100">Loading {label}</p>
          <p className="mt-1 text-xs text-slate-400">Replacing project data and refreshing your briefing…</p>
        </div>
      </div>

      <div className="mt-7 grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)]">
        <div className="h-28 animate-pulse rounded-xl border border-slate-800 bg-slate-950/70" />
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex animate-pulse items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <Sparkles className="h-4 w-4 shrink-0 text-slate-700" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-2/5 rounded bg-slate-800" />
                <div className="h-3 w-4/5 rounded bg-slate-800/80" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);
