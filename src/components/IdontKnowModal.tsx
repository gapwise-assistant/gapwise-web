'use client';

import React, { useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Bookmark, CheckCircle2, FlaskConical, Loader2, Search, X } from 'lucide-react';
import { CandidateGap } from '@/types/clarity';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';

export type IdontKnowStrategy = 'rag' | 'experiment' | 'assumption' | 'defer';

export interface IdontKnowStrategyResult {
  heading?: string;
  message: string;
  canTryAnother?: boolean;
  findings?: Array<{ sourceId: string; title: string; excerpt: string }>;
  proposedChange?: string;
  requiresConfirmation?: boolean;
  decisionMapNodeId?: string;
}

interface IdontKnowModalProps {
  gap: CandidateGap;
  onSelectStrategy: (strategy: IdontKnowStrategy) => Promise<IdontKnowStrategyResult>;
  onAcceptProposedChange?: () => Promise<IdontKnowStrategyResult>;
  onViewDecisionMap?: (nodeId: string) => void;
  onClose: () => void;
}

const pendingLabels: Record<IdontKnowStrategy, string> = {
  rag: 'Searching your context…',
  experiment: 'Creating a resolution experiment…',
  assumption: 'Saving a temporary assumption…',
  defer: 'Moving to the next question…',
};

