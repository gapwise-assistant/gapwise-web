'use client';

import React from 'react';
import { RefreshCw, Settings2, Target } from 'lucide-react';
import { Project } from '@/types/clarity';
import { AppScope } from '@/types/scope';
import { AppDestination, PRIMARY_NAVIGATION } from '@/lib/navigation';

type AppTab = AppDestination;

interface HeaderProps {
  projects: Project[];
  scope: AppScope;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  onResetDemo: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectEverything: () => void;
  onOpenNewProject: () => void;
  onOpenSettings: () => void;
  accountLabel?: string;
  demoMode?: boolean;
}

const NAV_ITEMS = PRIMARY_NAVIGATION;

export const Header: React.FC<HeaderProps> = ({
  projects,
  scope,
  activeTab,
  setActiveTab,
  onResetDemo,
  onSelectProject,
  onSelectEverything,
  onOpenNewProject,
  onOpenSettings,
  accountLabel,
  demoMode = false,
}) => {
  const handleProjectSelect = (value: string) => {
    if (value === '__new_project__') {
      onOpenNewProject();
      return;
    }
    if (value === '__everything__') {
      onSelectEverything();
      return;
    }
    onSelectProject(value);
  };

  return (
    <>
    <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-14 sm:min-h-16 py-2 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:gap-3">
          <div className="h-8 w-8 shrink-0 rounded-xl bg-gradient-to-tr from-cyan-500 via-sky-500 to-fuchsia-500 p-0.5 shadow-lg shadow-cyan-500/20 sm:h-10 sm:w-10">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Target className="h-4 w-4 text-cyan-400 sm:h-5 sm:w-5" />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-tight text-slate-100 sm:text-lg">
                GAPSWISE
              </span>
              <span className="hidden lg:inline px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 rounded-full">
                Persistent v1.0
              </span>
              {demoMode && (
                <span className="rounded border border-amber-800 bg-amber-950/60 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">
                  Demo mode
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 hidden lg:block">
              Find the question that unlocks the next decision.
            </p>
          </div>
          <select
            value={scope.type === 'project' ? scope.projectId : '__everything__'}
            onChange={(event) => handleProjectSelect(event.target.value)}
            className="min-w-0 max-w-[170px] flex-1 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-2 text-[11px] font-semibold text-slate-200 outline-none hover:border-cyan-800 sm:max-w-[240px] sm:flex-none sm:px-3 sm:text-xs"
            aria-label="Workspace selector"
          >
            <option value="__everything__" className="bg-slate-900">Everything</option>
            <optgroup label="Projects">
              {projects.map((item) => (
                <option key={item.id} value={item.id} className="bg-slate-900">
                  {item.title}
                </option>
              ))}
            </optgroup>
            <option disabled className="bg-slate-900">
              ─────────────
            </option>
            <option value="__new_project__" className="bg-slate-900">
              + New project
            </option>
          </select>
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === item.id
                  ? 'text-cyan-300'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center space-x-2 sm:space-x-3">
          {demoMode && (
            <button
              onClick={onResetDemo}
              title="Reset local demo data"
              className="h-11 w-11 rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors hover:border-cyan-800/50 hover:text-cyan-400 sm:h-auto sm:w-auto"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            title={accountLabel ? `Settings for ${accountLabel}` : 'Settings'}
            aria-label={accountLabel ? `Settings for ${accountLabel}` : 'Settings'}
            className={`h-11 w-11 rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors hover:border-cyan-800/50 hover:text-cyan-300 sm:h-auto sm:w-auto ${activeTab === 'settings' ? 'border-cyan-800 text-cyan-300' : ''}`}
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 grid grid-cols-4 border-t border-slate-800 bg-slate-950/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-md">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setActiveTab(item.id)}
          className={`min-h-12 min-w-0 text-xs font-bold ${
            activeTab === item.id ? 'text-cyan-300' : 'text-slate-500'
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
    </>
  );
};
