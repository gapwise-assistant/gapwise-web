'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { AttentionCandidate, RecommendationStatus } from '@/types/attention';
import { FeedbackRating } from '@/types/feedback';
import { FeedbackControls } from '@/components/FeedbackControls';
import type { TodayItemType } from '@/lib/today/feed';
import type { TodayQuestion } from '@/lib/today/sections';
import { hasUsefulSuggestedAnswer, TodayQuestionSuggestion } from '@/lib/today/questionPlans';

interface RecommendationCardProps {
  recommendation: AttentionCandidate;
  itemType: TodayItemType;
  title: string;
  description: string;
  question?: TodayQuestion;
  questionSuggestion?: TodayQuestionSuggestion;
  questionSuggestionSource?: 'gapswise-agent' | 'local-context' | 'local-fallback';
  onOpenWhy: (recommendation: AttentionCandidate) => void;
  onOpenQuestionWhy?: (question: TodayQuestion) => void;
  onAnswerQuestion?: (question: TodayQuestion) => void;
  onFeedback: (recommendationId: string, rating: FeedbackRating, status: RecommendationStatus | null, explanation?: string) => void;
}

export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  recommendation,
  itemType,
  title,
  description,
  question,
  questionSuggestion,
  questionSuggestionSource,
  onOpenWhy,
  onOpenQuestionWhy,
  onAnswerQuestion,
  onFeedback,
}) => {
  const showAnswerSuggestion = Boolean(
    itemType === 'QUESTION' &&
    questionSuggestion &&
    questionSuggestionSource === 'gapswise-agent' &&
    hasUsefulSuggestedAnswer(questionSuggestion)
  );

  const openWhy = () => {
    if (itemType === 'QUESTION' && question && onOpenQuestionWhy) {
      onOpenQuestionWhy(question);
      return;
    }
    onOpenWhy(recommendation);
  };

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl space-y-4">
      <div>
        <span className="text-[10px] uppercase tracking-[0.16em] font-extrabold text-cyan-400">
          {itemType}
        </span>
        <h3 className="mt-1 text-lg font-bold leading-snug text-slate-100">{title}</h3>
      </div>

      <p className="text-sm leading-relaxed text-slate-300">{description}</p>

      {showAnswerSuggestion && questionSuggestion && (
        <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">AI-supported answer</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-200">{questionSuggestion.suggestedAnswer}</p>
          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Why this matters</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{questionSuggestion.whyItMatters}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {itemType === 'QUESTION' && question ? (
          <button
            type="button"
            onClick={() => onAnswerQuestion?.(question)}
            className="min-h-11 rounded-lg bg-cyan-500 px-3 py-2 font-bold text-slate-950 sm:min-h-0 sm:py-1.5"
          >
            Answer
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onFeedback(recommendation.id, 'already_done', 'done')}
            className="min-h-11 rounded-lg bg-cyan-500 px-3 py-2 font-bold text-slate-950 sm:min-h-0 sm:py-1.5"
          >
            Done
          </button>
        )}
        <div>
          <button
            type="button"
            onClick={openWhy}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-semibold text-slate-300 hover:text-cyan-300 sm:min-h-0 sm:py-1.5"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Why?
          </button>
        </div>
        <button
          type="button"
          onClick={() => onFeedback(recommendation.id, 'not_now', 'not_now')}
          className="min-h-11 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-semibold text-slate-300 hover:text-slate-100 sm:min-h-0 sm:py-1.5"
        >
          Not now
        </button>
        <FeedbackControls
          compact
          onFeedback={(rating, explanation) => onFeedback(recommendation.id, rating, null, explanation)}
        />
      </div>
    </article>
  );
};
