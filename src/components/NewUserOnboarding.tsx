'use client';

import React from 'react';
import { FolderPlus, LoaderCircle, LogOut, PlayCircle } from 'lucide-react';

interface NewUserOnboardingProps {
  accountLabel?: string;
  isLoadingDemo: boolean;
  isLoadingCareerDemo?: boolean;
  isLoadingHackathonDemo?: boolean;
  isLoadingKintaGenDemo?: boolean;
  isLoadingBakeryDemo?: boolean;
  isLoadingBakeryJourneyDemo?: boolean;
  isLoadingNorthstarPilotDemo?: boolean;
  isLoadingHarborEarly?: boolean;
  isLoadingHarborMiddle?: boolean;
  isLoadingHarborLate?: boolean;
  error?: string;
  onCreateProject: () => void;
  onLoadDemo: () => void;
  onLoadCareerDemo?: () => void;
  onLoadHackathonDemo?: () => void;
  onLoadKintaGenDemo?: () => void;
  onLoadBakeryDemo?: () => void;
  onLoadBakeryJourneyDemo?: () => void;
  onLoadNorthstarPilotDemo?: () => void;
  onLoadHarborEarly?: () => void;
  onLoadHarborMiddle?: () => void;
  onLoadHarborLate?: () => void;
  onSignOut: () => void;
}

