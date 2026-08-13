'use client';

import React from 'react';
import { RefreshCw, Target } from 'lucide-react';
import { Project } from '@/types/clarity';
import { AppScope } from '@/types/scope';

type AppTab = 'today' | 'ask' | 'context' | 'you';

interface HeaderProps {
  project: Project;
  projects: Project[];
  scope: AppScope;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  onResetDemo: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectEverything: () => void;
  onOpenNewProject: () => void;
  demoMode?: boolean;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'ask', label: 'Ask' },
  { id: 'context', label: 'Context' },
  { id: 'you', label: 'You' },
];

export const Header: React.FC<HeaderProps> = ({
  project,
  projects,
  scope,
  activeTab,
  setActiveTab,
  onResetDemo,
  onSelectProject,
  onSelectEverything,
  onOpenNewProject,
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
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-sky-500 to-fuchsia-500 p-0.5 shadow-lg shadow-cyan-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Target className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-base sm:text-lg tracking-tight text-slate-100">
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
            className="max-w-[180px] rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 outline-none hover:border-cyan-800 sm:max-w-[240px]"
            aria-label="Gapswise scope"
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

        <div className="flex items-center space-x-2 sm:space-x-3 ml-auto">
          <div className="hidden lg:flex items-center space-x-2 px-2 sm:px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
            <span className="hidden sm:inline text-xs text-slate-400">Clarity Score</span>
            <span className="text-sm font-bold text-cyan-400">{project.clarity_score}%</span>
            <div className="w-12 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-cyan-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${project.clarity_score}%` }}
              />
            </div>
          </div>

          <button
            onClick={onResetDemo}
            title="DEMO_MODE: Reset to Golden Dataset"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-cyan-400 hover:border-cyan-800/50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
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
          className={`h-12 text-xs font-bold ${
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
