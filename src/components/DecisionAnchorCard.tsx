'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Link2, PencilLine } from 'lucide-react';
import type { Project } from '@/types/clarity';
import {
  anchorProjectDecision,
  findDecisionAnchorSuggestion,
  unlinkedOpenQuestions,
} from '@/lib/decisions/anchoring';

interface DecisionAnchorCardProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onAnchorDecision?: (projectId: string, title: string, questionNodeIds: string[]) => Promise<Project>;
}

export const DecisionAnchorCard: React.FC<DecisionAnchorCardProps> = ({ project, onUpdateProject, onAnchorDecision }) => {
  const suggestion = useMemo(() => findDecisionAnchorSuggestion(project), [project]);
  const unlinkedQuestions = useMemo(() => unlinkedOpenQuestions(project), [project]);
  const [title, setTitle] = useState(suggestion?.title ?? '');
  const [isEditing, setIsEditing] = useState(!suggestion);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>(suggestion?.questionNodeIds ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(suggestion?.title ?? '');
    setIsEditing(!suggestion);
    setSelectedQuestionIds(suggestion?.questionNodeIds ?? []);
    setError(null);
    setSaved(false);
  }, [suggestion]);

  if (unlinkedQuestions.length === 0) return null;

  const saveDecision = async () => {
    const cleaned = title.trim();
    if (!cleaned || selectedQuestionIds.length === 0 || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = onAnchorDecision
        ? await onAnchorDecision(project.id, cleaned, selectedQuestionIds)
        : anchorProjectDecision(project, cleaned, selectedQuestionIds);
      onUpdateProject(updated);
      setSaved(true);
      setIsEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The decision could not be anchored.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-indigo-800/70 bg-indigo-950/20 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-indigo-700/70 bg-indigo-950/60 p-2 text-indigo-300">
          <Link2 className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-indigo-300">Decision to anchor</p>
          <h2 className="mt-2 text-base font-extrabold text-slate-100">
            Give these open questions a decision to work against
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {suggestion?.reason ?? `${unlinkedQuestions.length} open question${unlinkedQuestions.length === 1 ? '' : 's'} are not connected to a pending decision yet.`}
          </p>

          <div className="mt-4 space-y-2">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
              Questions this decision may change
            </p>
            {unlinkedQuestions.slice(0, 8).map((question) => {
              const selected = selectedQuestionIds.includes(question.id);
              return (
                <label key={question.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300 hover:border-indigo-700/70">
                  <input
                    type="checkbox"
                    checked={selected}
                  onChange={() => setSelectedQuestionIds((current) => selected
                      ? current.filter((id) => id !== question.id)
                      : current.length >= 6 ? current : [...current, question.id])}
                    disabled={!selected && selectedQuestionIds.length >= 6}
                    className="mt-0.5 accent-indigo-400"
                  />
                  <span>{question.text}</span>
                </label>
              );
            })}
            {unlinkedQuestions.length > 8 && (
              <p className="text-[11px] text-slate-600">Showing the first 8 unlinked questions. The rest remain unlinked until you choose them.</p>
            )}
            {selectedQuestionIds.length >= 6 && <p className="text-[11px] text-slate-600">Up to 6 questions can be linked in one decision anchor.</p>}
          </div>

          {isEditing ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveDecision();
                }}
                placeholder="What decision are you trying to make?"
                aria-label="Decision to anchor"
                className="min-h-10 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500"
                autoFocus={!suggestion}
              />
              <button
                type="button"
                onClick={() => void saveDecision()}
                disabled={!title.trim() || selectedQuestionIds.length === 0 || isSaving}
                className="min-h-10 rounded-lg bg-indigo-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSaving ? 'Anchoring…' : 'Anchor decision'}
              </button>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="rounded-lg border border-indigo-800/70 bg-slate-950/60 px-3 py-2 text-sm font-semibold text-indigo-100">
                {title}
              </p>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-slate-100 sm:min-h-0"
              >
                <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </button>
              {saved && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Questions linked
                </span>
              )}
            </div>
          )}
          {selectedQuestionIds.length === 0 && (
            <p className="mt-2 text-[11px] text-amber-300/80">Select at least one question before anchoring.</p>
          )}
          {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
        </div>
      </div>
    </section>
  );
};
