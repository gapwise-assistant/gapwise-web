'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleHelp, FileText, Loader2, X } from 'lucide-react';
import { Project } from '@/types/clarity';
import { buildDecisionWorkspace, DecisionWorkspaceModel, confirmDecision } from '@/lib/decisions/workspace';
import { buildDecisionPath } from '@/lib/graph/constellation';

interface DecisionWorkspaceProps {
  project: Project;
  targetNodeId: string;
  onClose: () => void;
  onConfirm: (updated: Project) => Promise<void> | void;
  onNavigateToSource?: (sourceId: string) => void;
  onViewGraph?: (nodeId: string) => void;
}

function sourceLabel(model: DecisionWorkspaceModel, sourceId: string): string {
  return model.sources.find((source) => source.id === sourceId)?.filename ?? 'Context source';
}

export function DecisionWorkspace({
  project,
  targetNodeId,
  onClose,
  onConfirm,
  onNavigateToSource,
  onViewGraph,
}: DecisionWorkspaceProps) {
  const model = useMemo(() => buildDecisionWorkspace(project, targetNodeId), [project, targetNodeId]);
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [customDecision, setCustomDecision] = useState('');
  const [reason, setReason] = useState('');
  const [resolveQuestionIds, setResolveQuestionIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedOptionId('');
    setCustomDecision('');
    setReason('');
    setResolveQuestionIds([]);
    setIsSaving(false);
    setSaved(false);
    setError('');
  }, [targetNodeId]);

  if (!model) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Review decision</p>
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

  const toggleQuestion = (nodeId: string) => {
    setResolveQuestionIds((current) => current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]);
  };

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
        resolveQuestionIds,
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
      <div role="dialog" aria-modal="true" aria-labelledby="decision-workspace-title" className="max-h-[calc(100dvh-1rem)] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-6 sm:pb-6">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Review decision</p>
            <h2 id="decision-workspace-title" className="mt-2 text-xl font-extrabold text-slate-100">{model.decision.text}</h2>
            <p className="mt-2 text-xs text-slate-500">Use the context already connected to this decision to make the next step clear.</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-slate-100" aria-label="Close decision workspace">
            <X className="mx-auto h-4 w-4" />
          </button>
        </header>

        <div className="mt-5 space-y-6">
          <section className="rounded-xl border border-indigo-900/70 bg-indigo-950/20 p-4">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.16em] text-indigo-300">Decision being made</h3>
            <p className="mt-2 text-base font-bold leading-relaxed text-slate-100">{model.decision.text}</p>
          </section>

          <section>
            <h3 className="text-sm font-extrabold text-slate-100">Relevant options</h3>
            {model.options.length ? (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {model.options.map((option) => (
                  <label key={option.id} className={`block cursor-pointer rounded-xl border p-4 transition ${selectedOptionId === option.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                    <span className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="decision-option"
                        value={option.id}
                        checked={selectedOptionId === option.id}
                        onChange={() => setSelectedOptionId(option.id)}
                        className="mt-1 accent-cyan-400"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-slate-100">{option.label}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-slate-400">{option.text}</span>
                      </span>
                    </span>
                    <span className="mt-3 block space-y-2 border-t border-slate-800 pt-3">
                      <span className="block text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Evidence supporting this option</span>
                      {option.evidence.map((evidence) => (
                        <span key={evidence.id} className="block text-xs leading-relaxed text-slate-300">
                          {evidence.text}
                          {evidence.sourceIds.map((sourceId) => onNavigateToSource ? (
                            <button key={sourceId} type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openSource(sourceId); }} className="mt-1 block text-left text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">
                              Source: {sourceLabel(model, sourceId)}
                            </button>
                          ) : <span key={sourceId} className="mt-1 block text-[11px] text-slate-500">Source: {sourceLabel(model, sourceId)}</span>)}
                        </span>
                      ))}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-500">No explicit options are recorded yet. You can enter the decision you want to make below.</p>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-extrabold text-slate-100">Important constraints and preferences</h3>
              {model.constraints.length ? (
                <ul className="mt-3 space-y-2">{model.constraints.map((node) => <li key={node.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">{node.text}</li>)}</ul>
              ) : <p className="mt-3 text-xs text-slate-500">No directly connected constraints or preferences are recorded.</p>}
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-100">Assumptions and risks</h3>
              {model.assumptionsRisks.length ? (
                <ul className="mt-3 space-y-2">{model.assumptionsRisks.map((node) => <li key={node.id} className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs leading-relaxed text-slate-300">{node.text}</li>)}</ul>
              ) : <p className="mt-3 text-xs text-slate-500">No directly connected assumptions or risks are recorded.</p>}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-extrabold text-slate-100">Still unclear</h3>
            {model.remainingQuestions.length ? (
              <div className="mt-3 space-y-3">
                {model.remainingQuestions.map((question) => (
                  <label key={question.node.id} className="flex items-start gap-3 rounded-xl border border-rose-900/60 bg-rose-950/20 p-4">
                    <input type="checkbox" checked={resolveQuestionIds.includes(question.node.id)} onChange={() => toggleQuestion(question.node.id)} className="mt-1 accent-cyan-400" />
                    <span>
                      <span className="block text-sm font-semibold leading-relaxed text-slate-100">{question.node.text}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-slate-400">{question.why}</span>
                      {question.affects.length > 0 && <span className="mt-2 block text-[11px] text-slate-500">Affects: {question.affects.map((node) => node.text).join(' · ')}</span>}
                      <span className="mt-2 block text-[11px] text-cyan-300">Mark resolved after confirming this decision</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-500">No connected open question is blocking this decision.</p>}
          </section>

          <section className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4">
            <h3 className="text-sm font-extrabold text-slate-100">Current picture</h3>
            <ul className="mt-3 space-y-2">{model.currentPicture.map((item) => <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-300"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />{item}</li>)}</ul>
            {model.recommendation && <p className="mt-4 text-sm font-bold text-cyan-200">Gapswise currently leans toward {model.recommendation.option.label}</p>}
          </section>

          <section>
            <h3 className="text-sm font-extrabold text-slate-100">Relevant sources</h3>
            {model.sources.length ? (
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {model.sources.map((source) => onNavigateToSource ? (
                  <button key={source.id} type="button" onClick={() => openSource(source.id)} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left text-xs font-semibold text-cyan-300 hover:border-cyan-700"><FileText className="h-4 w-4 shrink-0" />{source.filename}<ChevronRight className="ml-auto h-3.5 w-3.5" /></button>
                ) : <div key={source.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs font-semibold text-slate-300"><FileText className="h-4 w-4 shrink-0" />{source.filename}</div>)}
              </div>
            ) : <p className="mt-3 text-xs text-slate-500">No named sources are connected to this decision yet.</p>}
          </section>

          {onViewGraph && hasReasoningPath && (
            <button type="button" onClick={() => { onViewGraph(model.decision.id); onClose(); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cyan-800 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-200 hover:border-cyan-600">
              <CircleHelp className="h-4 w-4" /> View reasoning path
            </button>
          )}

          <section className="border-t border-slate-800 pt-5">
            <h3 className="text-sm font-extrabold text-slate-100">Make decision</h3>
            <p className="mt-1 text-xs text-slate-500">Confirming updates this project understanding and keeps the decision history.</p>
            <label className="mt-4 block text-xs font-bold text-slate-300" htmlFor="custom-decision">Custom decision <span className="font-normal text-slate-500">(optional if you choose an option)</span></label>
            <input id="custom-decision" value={customDecision} onChange={(event) => setCustomDecision(event.target.value)} placeholder="e.g. Choose Apartment B" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-cyan-600" />
            <label className="mt-4 block text-xs font-bold text-slate-300" htmlFor="decision-reason">Why this decision? <span className="font-normal text-slate-500">(optional)</span></label>
            <textarea id="decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Add a short reason Gapswise should preserve." className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-cyan-600" />
            {error && <p className="mt-3 text-xs text-rose-300" role="alert">{error}</p>}
            {saved ? (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-800 bg-emerald-950/30 p-4"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /><div><p className="text-sm font-bold text-emerald-200">Decision confirmed</p><p className="mt-1 text-xs text-emerald-300/80">The graph and Today will use the updated understanding.</p></div></div>
            ) : (
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200">Cancel</button>
                <button type="button" onClick={() => void handleConfirm()} disabled={!finalDecision || isSaving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm decision
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
