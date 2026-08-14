'use client';

import React from 'react';
import { LogOut, UserCircle } from 'lucide-react';
import { ConnectedContext } from '@/components/ConnectedContext';
import { MemoryView } from '@/components/MemoryView';
import { Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AppScope } from '@/types/scope';
import { GoogleWorkspaceSignals } from '@/types/google';

interface SettingsDestinationProps {
  userId: string;
  accountLabel?: string;
  scope: AppScope;
  project: Project;
  generalContext: Project;
  profile: UserMemoryProfile;
  memories: DurableMemory[];
  onUpdateProject: (updated: Project) => void;
  onUpdateGeneralContext: (updated: Project) => void;
  onUpdateProfile: (updated: UserMemoryProfile) => void;
  onUpdateMemories: (updated: DurableMemory[]) => void;
  onSignOut: () => void;
}

export const SettingsDestination: React.FC<SettingsDestinationProps> = ({
  userId,
  accountLabel,
  scope,
  project,
  generalContext,
  profile,
  memories,
  onUpdateProject,
  onUpdateGeneralContext,
  onUpdateProfile,
  onUpdateMemories,
  onSignOut,
}) => {
  const connectionProject = scope.type === 'project' ? project : generalContext;

  const importWorkspaceSignals = (signals: GoogleWorkspaceSignals) => {
    const updated: Project = JSON.parse(JSON.stringify(connectionProject));
    const existingIds = new Set(updated.sources.map((source) => source.id));
    signals.derivedSources.forEach((source) => {
      if (!existingIds.has(source.id)) updated.sources.push(source);
    });
    updated.updated_at = new Date().toISOString();
    if (scope.type === 'project') onUpdateProject(updated);
    else onUpdateGeneralContext(updated);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      <header className="border-b border-slate-800 pb-5">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">SETTINGS</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-100">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Manage connected accounts, memories, preferences, and your account.
        </p>
      </header>

      <section className="border-b border-slate-800 pb-8">
        <ConnectedContext
          userId={userId}
          project={connectionProject}
          onImportSources={importWorkspaceSignals}
        />
      </section>

      <section>
        <MemoryView
          profile={profile}
          memories={memories}
          onUpdateProfile={onUpdateProfile}
          onUpdateMemories={onUpdateMemories}
          section="memory"
        />
      </section>

      <section>
        <MemoryView
          profile={profile}
          memories={memories}
          onUpdateProfile={onUpdateProfile}
          onUpdateMemories={onUpdateMemories}
          section="preferences"
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <UserCircle className="h-6 w-6 text-cyan-300" />
            <div>
              <h2 className="text-lg font-extrabold text-slate-100">Account</h2>
              <p className="text-sm text-slate-400">{accountLabel ?? 'Signed-in Google account'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-800 bg-rose-950 px-3 py-2 text-xs font-semibold text-rose-200 sm:min-h-0"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
};
