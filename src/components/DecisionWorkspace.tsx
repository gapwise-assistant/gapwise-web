'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, FileText, HelpCircle, Map, X } from 'lucide-react';
import { Project } from '@/types/clarity';
import type { AskTarget } from '@/types/ask';
import { buildDecisionWorkspace, confirmDecision, decisionQuestionForDisplay } from '@/lib/decisions/workspace';
import { normalizeQuestionGrammar, resolveQuestionReferences } from '@/lib/questions/presentation';
import { relevantSourceExcerpt } from '@/lib/questions/whyQuestion';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';
import { Button } from '@/components/ui/Button';
import { requestResolutionValidation, validationSubmission } from '@/lib/resolutions/validationClient';
import { ResolutionValidationNotice } from '@/components/ResolutionValidationNotice';
import type { ResolutionValidation, ResolutionValidationSubmission } from '@/types/resolutionValidation';

interface DecisionWorkspaceProps {
  project: Project;
  targetNodeId: string;
  userId?: string;
  initialOutcome?: string;
  historyTimestamp?: string;
  onClose: () => void;
  onConfirm: (updated: Project) => Promise<void> | void;
  onNavigateToSource?: (sourceId: string) => void;
  onViewGraph?: (nodeId: string) => void;
  onStartChat?: (prompt: string, target: AskTarget) => void;
  onDontKnow?: () => void;
}

function DecisionHelp({
  onBack,
  onTalkThrough,
  onNeedMoreInformation,
  onDecideLater,
}: {
  onBack: () => void;
  onTalkThrough: () => void;
  onNeedMoreInformation: () => void;
  onDecideLater: () => void;
}) {
  return (
    <section className="space-y-4" aria-labelledby="decision-help-title">
      <div>
        <Button variant="ghost" onClick={onBack} className="mb-3">Back</Button>
        <h3 id="decision-help-title" className="text-lg font-bold text-slate-100">What would help?</h3>
      </div>
      <button type="button" onClick={onTalkThrough} className="w-full rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-cyan-500/50 hover:bg-slate-800/40">
        <span className="block text-sm font-bold text-slate-100">Help me decide</span>
        <span className="mt-1 block text-xs leading-relaxed text-slate-400">Compare the options using the context Gapwise already has.</span>
      </button>
      <button type="button" onClick={onNeedMoreInformation} className="w-full rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-cyan-500/50 hover:bg-slate-800/40">
        <span className="block text-sm font-bold text-slate-100">I need more information</span>
        <span className="mt-1 block text-xs leading-relaxed text-slate-400">Show which missing information would most improve this decision.</span>
      </button>
      <button type="button" onClick={onDecideLater} className="w-full rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-slate-600 hover:bg-slate-800/40">
        <span className="block text-sm font-bold text-slate-100">Decide later</span>
        <span className="mt-1 block text-xs leading-relaxed text-slate-400">Leave this decision open and return to it later.</span>
      </button>
    </section>
  );
}

