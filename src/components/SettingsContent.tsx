'use client';

import React from 'react';
import { LogOut, UserCircle } from 'lucide-react';
import { ConnectedContext } from '@/components/ConnectedContext';
import { MemoryView } from '@/components/MemoryView';
import { Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AppScope } from '@/types/scope';
import { GoogleWorkspaceSignals } from '@/types/google';

export interface SettingsContentProps {
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

export const SettingsContent: React.FC<SettingsContentProps> = ({
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
    <div className="mx-auto w-full max-w-full">
      <section className="border-b border-slate-800 px-5 py-6 sm:px-6">
        <ConnectedContext
          userId={userId}
          project={connectionProject}
          onImportSources={importWorkspaceSignals}
          variant="drawer"
        />
      </section>

      <section className="border-b border-slate-800 px-5 py-6 sm:px-6">
        <MemoryView
          profile={profile}
          memories={memories}
          onUpdateProfile={onUpdateProfile}
          onUpdateMemories={onUpdateMemories}
          section="memory"
          variant="drawer"
        />
      </section>

      <section className="border-b border-slate-800 px-5 py-6 sm:px-6">
        <MemoryView
          profile={profile}
          memories={memories}
          onUpdateProfile={onUpdateProfile}
          onUpdateMemories={onUpdateMemories}
          section="preferences"
          variant="drawer"
        />
      </section>

      <section className="px-5 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <UserCircle className="h-5 w-5 shrink-0 text-cyan-300" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-100">Account</h2>
              <p className="mt-1 truncate text-xs text-slate-500">{accountLabel ?? 'Signed-in Google account'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:border-rose-700 hover:text-rose-200"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
};
