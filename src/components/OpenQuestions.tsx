'use client';

import React from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import type { AttentionCandidate } from '@/types/attention';
import { SNOOZE_OPTIONS } from '@/components/RecommendationCard';
import type { SnoozeOption } from '@/components/RecommendationCard';
import type { TodayQuestion } from '@/lib/today/sections';

export interface OpenQuestionRowItem {
  id: string;
  question: TodayQuestion;
  context: string;
  decisionNodeId?: string;
  recommendation?: AttentionCandidate;
  priority?: boolean;
  answered?: boolean;
  answer?: string;
}

export interface OpenQuestionProgress {
  openCount: number;
  answeredCount: number;
}

export function openQuestionProgress(items: Pick<OpenQuestionRowItem, 'answered'>[]): OpenQuestionProgress {
  const openCount = items.filter((item) => !item.answered).length;
  return { openCount, answeredCount: items.length - openCount };
}

export function questionOverflowLabels(params: {
  answered?: boolean;
  hasWhy?: boolean;
  hasDecision?: boolean;
  canSnooze?: boolean;
}): string[] {
  // Resolve is the single path for understanding a blocker. Snooze remains
  // available for timing control, but decision review is not duplicated here.
  return [
    ...(!params.answered && params.canSnooze ? SNOOZE_OPTIONS.map((option) => `Snooze · ${option.label}`) : []),
  ];
}

interface OpenQuestionsProps {
  items: OpenQuestionRowItem[];
  summary: string;
  onAnswer: (question: TodayQuestion) => void;
  onWhy?: (question: TodayQuestion) => void;
  onReviewDecision?: (nodeId: string) => void;
  onSnooze?: (recommendation: AttentionCandidate, option: SnoozeOption) => void;
}

function QuestionRow({ item, onAnswer, onSnooze }: Pick<OpenQuestionsProps, 'onAnswer' | 'onSnooze'> & { item: OpenQuestionRowItem }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const canSnooze = Boolean(item.recommendation && onSnooze && !item.answered);
  const overflowLabels = questionOverflowLabels({
    answered: item.answered,
    canSnooze,
  });
  const handleOverflowAction = (label: string) => {
    setMenuOpen(false);
    const snoozeLabel = label.replace(/^Snooze · /, '');
    const option = SNOOZE_OPTIONS.find((candidate) => candidate.label === snoozeLabel);
    if (option && item.recommendation) onSnooze?.(item.recommendation, option.value);
  };
  const displayTitle = item.question.presentationTitle || item.question.question;
  const displaySummary = item.question.presentationSummary || item.context;

  return (
    <article className={`border-l-2 px-3 py-2.5 sm:px-4 ${item.answered ? 'border-transparent bg-slate-950/30' : item.priority ? 'border-amber-400/70 bg-amber-950/10' : 'border-transparent'}`}>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          {item.priority && !item.answered && (
            <p className="mb-0.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-amber-300">Priority</p>
          )}
          <p className={`text-[15px] font-bold leading-snug ${item.answered ? 'text-slate-400' : 'text-slate-100'}`}>
            {item.answered && <Check className="mr-1 inline h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />}
            {displayTitle}
          </p>
          {item.answered ? (
            <p className="mt-0.5 truncate text-xs text-slate-500" title={item.answer}>{item.answer}</p>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{displaySummary}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAnswer(item.question)}
            className={`min-h-8 rounded-md px-2.5 py-1 text-[11px] font-bold sm:min-h-0 ${item.answered ? 'border border-slate-700 bg-slate-800 text-slate-300 hover:text-slate-100' : 'border border-slate-700 bg-slate-800 text-slate-200 hover:border-cyan-700 hover:text-cyan-200'}`}
          >
            {item.answered ? 'Edit' : 'Resolve'}
          </button>
          {overflowLabels.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                aria-label={`Actions for ${displayTitle}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-slate-700 bg-slate-800 p-1 text-slate-400 hover:text-slate-100 sm:min-h-0 sm:min-w-0"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute bottom-11 right-0 z-30 w-56 rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl">
                  {overflowLabels.map((label) => (
                    <button key={label} type="button" role="menuitem" onClick={() => handleOverflowAction(label)} className="block min-h-10 w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-slate-100">
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function OpenQuestions({ items, summary, onAnswer, onSnooze }: OpenQuestionsProps) {
  const { openCount, answeredCount } = openQuestionProgress(items);

  return (
    <section className="space-y-2" aria-labelledby="open-questions-heading">
      <div className="space-y-1">
        <p id="open-questions-heading" className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Open questions · {openCount}</p>
        {answeredCount > 0 && <span className="sr-only">{answeredCount} answered</span>}
      </div>
      <p className="text-sm text-slate-400">{summary}</p>
      <div className="overflow-visible rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
        {items.map((item) => (
          <QuestionRow
            key={item.id}
            item={item}
            onAnswer={onAnswer}
            onSnooze={onSnooze}
          />
        ))}
      </div>
    </section>
  );
}