export const NewUserOnboarding: React.FC<NewUserOnboardingProps> = ({
  accountLabel,
  isLoadingDemo,
  isLoadingCareerDemo = false,
  isLoadingHackathonDemo = false,
  isLoadingKintaGenDemo = false,
  isLoadingBakeryDemo = false,
  isLoadingBakeryJourneyDemo = false,
  isLoadingNorthstarPilotDemo = false,
  isLoadingHarborEarly = false,
  isLoadingHarborMiddle = false,
  isLoadingHarborLate = false,
  error,
  onCreateProject,
  onLoadDemo,
  onLoadCareerDemo,
  onLoadHackathonDemo,
  onLoadKintaGenDemo,
  onLoadBakeryDemo,
  onLoadBakeryJourneyDemo,
  onLoadNorthstarPilotDemo,
  onLoadHarborEarly,
  onLoadHarborMiddle,
  onLoadHarborLate,
  onSignOut,
}) => (
  <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-12 text-slate-100">
    <section className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl sm:p-9">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-cyan-400">GAPWISE</p>
          <h1 className="mt-3 text-2xl font-extrabold">No projects yet</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Start with a clean workspace, or load a reusable Gapwise demo into your account.
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

      <div className={`mt-8 grid gap-3 ${[onLoadCareerDemo, onLoadHackathonDemo, onLoadKintaGenDemo, onLoadBakeryDemo, onLoadBakeryJourneyDemo, onLoadNorthstarPilotDemo, onLoadHarborEarly, onLoadHarborMiddle, onLoadHarborLate].filter(Boolean).length >= 2 ? 'sm:grid-cols-4' : onLoadCareerDemo || onLoadHackathonDemo || onLoadKintaGenDemo || onLoadBakeryDemo || onLoadBakeryJourneyDemo || onLoadNorthstarPilotDemo || onLoadHarborEarly || onLoadHarborMiddle || onLoadHarborLate ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
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
        {onLoadCareerDemo && (
          <button
            type="button"
            onClick={onLoadCareerDemo}
            disabled={isLoadingCareerDemo}
            title="Run or reset the career conflict demo"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-amber-800/80 bg-amber-950/20 p-4 text-left transition hover:border-amber-500 hover:bg-amber-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-amber-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingCareerDemo ? 'Loading career demo...' : 'Career demo'}
            </span>
          </button>
        )}
        {onLoadHackathonDemo && (
          <button
            type="button"
            onClick={onLoadHackathonDemo}
            disabled={isLoadingHackathonDemo}
            title="Load or reset the HarborHelp voluntary demo"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-cyan-800/80 bg-cyan-950/20 p-4 text-left transition hover:border-cyan-500 hover:bg-cyan-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-cyan-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingHackathonDemo ? 'Loading voluntary demo...' : 'Voluntary demo'}
            </span>
          </button>
        )}
        {onLoadKintaGenDemo && (
          <button
            type="button"
            onClick={onLoadKintaGenDemo}
            disabled={isLoadingKintaGenDemo}
            title="Load or reset the KintaGen scientific AI assistant demo"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-fuchsia-800/80 bg-fuchsia-950/20 p-4 text-left transition hover:border-fuchsia-500 hover:bg-fuchsia-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-fuchsia-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingKintaGenDemo ? 'Loading scientific assistant...' : 'Scientific AI assistant'}
            </span>
          </button>
        )}
        {onLoadBakeryDemo && (
          <button
            type="button"
            onClick={onLoadBakeryDemo}
            disabled={isLoadingBakeryDemo}
            title="Load or reset the weekend bakery pop-up demo"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-orange-800/80 bg-orange-950/20 p-4 text-left transition hover:border-orange-500 hover:bg-orange-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-orange-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingBakeryDemo ? 'Loading bakery pop-up demo...' : 'Bakery pop-up demo'}
            </span>
          </button>
        )}
        {onLoadBakeryJourneyDemo && (
          <button
            type="button"
            onClick={onLoadBakeryJourneyDemo}
            disabled={isLoadingBakeryJourneyDemo}
            title="Replay the multi-step bakery project journey"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-emerald-800/80 bg-emerald-950/20 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-emerald-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingBakeryJourneyDemo ? 'Loading bakery journey...' : 'Bakery journey'}
            </span>
          </button>
        )}
        {onLoadNorthstarPilotDemo && (
          <button
            type="button"
            onClick={onLoadNorthstarPilotDemo}
            disabled={isLoadingNorthstarPilotDemo}
            title="Replay the evolving Northstar Logistics pilot project"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-violet-800/80 bg-violet-950/20 p-4 text-left transition hover:border-violet-500 hover:bg-violet-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-violet-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingNorthstarPilotDemo ? 'Loading Northstar pilot...' : 'Northstar pilot'}
            </span>
          </button>
        )}
        {onLoadHarborEarly && (
          <button
            type="button"
            onClick={onLoadHarborEarly}
            disabled={isLoadingHarborEarly || isLoadingHarborMiddle || isLoadingHarborLate}
            title="Build the Harbor Hotels early checkpoint with live AI"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-cyan-800/80 bg-cyan-950/20 p-4 text-left transition hover:border-cyan-500 hover:bg-cyan-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-cyan-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingHarborEarly ? 'Building Harbor · Early...' : 'Harbor Hotels · Early'}
            </span>
          </button>
        )}
        {onLoadHarborMiddle && (
          <button
            type="button"
            onClick={onLoadHarborMiddle}
            disabled={isLoadingHarborEarly || isLoadingHarborMiddle || isLoadingHarborLate}
            title="Build the Harbor Hotels middle checkpoint with live AI"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-amber-800/80 bg-amber-950/20 p-4 text-left transition hover:border-amber-500 hover:bg-amber-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-amber-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingHarborMiddle ? 'Building Harbor · Middle...' : 'Harbor Hotels · Middle'}
            </span>
          </button>
        )}
        {onLoadHarborLate && (
          <button
            type="button"
            onClick={onLoadHarborLate}
            disabled={isLoadingHarborEarly || isLoadingHarborMiddle || isLoadingHarborLate}
            title="Build the Harbor Hotels late checkpoint with live AI"
            className="flex min-h-28 flex-col items-start justify-between rounded-xl border border-emerald-800/80 bg-emerald-950/20 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-950/30 disabled:cursor-wait disabled:opacity-60"
          >
            <PlayCircle className="h-5 w-5 text-emerald-300" />
            <span className="text-sm font-bold text-slate-100">
              {isLoadingHarborLate ? 'Building Harbor · Late...' : 'Harbor Hotels · Late'}
            </span>
          </button>
        )}
      </div>

      {(isLoadingDemo || isLoadingCareerDemo || isLoadingHackathonDemo || isLoadingKintaGenDemo || isLoadingBakeryDemo || isLoadingBakeryJourneyDemo || isLoadingNorthstarPilotDemo || isLoadingHarborEarly || isLoadingHarborMiddle || isLoadingHarborLate) && (
        <div className="mt-5 rounded-xl border border-cyan-900/60 bg-slate-950/70 p-4" aria-live="polite" role="status">
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading your demo data…
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-2 animate-pulse rounded-full bg-slate-800" />)}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-5 rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs leading-5 text-rose-200">
          {error}
        </p>
      )}
    </section>
  </main>
);
