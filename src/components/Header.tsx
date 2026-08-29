'use client';

import React, { useRef, useState } from 'react';
import NextImage from 'next/image';
import { LoaderCircle, PlayCircle, RefreshCw, Settings2 } from 'lucide-react';
import { Project } from '@/types/clarity';
import { WorkspaceScope } from '@/types/scope';
import { AppDestination, PRIMARY_NAVIGATION } from '@/lib/navigation';
import { closeOpenMenus, useDismissibleMenu } from '@/lib/ui/useDismissibleMenu';
import { formatCompactDateTime, formatDateTime } from '@/lib/datetime/displayDateTime';
import { projectTitlePresentation } from '@/lib/projects/projectTitle';
import type { AccessTier } from '@/lib/auth/server';

type AppTab = AppDestination;

interface HeaderProps {
  projects: Project[];
  scope: WorkspaceScope | null;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  onResetDemo: () => void;
  onCreateQuickDemo?: () => void;
  isLoadingQuickDemo?: boolean;
  onCreateHarborHistoryDemo?: () => void;
  isLoadingHarborHistoryDemo?: boolean;
  onCreateRiversideHistoryDemo?: () => void;
  isLoadingRiversideHistoryDemo?: boolean;
  onCleanupLocalData?: () => void;
  isCleaningUpLocalData?: boolean;
  onSelectProject: (projectId: string) => void;
  onOpenNewProject: () => void;
  onOpenSettings: () => void;
  isSettingsOpen: boolean;
  accountLabel?: string;
  demoMode?: boolean;
  accessTier?: AccessTier | null;
}

const NAV_ITEMS = PRIMARY_NAVIGATION;

