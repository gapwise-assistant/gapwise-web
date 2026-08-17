'use client';

import React, { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, MessageCircle, UserRound, X } from 'lucide-react';
import type { CandidateGap } from '@/types/clarity';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';

export interface IdontKnowStrategyResult {
  heading?: string;
  message: string;
  questionToAsk?: string;
}

interface IdontKnowModalProps {
  gap: CandidateGap;
  onHelp: () => void;
  onDecideLater: () => Promise<IdontKnowStrategyResult>;
  onClose: () => void;
}

export function conciseQuestionToAsk(question: string): string {
  const normalized = question.trim().replace(/[?!.]+$/, '');
  const roleConflict = normalized.match(/^Does (.+?) remain acceptable given your preference to avoid frontend-heavy roles$/i);
  if (roleConflict) {
    const subject = roleConflict[1].replace(/^this primarily frontend role$/i, 'this role');
    return `Is ${subject} still a good fit despite the frontend-heavy work?`;
  }
  if (/^What /i.test(normalized)) return `Can you clarify ${normalized.slice(5).replace(/^is\s+/i, '')}?`;
  if (/^How /i.test(normalized)) return `Can you explain ${normalized.charAt(4).toLowerCase()}${normalized.slice(5)}?`;
  return `${normalized}?`;
}

export const IdontKnowModal: React.FC<IdontKnowModalProps> = ({ gap, onHelp, onDecideLater, onClose }) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<IdontKnowStrategyResult | null>(null);
  const [error, setError] = useState('');
  useDismissibleModal(onClose, dialogRef);

  const askSomeone = () => {
    const question = conciseQuestionToAsk(gap.question);
    setError('');
    setResult({
      heading: 'Question to ask',
      message: 'Take this concise question to the person who can answer it:',
      questionToAsk: question,
    });
  };

  const decideLater = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      setResult(await onDecideLater());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This question could not be snoozed. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dont-know-title" aria-busy={pending} className="w-full max-w-lg space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">I don&apos;t know yet</p>
            <h2 id="dont-know-title" className="mt-2 text-xl font-extrabold text-slate-100">What would help?</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{gap.question}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>

        {result ? (
          <section className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4" role="status">
            <div className="flex items-start gap-3">
              {result.questionToAsk ? <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />}
              <div className="min-w-0">
                <p className="text-sm font-bold text-emerald-200">{result.heading ?? 'Snoozed for now'}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">{result.message}</p>
                {result.questionToAsk && <p className="mt-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold leading-relaxed text-slate-100">{result.questionToAsk}</p>}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setResult(null)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-700">What else?</button>
              <button type="button" onClick={onClose} className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950">Done</button>
            </div>
          </section>
        ) : (
          <div className="space-y-3">
            {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">{error}</p>}
            <button type="button" onClick={() => { onClose(); onHelp(); }} className="flex w-full items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-cyan-500/50 hover:bg-slate-800/40">
              <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
              <span><span className="block text-sm font-bold text-slate-100">Help me figure this out</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">Discuss the tradeoff with Gapwise, check existing context, and suggest one next step.</span></span>
            </button>
            <button type="button" onClick={askSomeone} className="flex w-full items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-cyan-500/50 hover:bg-slate-800/40">
              <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
              <span><span className="block text-sm font-bold text-slate-100">I need to ask someone</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">Help identify the exact question to ask.</span></span>
            </button>
            <button type="button" disabled={pending} onClick={() => void decideLater()} className="flex w-full items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-slate-600 hover:bg-slate-800/40 disabled:cursor-wait disabled:opacity-60">
              <ArrowRight className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
              <span><span className="block text-sm font-bold text-slate-100">{pending ? 'Snoozing…' : 'Decide later'}</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">Snooze this and move on.</span></span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
