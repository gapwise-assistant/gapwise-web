'use client';

import React from 'react';
import { ArrowRight, GitBranch, Target } from 'lucide-react';
import type { GapGuidance } from '@/types/clarity';

interface RecommendedFocusProps {
  guidance: GapGuidance;
  onResolve?: () => void;
  onViewDecisionMap?: () => void;
}

export function RecommendedFocus({ guidance, onResolve, onViewDecisionMap }: RecommendedFocusProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-teal-900/70 bg-gradient-to-br from-teal-950/35 to-slate-900" aria-labelledby="recommended-focus-heading">
      <div className="px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Target className="h-3.5 w-3.5 text-teal-300" aria-hidden="true" />
          <p id="recommended-focus-heading" className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-teal-300">
            Recommended focus
          </p>
          <span className="rounded-full border border-slate-700/80 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
            {guidance.generatedBy === 'gap-agent' ? 'Gap Agent' : 'Project analysis'}
          </span>
        </div>
        <h2 className="mt-1.5 text-base font-extrabold leading-snug text-slate-100 sm:text-lg">{guidance.focus}</h2>

        <div className="mt-3 grid gap-2 border-t border-slate-800/80 pt-3 md:grid-cols-3">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Why now</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{guidance.whyNow}</p>
          </div>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Next step</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{guidance.nextStep}</p>
          </div>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-500">What could change</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{guidance.whatCouldChange}</p>
          </div>
        </div>

        {(onResolve || onViewDecisionMap) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onResolve && (
              <button type="button" onClick={onResolve} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-teal-700/80 bg-teal-950/40 px-2.5 text-xs font-semibold text-teal-100 hover:border-teal-500 hover:bg-teal-900/50">
                Resolve question
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            {onViewDecisionMap && (
              <button type="button" onClick={onViewDecisionMap} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-2.5 text-xs font-semibold text-slate-400 hover:border-slate-600 hover:text-slate-200">
                <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                View in Decision Map
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
