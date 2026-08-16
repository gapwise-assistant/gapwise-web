'use client';

import React, { useState } from 'react';
import { CircleHelp, MoreHorizontal, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import { FeedbackRating } from '@/types/feedback';

interface FeedbackControlsProps {
  compact?: boolean;
  onFeedback: (rating: FeedbackRating, explanation?: string) => void;
  onWhy?: () => void;
}

export const FeedbackControls: React.FC<FeedbackControlsProps> = ({ compact = false, onFeedback, onWhy }) => {
  const [explanation, setExplanation] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const buttonClass = compact
    ? 'flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-slate-100 sm:min-h-0'
    : 'flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-slate-100';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={`inline-flex items-center justify-center border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-100 ${compact ? 'h-9 w-9 rounded-md p-1.5' : 'min-h-11 min-w-11 rounded-lg p-2 sm:min-h-0 sm:min-w-0'}`}
        aria-label="More feedback options"
        title="More feedback options"
        aria-expanded={isOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {isOpen && (
        <div className="absolute bottom-12 right-0 z-20 w-48 rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl sm:bottom-9">
          {onWhy && (
            <button type="button" onClick={() => { setIsOpen(false); onWhy(); }} className={buttonClass}>
              <CircleHelp className="h-3.5 w-3.5" />
              Why this matters
            </button>
          )}
          <button type="button" onClick={() => { setIsOpen(false); onFeedback('useful', explanation || undefined); }} className={buttonClass}>
            <ThumbsUp className="h-3.5 w-3.5" />
            Useful
          </button>
          <button type="button" onClick={() => { setIsOpen(false); onFeedback('not_useful', explanation || undefined); }} className={buttonClass}>
            <ThumbsDown className="h-3.5 w-3.5" />
            Not useful
          </button>
          <button type="button" onClick={() => { setIsOpen(false); onFeedback('wrong_assumption', explanation || undefined); }} className={buttonClass}>
            <XCircle className="h-3.5 w-3.5" />
            Wrong assumption
          </button>
          <input
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            placeholder="Optional note"
            className="m-2 w-[calc(100%-1rem)] rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100 outline-none"
          />
        </div>
      )}
    </div>
  );
};