export const Header: React.FC<HeaderProps> = ({
  projects,
  scope,
  activeTab,
  setActiveTab,
  onResetDemo,
  onCreateQuickDemo,
  isLoadingQuickDemo = false,
  onCreateHarborHistoryDemo,
  isLoadingHarborHistoryDemo = false,
  onCreateRiversideHistoryDemo,
  isLoadingRiversideHistoryDemo = false,
  onCleanupLocalData,
  isCleaningUpLocalData = false,
  onSelectProject,
  onOpenNewProject,
  onOpenSettings,
  isSettingsOpen,
  accountLabel,
  demoMode = false,
  accessTier = null,
}) => {
  const [demoMenuOpen, setDemoMenuOpen] = useState(false);
  const demoMenuRef = useRef<HTMLDivElement>(null);
  useDismissibleMenu(demoMenuOpen, setDemoMenuOpen, demoMenuRef);
  const selectableProjects = projects.filter((item) => item.status !== 'archived');
  const isAnyDemoLoading = isLoadingQuickDemo || isLoadingHarborHistoryDemo || isLoadingRiversideHistoryDemo || isCleaningUpLocalData;
  const hasDeveloperDemoActions = Boolean(onCreateHarborHistoryDemo || onCreateRiversideHistoryDemo || onCleanupLocalData);
  const isPublicDemo = accessTier === 'public_demo';
  const selectedScopeValue = scope && selectableProjects.some((item) => item.id === scope.projectId)
    ? scope.projectId
    : '';
  const selectedProject = selectableProjects.find((item) => item.id === selectedScopeValue);
  const selectedProjectTitle = selectedProject
      ? `${projectTitlePresentation(selectedProject.title).title} · ${formatCompactDateTime(projectTitlePresentation(selectedProject.title).legacyCreatedAt ?? selectedProject.created_at)}`
      : 'Select workspace';

  const handleProjectSelect = (value: string) => {
    if (value === '__new_project__') {
      onOpenNewProject();
      return;
    }
    if (!value) return;
    onSelectProject(value);
  };

  return (
    <>
    <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-14 sm:min-h-16 py-2 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:gap-3">
          <div className="flex h-11 w-[92px] shrink-0 items-center rounded-xl bg-white px-2 py-1 shadow-lg shadow-blue-950/30 sm:h-12 sm:w-[108px]">
            <NextImage
              src="/logo.png"
              alt="Gapwise"
              width={1672}
              height={941}
              priority
              className="h-auto w-full"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="hidden lg:inline px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 rounded-full">
                Persistent v1.0
              </span>
              {demoMode && (
                <span className="rounded border border-amber-800 bg-amber-950/60 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">
                  Demo mode
                </span>
              )}
              {isPublicDemo && (
                <span className="rounded border border-cyan-800 bg-cyan-950/60 px-1.5 py-0.5 text-[9px] font-bold uppercase text-cyan-300">
                  Demo access
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 hidden lg:block">
              Find the question that unlocks the next decision.
            </p>
          </div>
          <select
            value={selectedScopeValue}
            onChange={(event) => handleProjectSelect(event.target.value)}
            className="min-w-0 max-w-[170px] flex-1 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-2 text-[11px] font-semibold text-slate-200 outline-none hover:border-cyan-800 sm:max-w-[240px] sm:flex-none sm:px-3 sm:text-xs"
            aria-label="Workspace selector"
            title={selectedProject ? `Created ${formatDateTime(projectTitlePresentation(selectedProject.title).legacyCreatedAt ?? selectedProject.created_at)}` : selectedProjectTitle}
          >
            <option value="" disabled className="bg-slate-900">Select workspace</option>
            <optgroup label="Workspaces">
              {selectableProjects.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  title={`Created ${formatDateTime(projectTitlePresentation(item.title).legacyCreatedAt ?? item.created_at)}`}
                  className="bg-slate-900"
                >
                  {projectTitlePresentation(item.title).title} · {formatCompactDateTime(projectTitlePresentation(item.title).legacyCreatedAt ?? item.created_at)}
                </option>
              ))}
            </optgroup>
            {!isPublicDemo && (
              <>
                <option disabled className="bg-slate-900">
                  ─────────────
                </option>
                <option value="__new_project__" className="bg-slate-900">
                  + New workspace
                </option>
              </>
            )}
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
          {(onCreateQuickDemo || hasDeveloperDemoActions) && (
            <div ref={demoMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  if (!demoMenuOpen) closeOpenMenus();
                  setDemoMenuOpen((open) => !open);
                }}
                aria-label="Open demos"
                aria-expanded={demoMenuOpen}
                title="Open demos"
                className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-slate-900 text-slate-400 transition-colors hover:border-cyan-700 hover:text-cyan-300 sm:h-auto sm:w-auto sm:px-2.5 sm:py-2 ${demoMenuOpen ? 'border-cyan-700 text-cyan-300' : 'border-slate-800'}`}
              >
                <PlayCircle className="h-4 w-4" />
              </button>
              {demoMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl shadow-slate-950/60">
                  {onCreateQuickDemo && (
                    <div className="mt-1 pb-1">
                      <p className="px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
                        Gapwise demo
                      </p>
                      <button
                        type="button"
                        onClick={() => { setDemoMenuOpen(false); onCreateQuickDemo(); }}
                        disabled={isAnyDemoLoading}
                        className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-cyan-200 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isLoadingQuickDemo ? <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin text-cyan-300" /> : <span className="mr-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />}
                        {isLoadingQuickDemo ? 'Loading demo…' : isPublicDemo ? 'Load demo' : 'Create quick Gapwise demo'}
                      </button>
                    </div>
                  )}
                  {hasDeveloperDemoActions && (
                    <div className="mt-1 border-t border-slate-800 pt-1">
                      <p className="px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
                        Developer demos
                      </p>
                      {onCreateHarborHistoryDemo && (
                        <button
                          type="button"
                          onClick={() => { setDemoMenuOpen(false); onCreateHarborHistoryDemo(); }}
                          disabled={isAnyDemoLoading}
                          className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-emerald-200 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isLoadingHarborHistoryDemo ? <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin text-emerald-300" /> : <span className="mr-2 h-1.5 w-1.5 rounded-full bg-emerald-300" />}
                          {isLoadingHarborHistoryDemo ? 'Creating Harbor history…' : 'Create fresh Harbor history'}
                        </button>
                      )}
                      {onCreateRiversideHistoryDemo && (
                        <button
                          type="button"
                          onClick={() => { setDemoMenuOpen(false); onCreateRiversideHistoryDemo(); }}
                          disabled={isAnyDemoLoading}
                          className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-emerald-200 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isLoadingRiversideHistoryDemo ? <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin text-emerald-300" /> : <span className="mr-2 h-1.5 w-1.5 rounded-full bg-emerald-300" />}
                          {isLoadingRiversideHistoryDemo ? 'Creating Riverside history…' : 'Create fresh Riverside history'}
                        </button>
                      )}
                      {onCleanupLocalData && (
                        <>
                          <div className="my-1 border-t border-slate-800" />
                          <button
                            type="button"
                            onClick={() => { setDemoMenuOpen(false); onCleanupLocalData(); }}
                            disabled={isAnyDemoLoading}
                            className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-rose-200 hover:bg-rose-950/40 hover:text-rose-100 disabled:cursor-wait disabled:opacity-60"
                          >
                            {isCleaningUpLocalData ? <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin text-rose-300" /> : <span className="mr-2 h-1.5 w-1.5 rounded-full bg-rose-300" />}
                            Delete my local Gapwise data
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {demoMode && (
            <button
              type="button"
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
            aria-expanded={isSettingsOpen}
            aria-controls="settings-drawer"
            className="h-11 w-11 rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors hover:border-cyan-800/50 hover:text-cyan-300 sm:h-auto sm:w-auto"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 grid grid-cols-3 border-t border-slate-800 bg-slate-950/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-md">
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
