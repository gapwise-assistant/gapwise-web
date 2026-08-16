'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { AttentionCandidate, RecommendationStatus } from '@/types/attention';
import { FeedbackRating } from '@/types/feedback';
import { FeedbackControls } from '@/components/FeedbackControls';
import type { TodayItemType } from '@/lib/today/feed';
import type { TodayQuestion } from '@/lib/today/sections';
import { TodayQuestionSuggestion } from '@/lib/today/questionPlans';
import { formatCalendarSchedule, formatCalendarTimeUntil } from '@/lib/google/calendarFormatting';

export type SnoozeOption = 15 | 30 | 60 | 'before_event';

export const SNOOZE_OPTIONS: Array<{ value: SnoozeOption; label: string }> = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 'before_event', label: 'Until 10 min before' },
];

interface RecommendationCardProps {
  recommendation: AttentionCandidate;
  itemType: TodayItemType;
  title: string;
  description: string;
  question?: TodayQuestion;
  questionSuggestion?: TodayQuestionSuggestion;
  questionSuggestionSource?: 'gapswise-agent' | 'local-context' | 'local-fallback';
  decisionNodeId?: string;
  calendarStart?: string;
  calendarEnd?: string;
  calendarSource?: string;
  onOpenWhy: (recommendation: AttentionCandidate) => void;
  onOpenQuestionWhy?: (question: TodayQuestion) => void;
  onAnswerQuestion?: (question: TodayQuestion) => void;
  onReviewDecision?: (nodeId: string) => void;
  onFeedback: (recommendationId: string, rating: FeedbackRating, status: RecommendationStatus | null, explanation?: string) => void;
  onSnooze?: (recommendation: AttentionCandidate, option: SnoozeOption) => void;
}

export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  recommendation,
  itemType,
  title,
  description,
  question,
  questionSuggestion,
  questionSuggestionSource,
  decisionNodeId,
  calendarStart,
  calendarEnd,
  calendarSource,
  onOpenWhy,
  onOpenQuestionWhy,
  onAnswerQuestion,
  onReviewDecision,
  onFeedback,
  onSnooze,
}) => {
  const [snoozeOpen, setSnoozeOpen] = React.useState(false);
  const [now, setNow] = React.useState(() => new Date());
  const isReminder = itemType === 'REMINDER' && Boolean(calendarStart);

  React.useEffect(() => {
    if (!isReminder) return undefined;
    const interval = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(interval);
  }, [isReminder]);

  const openWhy = () => {
    if (itemType === 'QUESTION' && question && onOpenQuestionWhy) {
      onOpenQuestionWhy(question);
      return;
    }
    onOpenWhy(recommendation);
  };

  const relativeTiming = isReminder ? formatCalendarTimeUntil(calendarStart, calendarEnd, now) : undefined;
  const schedule = isReminder ? formatCalendarSchedule(calendarStart, calendarEnd, now) : undefined;
  const showSchedule = Boolean(schedule && relativeTiming && schedule !== relativeTiming);
  const cardClass = isReminder
    ? 'w-full max-w-[420px] rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-lg space-y-1.5'
    : 'rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl space-y-4';
  const actionButtonClass = isReminder
    ? 'min-h-9 rounded-md px-3 py-1.5 text-xs font-bold sm:min-h-0'
    : 'min-h-11 rounded-lg px-3 py-2 font-bold sm:min-h-0 sm:py-1.5';
  const chooseSnooze = (option: SnoozeOption) => {
    setSnoozeOpen(false);
    if (onSnooze) onSnooze(recommendation, option);
    else onFeedback(recommendation.id, 'not_now', 'not_now');
  };

  return (
    <article className={cardClass}>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.16em] font-extrabold text-cyan-400">
            {itemType}
          </span>
          {isReminder && relativeTiming && (
            <>
              <span className="text-xs text-slate-600" aria-hidden="true">·</span>
              <p className="text-sm font-bold text-cyan-300">{relativeTiming}</p>
            </>
          )}
        </div>
        <h3 className={`${isReminder ? 'mt-0.5 text-base' : 'mt-1 text-lg'} font-bold leading-snug text-slate-100`}>{title}</h3>
      </div>

      {isReminder ? (
        <div aria-label="Reminder timing">
          {!relativeTiming && <p className="text-sm font-bold text-cyan-300">{description}</p>}
          {showSchedule && (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-400">
              <span>{schedule}</span>
              {calendarSource && <span className="text-slate-600">·</span>}
              {calendarSource && (
                <span className="text-slate-500">{calendarSource}</span>
              )}
            </p>
          )}
          {!showSchedule && calendarSource && (
            <p className="text-xs text-slate-500">
              {calendarSource}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-slate-300">{description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {itemType === 'QUESTION' && question ? (
            <button
              type="button"
              onClick={() => onAnswerQuestion?.(question)}
              className={`${actionButtonClass} bg-cyan-500 text-slate-950`}
            >
              Resolve
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onFeedback(recommendation.id, 'already_done', 'done')}
              className={`${actionButtonClass} bg-cyan-500 text-slate-950`}
            >
              Done
            </button>
          )}
          {itemType !== 'QUESTION' && decisionNodeId && onReviewDecision && (
            <button
              type="button"
              onClick={() => onReviewDecision(decisionNodeId)}
              className="min-h-11 rounded-lg border border-indigo-700/80 bg-indigo-950/40 px-3 py-2 font-semibold text-indigo-200 hover:border-indigo-500 sm:min-h-0 sm:py-1.5"
            >
              Open decision
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSnoozeOpen((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={snoozeOpen}
              className={`flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 font-semibold text-slate-300 hover:text-slate-100 ${isReminder ? 'min-h-9 text-xs' : 'min-h-11 sm:min-h-0 sm:py-1.5'}`}
            >
              Snooze
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {snoozeOpen && (
              <div role="menu" className="absolute bottom-12 left-0 z-20 w-52 rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl sm:bottom-9">
                {SNOOZE_OPTIONS.map((option) => (
                  <button key={option.label} type="button" role="menuitem" onClick={() => chooseSnooze(option.value)} className="block min-h-10 w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-slate-100">
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <FeedbackControls
          compact
          onWhy={openWhy}
          onFeedback={(rating, explanation) => onFeedback(recommendation.id, rating, null, explanation)}
        />
      </div>
    </article>
  );
};
