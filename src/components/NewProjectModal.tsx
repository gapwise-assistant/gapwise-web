'use client';

import React, { FormEvent, useState } from 'react';
import { X } from 'lucide-react';
import type { CreateProjectInput } from '@/lib/projects/createProject';

interface NewProjectModalProps {
  onCreateProject: (input: CreateProjectInput) => Promise<void>;
  onClose: () => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ onCreateProject, onClose }) => {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !goal.trim()) {
      setError('Project name and goal are required.');
      return;
    }

    setIsCreating(true);
    setError('');
    try {
      await onCreateProject({ name, goal, description, deadline });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Project creation failed.');
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">New project</p>
            <h2 className="mt-2 text-lg font-extrabold text-slate-100">Create project</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-slate-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-slate-300">Project name *</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-300">What are you trying to accomplish? *</span>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              required
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-300">Description / context</span>
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

        {error && (
          <p className="mt-4 rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreating}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? 'Creating...' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
};
