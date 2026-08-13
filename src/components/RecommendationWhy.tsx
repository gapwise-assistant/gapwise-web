'use client';

import React from 'react';
import { X } from 'lucide-react';
import { AttentionCandidate } from '@/types/attention';

interface RecommendationWhyProps {
  recommendation: AttentionCandidate | null;
  onClose: () => void;
}

const FACTOR_LABELS: Record<keyof AttentionCandidate['factors'], string> = {
  goal_alignment: 'Goal alignment',
  impact: 'Impact',
  urgency: 'Urgency',
  actionability: 'Actionability',
  evidence_confidence: 'Evidence confidence',
  unresolved_risk: 'Unresolved risk',
  momentum: 'Momentum',
  estimated_effort: 'Estimated effort',
};

export const RecommendationWhy: React.FC<RecommendationWhyProps> = ({ recommendation, onClose }) => {
  if (!recommendation) return null;
  const calendarCommitments = recommendation.context_pack.upcomingCommitments.filter((commitment) =>
    commitment.source_refs.some((ref) => ref.startsWith('gcal_')) ||
    commitment.why_it_matters?.includes('Source: Google Calendar') === true
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100">Why This Matters</h2>
            <p className="text-xs text-slate-500">{Math.round(recommendation.score * 100)} / 100 attention score</p>
          </div>
          <button
            onClick={onClose}
            title="Close recommendation explanation"
            className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="text-sm font-bold text-slate-100">{recommendation.title}</h3>
            <p className="mt-2 text-xs text-slate-400">{recommendation.reason}</p>
            <p className="mt-3 text-xs font-semibold text-cyan-300">{recommendation.next_action}</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Score Factors</h3>
            {Object.entries(recommendation.factors).map(([key, value]) => (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">{FACTOR_LABELS[key as keyof AttentionCandidate['factors']]}</span>
                  <span className="text-slate-200">{Math.round(value * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-cyan-400" style={{ width: `${Math.round(value * 100)}%` }} />
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">Evidence</h3>
            {calendarCommitments.map((commitment) => (
              <div key={commitment.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <div className="flex justify-between gap-3 text-[10px]">
                  <span className="font-bold text-slate-300">Google Calendar</span>
                  <span className="text-cyan-400">Source: Google Calendar</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">{commitment.text}</p>
              </div>
            ))}
            {recommendation.context_pack.relevantEvidence.map((evidence) => (
                <div key={evidence.source_id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <div className="flex justify-between text-[10px]">
                    <span className="font-bold text-slate-300">{evidence.filename}</span>
                    <span className="text-cyan-400">{Math.round(evidence.score * 100)}% match</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{evidence.excerpt}</p>
                </div>
            ))}
            {calendarCommitments.length === 0 && recommendation.context_pack.relevantEvidence.length === 0 && (
              <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-500">
                This item is currently grounded mostly in structured graph state and memory.
              </p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
};
