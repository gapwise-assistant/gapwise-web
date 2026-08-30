'use client';

import React from 'react';
import { LogOut, UserCircle } from 'lucide-react';
import { ConnectedContext } from '@/components/ConnectedContext';
import { MemoryView } from '@/components/MemoryView';
import { Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AppScope } from '@/types/scope';
import { GoogleWorkspaceSignals } from '@/types/google';
import { importWorkspaceSignalsIntoProject } from '@/lib/google/importWorkspaceSignals';

export interface SettingsContentProps {
  userId: string;
  accountLabel?: string;
  scope: AppScope;
  project: Project;
  generalContext: Project;
  profile: UserMemoryProfile;
  memories: DurableMemory[];
  onUpdateProject: (updated: Project) => boolean | Promise<boolean>;
  onUpdateGeneralContext: (updated: Project) => boolean | Promise<boolean>;
  onUpdateProfile: (updated: UserMemoryProfile) => boolean | Promise<boolean>;
  onUpdateMemories: (updated: DurableMemory[]) => boolean | Promise<boolean>;
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

  const importWorkspaceSignals = async (signals: GoogleWorkspaceSignals): Promise<{ imported: number; skipped: number }> => {
    const result = await importWorkspaceSignalsIntoProject({ userId, project: connectionProject, signals });
    const updated = scope.type === 'project'
      ? await onUpdateProject(result.project)
      : await onUpdateGeneralContext(result.project);
    if (updated === false) throw new Error('Connected context was analyzed but the refreshed project could not be displayed.');
    return { imported: result.imported, skipped: result.skipped };
  };

  return (
    <div className="mx-auto w-full max-w-full">
      <section className="border-b border-slate-800 px-5 py-6 sm:px-6">
        <ConnectedContext
          userId={userId}
          project={connectionProject}
          projectId={scope.type === 'project' ? connectionProject.id : undefined}
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
