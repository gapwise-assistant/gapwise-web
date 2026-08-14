'use client';

import React, { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, HelpCircle, Loader2, X } from 'lucide-react';

export interface AnswerQuestionTarget {
  nodeId?: string;
  question: string;
  reason?: string;
  projectId?: string;
  mode?: 'answer' | 'edit';
  initialAnswer?: string;
  historyTimestamp?: string;
}

interface AnswerQuestionModalProps {
  target: AnswerQuestionTarget;
  onSubmit: (answer: string) => Promise<void>;
  onDontKnow?: () => void;
  onClose: () => void;
}

export function AnswerQuestionModal({ target, onSubmit, onDontKnow, onClose }: AnswerQuestionModalProps) {
  const [answer, setAnswer] = useState(target.initialAnswer ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAnswer(target.initialAnswer ?? '');
    setError('');
    setSaved(false);
  }, [target]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!answer.trim() || isSaving) return;
    setError('');
    setIsSaving(true);
    try {
      await onSubmit(answer.trim());
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The answer could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="answer-question-title" className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">
              {target.mode === 'edit' ? 'Edit your answer' : 'Update Gapswise'}
            </p>
            <h2 id="answer-question-title" className="mt-2 text-lg font-extrabold text-slate-100">
              {target.question}
            </h2>
            {target.reason && <p className="mt-2 text-xs text-slate-400">{target.reason}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {saved ? (
          <div className="mt-5 rounded-lg border border-emerald-800 bg-emerald-950/40 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" />
              <div>
                <p className="text-sm font-bold text-emerald-200">Understanding updated</p>
                <p className="mt-1 text-xs text-emerald-300/80">
                  {target.mode === 'edit'
                    ? 'Your answer was updated and Today will refresh from the updated context.'
                    : 'This question is resolved and Today will refresh from the updated context.'}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="mt-4 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-bold text-slate-950">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5">
            <label htmlFor="question-answer" className="text-xs font-bold text-slate-300">Your answer</label>
            <textarea
              id="question-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={5}
              autoFocus
              placeholder="Share the decision, clarification, or fact Gapswise should understand."
              className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-cyan-600"
            />
            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              {onDontKnow ? (
                <button type="button" onClick={onDontKnow} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
                  <HelpCircle className="h-3.5 w-3.5" />
                  I don't know yet
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200">Cancel</button>
                <button type="submit" disabled={!answer.trim() || isSaving} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {target.mode === 'edit' ? 'Update answer' : 'Save answer'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
