'use client';

import React from 'react';
import { HelpCircle, Link2 } from 'lucide-react';
import { AttentionCandidate, RecommendationStatus } from '@/types/attention';
import { FeedbackRating } from '@/types/feedback';
import { FeedbackControls } from '@/components/FeedbackControls';

interface RecommendationCardProps {
  recommendation: AttentionCandidate;
  onOpenWhy: (recommendation: AttentionCandidate) => void;
  onFeedback: (recommendationId: string, rating: FeedbackRating, status: RecommendationStatus | null, explanation?: string) => void;
}

export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  recommendation,
  onOpenWhy,
  onFeedback,
}) => {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-[10px] uppercase tracking-wider font-extrabold text-cyan-400">
            {recommendation.kind}
          </span>
          <h3 className="mt-1 text-lg font-bold text-slate-100 leading-snug">{recommendation.title}</h3>
        </div>
        <span className="rounded-full border border-cyan-800 bg-cyan-950 px-3 py-1 text-xs font-bold text-cyan-200">
          {Math.round(recommendation.score * 100)}
        </span>
      </div>

      <p className="text-sm text-slate-300">{recommendation.reason}</p>
      <p className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs font-semibold text-cyan-200">
        {recommendation.next_action}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-slate-500">
          <Link2 className="w-3.5 h-3.5" />
          {recommendation.source_ids.length + recommendation.source_node_ids.length} signals
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenWhy(recommendation)}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-semibold text-slate-300 hover:text-cyan-300 sm:min-h-0 sm:py-1.5"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            Why
          </button>
          <FeedbackControls
            compact
            onFeedback={(rating, explanation) =>
              onFeedback(
                recommendation.id,
                rating,
                rating === 'not_now' ? 'not_now' : rating === 'already_done' ? 'done' : null,
                explanation
              )
            }
          />
        </div>
      </div>
    </article>
  );
};
