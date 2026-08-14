'use client';

import React from 'react';
import { FolderPlus, LogOut, PlayCircle } from 'lucide-react';

interface NewUserOnboardingProps {
  accountLabel?: string;
  isLoadingDemo: boolean;
  error?: string;
  onCreateProject: () => void;
  onLoadDemo: () => void;
  onSignOut: () => void;
}

export const NewUserOnboarding: React.FC<NewUserOnboardingProps> = ({
  accountLabel,
  isLoadingDemo,
  error,
  onCreateProject,
  onLoadDemo,
  onSignOut,
}) => (
  <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-12 text-slate-100">
    <section className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl sm:p-9">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-cyan-400">GAPSWISE</p>
          <h1 className="mt-3 text-2xl font-extrabold">No projects yet</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Start with a clean workspace, or load the reusable Gapswise demo into your account.
          </p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-400 transition hover:border-rose-800 hover:text-rose-300"
          aria-label={accountLabel ? `Sign out of ${accountLabel}` : 'Sign out'}
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onCreateProject}
          className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-cyan-700/70 bg-cyan-500/10 p-4 text-left transition hover:border-cyan-400 hover:bg-cyan-500/15"
        >
          <FolderPlus className="h-5 w-5 text-cyan-300" />
          <span className="text-sm font-bold text-slate-100">Create project</span>
        </button>
        <button
          type="button"
          onClick={onLoadDemo}
          disabled={isLoadingDemo}
          className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-slate-700 bg-slate-950 p-4 text-left transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
        >
          <PlayCircle className="h-5 w-5 text-amber-300" />
          <span className="text-sm font-bold text-slate-100">
            {isLoadingDemo ? 'Loading demo...' : 'Load demo'}
          </span>
        </button>
      </div>

      {error && (
        <p className="mt-5 rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs leading-5 text-rose-200">
          {error}
        </p>
      )}
    </section>
  </main>
);
