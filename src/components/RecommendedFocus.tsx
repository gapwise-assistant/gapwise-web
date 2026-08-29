'use client';

import React from 'react';
import { ArrowRight, GitBranch, Target } from 'lucide-react';
import type { GapGuidance } from '@/types/clarity';
import { Button } from '@/components/ui/Button';

interface RecommendedFocusProps {
  guidance: GapGuidance;
  onResolve?: () => void;
  onDecide?: () => void;
  onViewGap?: () => void;
  onViewDecision?: () => void;
  onViewDecisionMap?: () => void;
}

export function RecommendedFocus({
  guidance,
  onResolve,
  onDecide,
  onViewGap,
  onViewDecision,
  onViewDecisionMap,
}: RecommendedFocusProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-teal-900/70 bg-gradient-to-br from-teal-950/35 to-slate-900" aria-labelledby="recommended-focus-heading">
      <div className="px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Target className="h-3.5 w-3.5 text-teal-300" aria-hidden="true" />
          <p id="recommended-focus-heading" className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-teal-300">
            Recommended focus
          </p>
        </div>
        <h2 className="mt-1.5 text-base font-extrabold leading-snug text-slate-100 sm:text-lg">{guidance.focus}</h2>

        {(onResolve || onDecide || onViewGap || onViewDecision || onViewDecisionMap) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onResolve && (
              <Button variant="primary" onClick={onResolve} icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}>
                Resolve question
              </Button>
            )}
            {onDecide && (
              <Button variant="primary" onClick={onDecide} icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}>
                Decide
              </Button>
            )}
            {onViewGap && (
              <Button variant="secondary" onClick={onViewGap} icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}>
                View gap
              </Button>
            )}
            {onViewDecision && (
              <Button variant="secondary" onClick={onViewDecision} icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}>
                View decision
              </Button>
            )}
            {onViewDecisionMap && (
              <Button variant="ghost" onClick={onViewDecisionMap} icon={<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />}>
                View in Decision Map
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
