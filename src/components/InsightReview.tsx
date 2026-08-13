'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import { Insight, InsightAction } from '@/types/insight';

interface InsightReviewProps {
  insight: Insight;
  onAction: (insight: Insight, action: InsightAction) => void;
}

const iconByType = {
  LOOSE_END: <Clock className="w-4 h-4 text-amber-300" />,
  POSSIBLE_CONTEXT_CHANGE: <RefreshCw className="w-4 h-4 text-cyan-300" />,
  STALE_CONTEXT: <AlertCircle className="w-4 h-4 text-fuchsia-300" />,
};

export const InsightReview: React.FC<InsightReviewProps> = ({ insight, onAction }) => {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {iconByType[insight.type]}
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              {insight.type.replaceAll('_', ' ')}
            </span>
            <h3 className="text-sm font-bold text-slate-100">{insight.title}</h3>
          </div>
        </div>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
          {Math.round(insight.priority * 100)}
        </span>
      </div>

      <p className="text-xs text-slate-400">{insight.summary}</p>
      <p className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-xs font-semibold text-slate-200">
        {insight.question}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
        <span>
          {insight.evidence.node_ids.length} nodes · {insight.evidence.source_ids.length} sources
        </span>
        <div className="flex flex-wrap gap-2">
          {insight.type === 'STALE_CONTEXT' ? (
            <>
              <button
                type="button"
                onClick={() => onAction(insight, 'still_true')}
                className="rounded-lg border border-emerald-800 bg-emerald-950 px-2 py-1 font-semibold text-emerald-200"
              >
                Still true
              </button>
              <button
                type="button"
                onClick={() => onAction(insight, 'changed')}
                className="rounded-lg border border-cyan-800 bg-cyan-950 px-2 py-1 font-semibold text-cyan-200"
              >
                Changed
              </button>
              <button
                type="button"
                onClick={() => onAction(insight, 'not_relevant')}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 font-semibold text-slate-300"
              >
                Not relevant
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onAction(insight, 'confirm')}
                className="rounded-lg border border-emerald-800 bg-emerald-950 px-2 py-1 font-semibold text-emerald-200 flex items-center gap-1"
              >
                <CheckCircle2 className="w-3 h-3" />
                Confirm
              </button>
              <button
                type="button"
                onClick={() => onAction(insight, 'dismiss')}
                className="rounded-lg border border-rose-800 bg-rose-950 px-2 py-1 font-semibold text-rose-200 flex items-center gap-1"
              >
                <XCircle className="w-3 h-3" />
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
};
