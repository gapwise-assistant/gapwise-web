'use client';

import React, { useState } from 'react';
import { CheckCircle2, Clock3, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import { FeedbackRating } from '@/types/feedback';

interface FeedbackControlsProps {
  compact?: boolean;
  onFeedback: (rating: FeedbackRating, explanation?: string) => void;
}

export const FeedbackControls: React.FC<FeedbackControlsProps> = ({ compact = false, onFeedback }) => {
  const [explanation, setExplanation] = useState('');
  const buttonClass = compact
    ? 'rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300'
    : 'rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onFeedback('useful', explanation || undefined)} className={buttonClass}>
          <ThumbsUp className="inline w-3.5 h-3.5 mr-1" />
          Useful
        </button>
        <button type="button" onClick={() => onFeedback('not_useful', explanation || undefined)} className={buttonClass}>
          <ThumbsDown className="inline w-3.5 h-3.5 mr-1" />
          Not useful
        </button>
        <button type="button" onClick={() => onFeedback('not_now', explanation || undefined)} className={buttonClass}>
          <Clock3 className="inline w-3.5 h-3.5 mr-1" />
          Not now
        </button>
        <button type="button" onClick={() => onFeedback('already_done', explanation || undefined)} className={buttonClass}>
          <CheckCircle2 className="inline w-3.5 h-3.5 mr-1" />
          Done
        </button>
        <button type="button" onClick={() => onFeedback('wrong_assumption', explanation || undefined)} className={buttonClass}>
          <XCircle className="inline w-3.5 h-3.5 mr-1" />
          Wrong assumption
        </button>
      </div>
      {!compact && (
        <input
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          placeholder="Optional correction or preference..."
          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none"
        />
      )}
    </div>
  );
};