export function DecisionWorkspace({
  project,
  targetNodeId,
  userId,
  initialOutcome,
  historyTimestamp,
  onClose,
  onConfirm,
  onNavigateToSource,
  onViewGraph,
  onStartChat,
  onDontKnow,
}: DecisionWorkspaceProps) {
  const model = useMemo(() => buildDecisionWorkspace(project, targetNodeId), [project, targetNodeId]);
  const initialRecordedOutcome = model?.decision.decision_outcome?.trim() || initialOutcome?.trim() || '';
  const [customDecision, setCustomDecision] = useState(initialRecordedOutcome);
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationCheck, setValidationCheck] = useState<{ validation: ResolutionValidation; fingerprint: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [showChangeFactors, setShowChangeFactors] = useState(false);
  const [showOrigin, setShowOrigin] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showUnknownHelp, setShowUnknownHelp] = useState(false);
  const [allowMissingResolutionEdit, setAllowMissingResolutionEdit] = useState(false);
  const [expandedSourceIds, setExpandedSourceIds] = useState<string[]>([]);
  const emptyDialogRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useDismissibleModal(onClose, emptyDialogRef, !model);
  useDismissibleModal(onClose, dialogRef, Boolean(model));

  useEffect(() => {
    setCustomDecision(initialRecordedOutcome);
    setReason('');
    setIsSaving(false);
    setIsValidating(false);
    setValidationCheck(null);
    setSaved(false);
    setError('');
    setShowChangeFactors(false);
    setShowOrigin(false);
    setShowSources(false);
    setShowUnknownHelp(false);
    setAllowMissingResolutionEdit(false);
    setExpandedSourceIds([]);
  }, [initialOutcome, initialRecordedOutcome, targetNodeId]);

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
          <p className="mt-4 text-sm leading-relaxed text-slate-400">The workspace understanding changed. Close this view and review the current questions.</p>
        </div>
      </div>
    );
  }

  const isResolved = model.decision.status === 'RESOLVED';
  const recordedOutcome = model.decision.decision_outcome?.trim() || initialOutcome?.trim() || '';
  const canEditResolvedDecision = !isResolved || Boolean(recordedOutcome) || allowMissingResolutionEdit;
  const finalDecision = customDecision.trim();
  const decisionTitle = normalizeQuestionGrammar(resolveQuestionReferences(
    decisionQuestionForDisplay(project, model.decision),
    model.sources.map((source) => source.content).join('\n'),
  ));
  const sourceContextNodes = project.nodes.filter((node) => model.sources.some((source) => node.source_refs.includes(source.id)));

  const openSource = (sourceId: string) => {
    onNavigateToSource?.(sourceId);
    onClose();
  };

  const saveDecision = async (
    submission?: ResolutionValidationSubmission,
    check: { validation: ResolutionValidation; fingerprint: string } | null = validationCheck,
  ) => {
    if (!finalDecision || isSaving) return;
    setError('');
    setIsSaving(true);
    try {
      const updated = confirmDecision(project, {
        decisionNodeId: model.decision.id,
        customDecision,
        reason,
        historyTimestamp,
        resolutionValidation: check
          ? {
              verdict: check.validation.verdict,
              overridden: Boolean(submission?.validationOverride && check.validation.verdict === 'warning'),
              reason: check.validation.reason,
              confidence: check.validation.confidence,
            }
          : undefined,
      });
      await onConfirm(updated);
      setSaved(true);
    } catch (caught) {
      setValidationCheck(null);
      setError(caught instanceof Error ? caught.message : 'The decision could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!finalDecision || isSaving || isValidating || validationCheck) return;
    if (!userId) {
      await saveDecision();
      return;
    }

    setError('');
    setIsValidating(true);
    try {
      const result = await requestResolutionValidation({
        userId,
        projectId: project.id,
        nodeId: model.decision.id,
        proposedResponse: finalDecision,
      });
      setValidationCheck(result);
      if (result.validation.verdict === 'sufficient') {
        await saveDecision(validationSubmission(result.fingerprint), result);
      }
    } catch {
      setValidationCheck({
        validation: {
          verdict: 'unavailable',
          reason: 'Gapwise could not check this response right now.',
          missingInformation: [],
          confidence: 0,
        },
        fingerprint: '',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const saveAnyway = () => saveDecision(validationSubmission(
    validationCheck?.fingerprint,
    validationCheck?.validation.verdict === 'warning',
  ));

  const startDecisionChat = () => {
    onStartChat?.(
      `Help me think through this project decision: “${decisionTitle}” Based only on the current project context, suggest two or three reasonable options, explain the tradeoffs, identify what information is missing, and propose a practical next step. Do not make the decision for me.`,
      { type: 'decision', id: model.decision.id, text: decisionTitle },
    );
  };

  const showMissingInformation = () => {
    if (model.decisionInputs.length > 0) {
      setShowUnknownHelp(false);
      setShowChangeFactors(true);
      return;
    }
    startDecisionChat();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/80 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="decision-workspace-title" className="max-h-[calc(100dvh-1rem)] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-6 sm:pb-6">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">{isResolved ? 'Resolved decision' : 'Decision'}</p>
            <h2 id="decision-workspace-title" className="mt-2 text-xl font-extrabold leading-relaxed text-slate-100">{decisionTitle}</h2>
            {model.decision.why_it_matters?.[0] && <p className="mt-2 text-sm leading-relaxed text-slate-400">{model.decision.why_it_matters[0]}</p>}
          </div>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-slate-100" aria-label="Close decision workspace">
            <X className="mx-auto h-4 w-4" />
          </button>
        </header>

        <div className="mt-5 space-y-5">
          {isResolved && (
            <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3" aria-labelledby="previous-decision-heading">
              <h3 id="previous-decision-heading" className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Previous decision</h3>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-300" title={model.decision.text}>{model.decision.text}</p>
              {recordedOutcome ? (
                <>
                  <p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Recorded decision</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{recordedOutcome}</p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">This decision is already recorded. Edit it below only if the decision has changed.</p>
                </>
              ) : (
                <p className="mt-3 text-sm font-bold text-rose-200" role="alert">The recorded resolution is unavailable.</p>
              )}
            </section>
          )}

          {model.decisionInputs.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
              <button type="button" aria-expanded={showChangeFactors} aria-controls="decision-change-factors" onClick={() => setShowChangeFactors((value) => !value)} className="flex min-h-10 w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-bold text-slate-300 hover:bg-slate-800/50 hover:text-slate-100">
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${showChangeFactors ? 'rotate-90 text-cyan-300' : ''}`} aria-hidden="true" />
                <span className="flex-1">What could change this decision</span>
                <span className="text-slate-500">{model.decisionInputs.length}</span>
              </button>
              {showChangeFactors && (
                <div id="decision-change-factors" className="space-y-4 border-t border-slate-800 px-3 pb-3 pt-3">
                  {model.decisionInputs.map((input) => (
                    <div key={input.node.id} className="border-l border-cyan-900 pl-4">
                      <p className="text-sm font-medium leading-relaxed text-slate-100">{input.node.text}</p>
                      {input.why && <p className="mt-1 text-sm leading-relaxed text-slate-400">{input.why}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
            <button type="button" aria-expanded={showOrigin} aria-controls="decision-origin" onClick={() => setShowOrigin((value) => !value)} className="flex min-h-10 w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-bold text-slate-300 hover:bg-slate-800/50 hover:text-slate-100">
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${showOrigin ? 'rotate-90 text-cyan-300' : ''}`} aria-hidden="true" />
              <span className="flex-1">Where this comes from</span>
            </button>
            {showOrigin && (
              <div id="decision-origin" className="border-t border-slate-800 px-3 pb-3 pt-2.5">
                {model.sources.length > 0 ? (
                <div className="mt-2 space-y-3">
                  {model.sources.map((source) => {
                    const sourceNodes = sourceContextNodes.filter((node) => node.source_refs.includes(source.id));
                    const relevant = relevantSourceExcerpt(source, sourceNodes);
                    const fullText = source.content.trim() || source.extraction_summary || 'No source text is available.';
                    const expanded = expandedSourceIds.includes(source.id);
                    return (
                      <div key={source.id} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span className="min-w-0 flex-1 text-xs font-semibold text-slate-300">{source.filename}</span>
                          {onNavigateToSource && <button type="button" onClick={() => openSource(source.id)} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-cyan-200 hover:text-cyan-100">Open source <ChevronRight className="h-3.5 w-3.5" /></button>}
                        </div>
                        <p className="px-3 py-3 text-xs leading-relaxed text-slate-200"><mark className="rounded bg-cyan-400/20 px-1 text-cyan-100">{relevant}</mark></p>
                        {fullText !== relevant && (
                          <>
                            {expanded && <p className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-slate-800 px-3 py-3 text-xs leading-relaxed text-slate-300">{fullText}</p>}
                            <button type="button" onClick={() => setExpandedSourceIds((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id])} className="border-t border-slate-800 px-3 py-2 text-[11px] font-bold text-cyan-300 hover:text-cyan-200">
                              {expanded ? 'Hide full context' : 'Expand full context'}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                ) : <p className="text-xs leading-relaxed text-slate-500">No linked source text was recorded for this decision.</p>}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
            <button type="button" aria-expanded={showSources} aria-controls="decision-sources" onClick={() => setShowSources((value) => !value)} className="flex min-h-10 w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-bold text-slate-300 hover:bg-slate-800/50 hover:text-slate-100">
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${showSources ? 'rotate-90 text-cyan-300' : ''}`} aria-hidden="true" />
              <span className="flex-1">Sources</span>
              <span className="text-slate-500">{model.sources.length}</span>
            </button>
            {showSources && (
              <div id="decision-sources" className="space-y-1.5 border-t border-slate-800 px-3 pb-3 pt-2.5">
                {model.sources.length > 0 ? model.sources.map((source) => onNavigateToSource ? (
                  <button key={source.id} type="button" onClick={() => openSource(source.id)} className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left text-xs font-semibold text-cyan-200 hover:border-cyan-700"><FileText className="h-3.5 w-3.5 shrink-0" />{source.filename}<ChevronRight className="ml-auto h-3.5 w-3.5" /></button>
                ) : <div key={source.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300"><FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />{source.filename}</div>) : <p className="text-xs leading-relaxed text-slate-500">No sources are linked to this decision.</p>}
              </div>
            )}
          </section>

          {onViewGraph && (
            <Button
              variant="ghost"
              onClick={() => { onViewGraph(model.decision.id); onClose(); }}
              icon={<Map className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              View in Decision Map
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}

          {isResolved && !recordedOutcome && !allowMissingResolutionEdit && !saved && (
            <section className="border-t border-slate-800 pt-5">
              <p className="text-xs leading-relaxed text-slate-400">The original decision is resolved, but its recorded outcome was not available. You can deliberately record a replacement resolution.</p>
              <Button variant="secondary" className="mt-4" onClick={() => setAllowMissingResolutionEdit(true)}>
                Record replacement resolution
              </Button>
            </section>
          )}

          {canEditResolvedDecision && !saved && !showUnknownHelp && (
            <section className="border-t border-slate-800 pt-5">
              <h3 className="text-sm font-extrabold text-slate-100">{isResolved ? 'Edit previous decision' : 'Your decision'}</h3>
              <p className="mt-1 text-xs text-slate-500">{isResolved ? 'You are editing a decision already saved in this workspace. Enter the updated wording only if the decision has changed.' : 'Record what you decided and why.'}</p>
              <label className="mt-4 block text-xs font-bold text-slate-300" htmlFor="custom-decision">{isResolved ? 'Updated decision' : 'Your decision'}</label>
              <textarea id="custom-decision" value={customDecision} onChange={(event) => { setCustomDecision(event.target.value); setValidationCheck(null); }} rows={3} placeholder={isResolved ? 'Enter the updated decision' : 'Write your decision…'} className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-cyan-600" />
              <label className="mt-4 block text-xs font-bold text-slate-300" htmlFor="decision-reason">Reason <span className="font-normal text-slate-500">(optional)</span></label>
              <input id="decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Add a short reason" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-cyan-600" />
              {(!isResolved || !onDontKnow) && (
                <Button
                  variant="ghost"
                  onClick={() => onDontKnow ? onDontKnow() : setShowUnknownHelp(true)}
                  className="mt-4"
                  icon={<HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  I don&apos;t know yet
                </Button>
              )}
              {isValidating && (
                <p className="mt-3 text-xs text-slate-400" role="status">Checking whether this decision is specific enough…</p>
              )}
              {validationCheck && validationCheck.validation.verdict !== 'sufficient' && (
                <div className="mt-4">
                  <ResolutionValidationNotice
                    validation={validationCheck.validation}
                    onEdit={() => setValidationCheck(null)}
                    onSave={() => void saveAnyway()}
                    saving={isSaving}
                  />
                </div>
              )}
              {error && <p className="mt-3 text-xs text-rose-300" role="alert">{error}</p>}
              <Button
                variant="primary"
                size="md"
                className="mt-4 w-full"
                loading={isSaving || isValidating}
                disabled={!finalDecision || Boolean(validationCheck)}
                onClick={() => void handleConfirm()}
              >
                {isResolved ? 'Update decision' : 'Make decision'}
              </Button>
            </section>
          )}

          {!saved && showUnknownHelp && (
            <section className="border-t border-slate-800 pt-5">
              <DecisionHelp
                onBack={() => setShowUnknownHelp(false)}
                onTalkThrough={startDecisionChat}
                onNeedMoreInformation={showMissingInformation}
                onDecideLater={onClose}
              />
            </section>
          )}

          {saved && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /><div><p className="text-sm font-bold text-emerald-200">{isResolved ? 'Decision updated' : 'Decision saved'}</p><p className="mt-1 text-xs text-emerald-300/80">The graph and Today will use the updated understanding.</p></div></div></div>
          )}
        </div>
      </div>
    </div>
  );
}
