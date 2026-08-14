'use client';

import React, { FormEvent, useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { Project } from '@/types/clarity';

interface ProjectSettingsPanelProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
}

export const ProjectSettingsPanel: React.FC<ProjectSettingsPanelProps> = ({
  project,
  onUpdateProject,
}) => {
  const [name, setName] = useState(project.title);
  const [goal, setGoal] = useState(project.goal);
  const [description, setDescription] = useState(project.one_sentence_context ?? '');
  const [deadline, setDeadline] = useState(project.deadline ?? '');
  const [saved, setSaved] = useState(false);

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
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  };

  return (
    <section className="space-y-4">
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">PROJECT SETTINGS</p>
        <h2 className="mt-2 text-xl font-extrabold text-slate-100">{project.title}</h2>
        <p className="mt-1 text-sm text-slate-400">Update the project details Gapswise uses for this scope.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <form onSubmit={save} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-bold text-slate-300">Project name</span>
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
              <span className="text-xs font-bold text-slate-300">Description/context</span>
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

        <aside className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-extrabold text-slate-100">Archive project</h3>
          <p className="mt-2 text-sm text-slate-400">
            Archiving moves this project out of active work. Its graph, questions, and sources stay available.
          </p>
          <button
            type="button"
            onClick={() => onUpdateProject({ ...project, status: 'archived', updated_at: new Date().toISOString() })}
            disabled={project.status === 'archived'}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-amber-800 bg-amber-950 px-4 py-2 text-xs font-bold text-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Archive className="h-4 w-4" />
            {project.status === 'archived' ? 'Archived' : 'Archive project'}
          </button>
        </aside>
      </div>
    </section>
  );
};
