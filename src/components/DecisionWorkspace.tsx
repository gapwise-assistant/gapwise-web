'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleHelp, FileText, Loader2, X } from 'lucide-react';
import { Project } from '@/types/clarity';
import { buildDecisionWorkspace, confirmDecision } from '@/lib/decisions/workspace';
import { buildDecisionPath } from '@/lib/graph/constellation';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';

interface DecisionWorkspaceProps {
  project: Project;
  targetNodeId: string;
  onClose: () => void;
  onConfirm: (updated: Project) => Promise<void> | void;
  onNavigateToSource?: (sourceId: string) => void;
  onResolveQuestion?: (nodeId: string) => void;
  onViewGraph?: (nodeId: string) => void;
}

function considerationLabel(type: Project['nodes'][number]['type']): string {
  if (type === 'PREFERENCE') return 'Preference';
  if (type === 'CONSTRAINT') return 'Constraint';
  if (type === 'RISK') return 'Risk';
  if (type === 'ASSUMPTION') return 'Assumption';
  return 'Context';
}

export function DecisionWorkspace({
  project,
  targetNodeId,
  onClose,
  onConfirm,
  onNavigateToSource,
  onResolveQuestion,
  onViewGraph,
}: DecisionWorkspaceProps) {
  const model = useMemo(() => buildDecisionWorkspace(project, targetNodeId), [project, targetNodeId]);
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [customDecision, setCustomDecision] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [decisionFormOpen, setDecisionFormOpen] = useState(false);
  const [showAllConsiderations, setShowAllConsiderations] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const emptyDialogRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useDismissibleModal(onClose, emptyDialogRef, !model);
  useDismissibleModal(onClose, dialogRef, Boolean(model));

  useEffect(() => {
    setSelectedOptionId('');
    setCustomDecision('');
    setReason('');
    setIsSaving(false);
    setSaved(false);
    setError('');
    setDecisionFormOpen(false);
    setShowAllConsiderations(false);
    setShowAllSources(false);
  }, [targetNodeId]);

  if (!model) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
        <div ref={emptyDialogRef} role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Decision workspace</p>
              <h2 className="mt-2 text-lg font-bold text-slate-100">This decision is no longer available</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Close decision workspace">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">The project understanding changed. Close this view and review the current questions.</p>
        </div>
      </div>
    );
  }

  const selectedOption = model.options.find((option) => option.id === selectedOptionId);
  const finalDecision = customDecision.trim() || selectedOption?.text.trim() || '';
  const hasReasoningPath = buildDecisionPath(project, model.decision.id).nodeIds.length > 1;
  const considerations = [...model.constraints, ...model.assumptionsRisks];
  const visibleConsiderations = showAllConsiderations ? considerations : considerations.slice(0, 3);
  const visibleSources = showAllSources ? model.sources : model.sources.slice(0, 3);

  const openSource = (sourceId: string) => {
    onNavigateToSource?.(sourceId);
    onClose();
  };

  const handleConfirm = async () => {
    if (!finalDecision || isSaving) return;
    setError('');
    setIsSaving(true);
    try {
      const updated = confirmDecision(project, {
        decisionNodeId: model.decision.id,
        selectedOption: selectedOption?.text,
        customDecision,
        reason,
      });
      await onConfirm(updated);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The decision could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/80 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="decision-workspace-title" className="max-h-[calc(100dvh-1rem)] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-6 sm:pb-6">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Decision</p>
            <h2 id="decision-workspace-title" className="mt-2 text-xl font-extrabold leading-relaxed text-slate-100">{model.decision.text}</h2>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-slate-100" aria-label="Close decision workspace">
            <X className="mx-auto h-4 w-4" />
          </button>
        </header>

        <div className="mt-5 space-y-5">
          {model.currentPicture.length > 0 && (
            <section className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4">
              <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-300">Current picture</h3>
              <ul className="mt-2 space-y-2">{model.currentPicture.map((item) => <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-300"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />{item}</li>)}</ul>
              {model.recommendation && <p className="mt-3 text-xs font-bold text-cyan-200">Recorded lean: {model.recommendation.option.label}</p>}
            </section>
          )}

          {model.options.length > 0 && (
            <section>
              <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Options</h3>
              <div className="mt-2 space-y-2">
                {model.options.map((option) => (
                  <button key={option.id} type="button" onClick={() => setSelectedOptionId(option.id)} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${selectedOptionId === option.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                    <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${selectedOptionId === option.id ? 'border-cyan-300 bg-cyan-400' : 'border-slate-600'}`} />
                    <span className="min-w-0"><span className="block text-xs font-bold text-slate-100">{option.label}</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">{option.text}</span></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {visibleConsiderations.length > 0 && (
            <section>
              <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Key considerations</h3>
              <div className="mt-2 space-y-2">
                {visibleConsiderations.map((node) => (
                  <div key={node.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <p className={`text-[10px] font-extrabold uppercase tracking-[0.14em] ${node.type === 'RISK' ? 'text-amber-300' : 'text-slate-500'}`}>{considerationLabel(node.type)}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">{node.text}</p>
                  </div>
                ))}
              </div>
              {considerations.length > 3 && <button type="button" onClick={() => setShowAllConsiderations((current) => !current)} className="mt-2 text-xs font-semibold text-cyan-300 hover:text-cyan-200">{showAllConsiderations ? 'Show fewer' : `Show ${considerations.length - 3} more`}</button>}
            </section>
          )}

          {model.remainingQuestions.length > 0 && (
            <section>
              <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-rose-300">Needs answer</h3>
              <div className="mt-2 space-y-2">
                {model.remainingQuestions.map((question) => (
                  <div key={question.node.id} className="flex items-start justify-between gap-3 rounded-lg border border-rose-900/60 bg-rose-950/20 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-relaxed text-slate-100">{question.node.text}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">{question.why}</p>
                    </div>
                    {onResolveQuestion && <button type="button" onClick={() => onResolveQuestion(question.node.id)} className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-cyan-300 hover:text-cyan-200">Resolve <ChevronRight className="h-3.5 w-3.5" /></button>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {model.sources.length > 0 && (
            <section>
              <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Sources</h3>
              <div className="mt-2 space-y-1.5">
                {visibleSources.map((source) => onNavigateToSource ? (
                  <button key={source.id} type="button" onClick={() => openSource(source.id)} className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left text-xs font-semibold text-cyan-200 hover:border-cyan-700"><FileText className="h-3.5 w-3.5 shrink-0" />{source.filename}<ChevronRight className="ml-auto h-3.5 w-3.5" /></button>
                ) : <div key={source.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300"><FileText className="h-3.5 w-3.5 shrink-0" />{source.filename}</div>)}
              </div>
              {model.sources.length > 3 && <button type="button" onClick={() => setShowAllSources((current) => !current)} className="mt-2 text-xs font-semibold text-cyan-300 hover:text-cyan-200">{showAllSources ? 'Show fewer sources' : `View ${model.sources.length - 3} more sources`}</button>}
            </section>
          )}

          {onViewGraph && hasReasoningPath && (
            <button type="button" onClick={() => { onViewGraph(model.decision.id); onClose(); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-cyan-200">
              <CircleHelp className="h-3.5 w-3.5" /> View in Decision Map <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}

          {!decisionFormOpen && !saved && (
            <section className="border-t border-slate-800 pt-5">
              <p className="text-sm font-bold text-slate-100">Ready to decide?</p>
              <p className="mt-1 text-xs text-slate-500">Make a decision only after reviewing the current context.</p>
              <button type="button" onClick={() => setDecisionFormOpen(true)} className="mt-3 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950">Make decision</button>
            </section>
          )}

          {decisionFormOpen && !saved && (
            <section className="border-t border-slate-800 pt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-100">Your decision</h3>
                  <p className="mt-1 text-xs text-slate-500">Confirming updates this project understanding and keeps the decision history.</p>
                </div>
                <button type="button" onClick={() => setDecisionFormOpen(false)} className="text-xs font-semibold text-slate-400 hover:text-slate-200">Collapse</button>
              </div>
              <label className="mt-4 block text-xs font-bold text-slate-300" htmlFor="custom-decision">Your decision</label>
              <input id="custom-decision" value={customDecision} onChange={(event) => setCustomDecision(event.target.value)} placeholder="Enter the decision Gapwise should remember" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-cyan-600" />
              <label className="mt-4 block text-xs font-bold text-slate-300" htmlFor="decision-reason">Reason <span className="font-normal text-slate-500">(optional)</span></label>
              <textarea id="decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Add a short reason Gapwise should remember" className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-cyan-600" />
              {error && <p className="mt-3 text-xs text-rose-300" role="alert">{error}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => void handleConfirm()} disabled={!finalDecision || isSaving} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Make decision
                </button>
              </div>
            </section>
          )}

          {saved && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /><div><p className="text-sm font-bold text-emerald-200">Decision saved</p><p className="mt-1 text-xs text-emerald-300/80">The graph and Today will use the updated understanding.</p></div></div></div>
          )}
        </div>
      </div>
    </div>
  );
}
