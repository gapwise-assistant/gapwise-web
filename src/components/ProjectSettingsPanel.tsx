'use client';

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { Archive, X } from 'lucide-react';
import { Project } from '@/types/clarity';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';

interface ProjectSettingsPanelProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onArchived?: () => void;
  mode?: 'inline' | 'modal';
  onClose?: () => void;
}

export const ProjectSettingsPanel: React.FC<ProjectSettingsPanelProps> = ({
  project,
  onUpdateProject,
  onArchived,
  mode = 'inline',
  onClose,
}) => {
  const [name, setName] = useState(project.title);
  const [goal, setGoal] = useState(project.goal);
  const [description, setDescription] = useState(project.one_sentence_context ?? '');
  const [deadline, setDeadline] = useState(project.deadline ?? '');
  const [saved, setSaved] = useState(false);
  const modalRef = useRef<HTMLElement | null>(null);

  useDismissibleModal(onClose ?? (() => undefined), modalRef, mode === 'modal');

  useEffect(() => {
    setName(project.title);
    setGoal(project.goal);
    setDescription(project.one_sentence_context ?? '');
    setDeadline(project.deadline ?? '');
  }, [project.id, project.title, project.goal, project.one_sentence_context, project.deadline]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !goal.trim()) return;
    onUpdateProject({
      ...project,
      title: name.trim(),
      goal: goal.trim(),
      one_sentence_context: description.trim() || undefined,
      deadline: deadline || undefined,
      updated_at: new Date().toISOString(),
    });
    onClose?.();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  };

  const form = (
    <form onSubmit={save} className={mode === 'modal' ? 'space-y-4' : 'rounded-xl border border-slate-800 bg-slate-900 p-5'}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs font-bold text-slate-300">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-300">Goal</span>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            required
            rows={3}
            className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-300">Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-300">Deadline</span>
          <input
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            type="date"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
          />
        </label>
      </div>
      <button type="submit" className="mt-5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950">
        Save changes
      </button>
      {saved && <p className="mt-3 text-xs font-semibold text-emerald-300">Project settings saved.</p>}
    </form>
  );

  const archive = (
    <aside className={mode === 'modal' ? 'border-t border-slate-800 pt-5' : 'rounded-xl border border-slate-800 bg-slate-900 p-5'}>
      <h3 className="text-sm font-extrabold text-slate-100">Archive project</h3>
      <p className="mt-2 text-sm text-slate-400">
        Move this project out of active work. Its graph, questions, and sources stay available.
      </p>
      <button
        type="button"
        onClick={() => {
          onUpdateProject({ ...project, status: 'archived', updated_at: new Date().toISOString() });
          onArchived?.();
          onClose?.();
        }}
        disabled={project.status === 'archived'}
        className="mt-5 inline-flex items-center gap-2 rounded-lg border border-amber-800 bg-amber-950 px-4 py-2 text-xs font-bold text-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Archive className="h-4 w-4" />
        {project.status === 'archived' ? 'Archived' : 'Archive project'}
      </button>
    </aside>
  );

  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-2 backdrop-blur-sm sm:items-center sm:p-4">
        <section ref={modalRef} className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[90vh] sm:rounded-xl sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">Workspace</p>
              <h2 className="mt-2 text-lg font-extrabold text-slate-100">Edit project</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 min-w-11 rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-slate-100 sm:min-h-0 sm:min-w-0"
              aria-label="Close edit project"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5">{form}</div>
          <div className="mt-6">{archive}</div>
        </section>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">PROJECT SETTINGS</p>
        <h2 className="mt-2 text-xl font-extrabold text-slate-100">{project.title}</h2>
        <p className="mt-1 text-sm text-slate-400">Update the project details Gapwise uses in this workspace.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        {form}
        {archive}
      </div>
    </section>
  );
};
