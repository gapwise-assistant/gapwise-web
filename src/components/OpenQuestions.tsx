'use client';

import React from 'react';
import { Check, MoreHorizontal } from 'lucide-react';
import type { AttentionCandidate } from '@/types/attention';
import type { TodayQuestion } from '@/lib/today/sections';
import { closeOpenMenus, useDismissibleMenu } from '@/lib/ui/useDismissibleMenu';
import { Button } from '@/components/ui/Button';

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
  canHide?: boolean;
}): string[] {
  return params.canHide && !params.answered ? ['Hide from Today'] : [];
}

interface OpenQuestionsProps {
  items: OpenQuestionRowItem[];
  summary: string;
  onAnswer?: (question: TodayQuestion) => void;
  onView?: (question: TodayQuestion) => void;
  onHide?: (question: TodayQuestion, recommendation?: AttentionCandidate) => void;
  readOnly?: boolean;
}

function QuestionRow({ item, onAnswer, onView, onHide, readOnly }: Pick<OpenQuestionsProps, 'onAnswer' | 'onView' | 'onHide' | 'readOnly'> & { item: OpenQuestionRowItem }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  useDismissibleMenu(menuOpen, setMenuOpen, menuRef);
  const canHide = Boolean(onHide);
  const overflowLabels = questionOverflowLabels({
    answered: item.answered,
    canHide,
  });
  const handleOverflowAction = (label: string) => {
    setMenuOpen(false);
    if (label === 'Hide from Today') onHide?.(item.question, item.recommendation);
  };
  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    closeOpenMenus();
    setMenuOpen(true);
  };
  const displayTitle = item.question.presentationTitle ?? item.question.question;
  const displaySummary = item.question.presentationSummary || item.context;

  return (
    <article className={`px-4 py-3 sm:px-5 ${item.answered ? 'bg-slate-950/30' : ''}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
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
          {!readOnly && onAnswer && (
            <Button
              variant={item.answered ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => onAnswer(item.question)}
            >
              {item.answered ? 'Edit' : 'Resolve'}
            </Button>
          )}
          {readOnly && onView && !item.answered && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onView(item.question)}
            >
              View gap
            </Button>
          )}
          {overflowLabels.length > 0 && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={toggleMenu}
                aria-label={`Actions for ${displayTitle}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="inline-flex h-7 min-h-7 min-w-7 items-center justify-center rounded-md border border-slate-800 bg-transparent p-1 text-slate-500 hover:border-slate-700 hover:bg-slate-800/60 hover:text-slate-300 sm:min-h-0 sm:min-w-0"
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

export function OpenQuestions({ items, summary, onAnswer, onView, onHide, readOnly = false }: OpenQuestionsProps) {
  const { openCount, answeredCount } = openQuestionProgress(items);

  return (
    <section className="space-y-2" aria-labelledby="open-questions-heading">
      <div className="space-y-1">
        <p id="open-questions-heading" className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Open questions · {openCount}</p>
        {answeredCount > 0 && <span className="sr-only">{answeredCount} answered</span>}
      </div>
      <p className="text-sm text-slate-400">{summary}</p>
      <div className="overflow-visible divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/80">
        {items.length > 0 ? items.map((item) => (
          <QuestionRow
            // A recommendation can support more than one question, so its
            // ID is not a unique row identity. The canonical question ID is.
            key={item.question.id}
            item={item}
            onAnswer={onAnswer}
            onView={onView}
            onHide={onHide}
            readOnly={readOnly}
          />
        )) : (
          <p className="px-3 py-3 text-xs text-slate-500 sm:px-4">No visible questions right now.</p>
        )}
      </div>
    </section>
  );
}