export const IdontKnowModal: React.FC<IdontKnowModalProps> = ({
  gap,
  onSelectStrategy,
  onAcceptProposedChange,
  onViewDecisionMap,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [pendingStrategy, setPendingStrategy] = useState<IdontKnowStrategy | null>(null);
  const [result, setResult] = useState<IdontKnowStrategyResult | null>(null);
  const [error, setError] = useState('');
  useDismissibleModal(onClose, dialogRef);

  const selectStrategy = async (strategy: IdontKnowStrategy) => {
    if (pendingStrategy) return;
    setPendingStrategy(strategy);
    setError('');
    try {
      setResult(await onSelectStrategy(strategy));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gapswise could not apply that option. Please try again.');
    } finally {
      setPendingStrategy(null);
    }
  };

  const acceptProposedChange = async () => {
    if (pendingStrategy || !onAcceptProposedChange) return;
    setPendingStrategy('rag');
    setError('');
    try {
      setResult(await onAcceptProposedChange());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gapswise could not apply that Decision Map change.');
    } finally {
      setPendingStrategy(null);
    }
  };

  const rejectProposedChange = () => {
    setError('');
    setResult({ heading: 'No changes saved', message: 'The suggested Decision Map update was rejected. Your project data was not changed.', canTryAnother: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dont-know-title" aria-busy={Boolean(pendingStrategy)} className="max-h-[calc(100dvh-2rem)] w-full max-w-lg space-y-6 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-950/80 border border-indigo-800/60 rounded-xl text-indigo-400">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h3 id="dont-know-title" className="font-bold text-slate-100 text-lg">Unresolved Gap Strategy</h3>
              <p className="text-xs text-slate-400">How would you like Gapswise to proceed?</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl">
          <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Uncertainty Gap</span>
          <p className="text-sm font-medium text-slate-200 mt-1">{gap.question}</p>
        </div>

        {result ? (
          <div className={`rounded-xl border p-4 ${result.requiresConfirmation ? 'border-cyan-800 bg-cyan-950/25' : result.canTryAnother ? 'border-amber-800 bg-amber-950/30' : 'border-emerald-800 bg-emerald-950/30'}`} role="status">
            <div className="flex items-start gap-3">
              {result.requiresConfirmation
                ? <Search className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
                : <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${result.canTryAnother ? 'text-amber-300' : 'text-emerald-400'}`} aria-hidden="true" />}
              <div>
                <p className={`text-sm font-bold ${result.requiresConfirmation ? 'text-cyan-200' : result.canTryAnother ? 'text-amber-200' : 'text-emerald-200'}`}>
                  {result.heading ?? (result.canTryAnother ? 'Context checked' : 'Next step saved')}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">{result.message}</p>
              </div>
            </div>
            {result.findings && result.findings.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Relevant information</p>
                {result.findings.slice(0, 4).map((finding) => (
                  <div key={finding.sourceId} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2.5">
                    <p className="text-[11px] font-bold text-cyan-200">{finding.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">{finding.excerpt}</p>
                  </div>
                ))}
              </div>
            )}
            {result.proposedChange && (
              <div className="mt-4 rounded-lg border border-indigo-800/70 bg-indigo-950/30 px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-indigo-300">Proposed Decision Map change</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">{result.proposedChange}</p>
              </div>
            )}
            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/30 px-3 py-2 text-xs text-rose-200" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {result.requiresConfirmation ? (
                <>
                  <button type="button" disabled={Boolean(pendingStrategy)} onClick={rejectProposedChange} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-rose-700 disabled:opacity-50">Reject change</button>
                  <button type="button" disabled={Boolean(pendingStrategy)} onClick={() => void acceptProposedChange()} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 disabled:cursor-wait disabled:opacity-60">
                    {pendingStrategy === 'rag' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {pendingStrategy === 'rag' ? 'Applying…' : 'Accept change'}
                  </button>
                </>
              ) : result.decisionMapNodeId && onViewDecisionMap ? (
                <>
                  <button type="button" onClick={() => { onClose(); onViewDecisionMap(result.decisionMapNodeId as string); }} className="rounded-lg border border-cyan-700 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-200 hover:border-cyan-500">View change in Decision Map</button>
                  <button type="button" onClick={onClose} className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950">Done</button>
                </>
              ) : result.canTryAnother ? (
                <button type="button" onClick={() => setResult(null)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-700">
                  Choose another option
                </button>
              ) : null}
              {!result.requiresConfirmation && !(result.decisionMapNodeId && onViewDecisionMap) && <button type="button" onClick={onClose} className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950">Done</button>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/30 px-3 py-2 text-xs text-rose-200" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}
            <button
              type="button"
              disabled={Boolean(pendingStrategy)}
              onClick={() => void selectStrategy('rag')}
              className="w-full flex items-start space-x-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/40 transition-all text-left group disabled:cursor-wait disabled:opacity-60"
            >
              <div className="p-2 bg-cyan-950/80 rounded-lg text-cyan-400 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors mt-0.5">
                {pendingStrategy === 'rag' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-slate-200 group-hover:text-cyan-300">{pendingStrategy === 'rag' ? pendingLabels.rag : '1. Search uploaded context inbox (RAG)'}</h4>
                <p className="text-xs text-slate-400 mt-0.5">Check if an answer or relevant evidence already exists in uploaded PDFs/notes.</p>
              </div>
            </button>

            <button
              type="button"
              disabled={Boolean(pendingStrategy)}
              onClick={() => void selectStrategy('experiment')}
              className="w-full flex items-start space-x-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-purple-500/50 hover:bg-slate-800/40 transition-all text-left group disabled:cursor-wait disabled:opacity-60"
            >
              <div className="p-2 bg-purple-950/80 rounded-lg text-purple-400 group-hover:bg-purple-500 group-hover:text-slate-950 transition-colors mt-0.5">
                {pendingStrategy === 'experiment' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-slate-200 group-hover:text-purple-300">{pendingStrategy === 'experiment' ? pendingLabels.experiment : '2. Propose a tiny resolution experiment'}</h4>
                <p className="text-xs text-slate-400 mt-0.5">Create one focused conversation or quick evidence check to resolve this question.</p>
              </div>
            </button>

            <button
              type="button"
              disabled={Boolean(pendingStrategy)}
              onClick={() => void selectStrategy('assumption')}
              className="w-full flex items-start space-x-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-800/40 transition-all text-left group disabled:cursor-wait disabled:opacity-60"
            >
              <div className="p-2 bg-amber-950/80 rounded-lg text-amber-400 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors mt-0.5">
                {pendingStrategy === 'assumption' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bookmark className="w-4 h-4" />}
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-slate-200 group-hover:text-amber-300">{pendingStrategy === 'assumption' ? pendingLabels.assumption : '3. Create a temporary assumption'}</h4>
                <p className="text-xs text-slate-400 mt-0.5">Add an explicit ASSUMPTION node (50% confidence) so project execution is unblocked.</p>
              </div>
            </button>

            <button
              type="button"
              disabled={Boolean(pendingStrategy)}
              onClick={() => void selectStrategy('defer')}
              className="w-full flex items-start space-x-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-600 hover:bg-slate-800/40 transition-all text-left group disabled:cursor-wait disabled:opacity-60"
            >
              <div className="p-2 bg-slate-800 rounded-lg text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-200 transition-colors mt-0.5">
                {pendingStrategy === 'defer' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-slate-200 group-hover:text-slate-100">{pendingStrategy === 'defer' ? pendingLabels.defer : '4. Defer this gap for now'}</h4>
                <p className="text-xs text-slate-400 mt-0.5">Skip this question and move directly to the next highest priority uncertainty.</p>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
