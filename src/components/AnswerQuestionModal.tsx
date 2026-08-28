'use client';

import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, FileText, HelpCircle, Map, X } from 'lucide-react';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';
import { Button } from '@/components/ui/Button';
import type { QuestionWhyExplanation } from '@/lib/questions/whyQuestion';

export interface AnswerQuestionDecisionOption {
  id: string;
  label: string;
  text: string;
  evidence?: Array<{ text: string; sourceNames?: string[] }>;
}

export interface AnswerQuestionDecisionSupport {
  options: AnswerQuestionDecisionOption[];
  currentPicture: string[];
  recommendation?: {
    optionId: string;
    label: string;
    explanation: string;
  } | null;
}

type ResolveSection = 'affects' | 'changes' | 'checks' | 'options' | 'origin' | 'sources';

export interface AnswerQuestionTarget {
  nodeId?: string;
  question: string;
  reason?: string;
  projectId?: string;
  mode?: 'answer' | 'edit';
  intent?: 'confirm' | 'correct';
  initialAnswer?: string;
  historyTimestamp?: string;
  decisionNodeId?: string;
  decisionTitle?: string;
  explanation?: QuestionWhyExplanation;
  presentationTitle?: string;
  presentationSummary?: string;
  decisionSupport?: AnswerQuestionDecisionSupport;
  answerSuggestion?: {
    suggestedAnswer: string;
    whyItMatters: string;
  };
}

interface AnswerQuestionModalProps {
  target: AnswerQuestionTarget;
  onSubmit: (answer: string) => Promise<void>;
  onDontKnow?: () => void;
  onNavigateToSource?: (sourceId: string) => void;
  onViewDecisionMap?: (nodeId: string) => void;
  onClose: () => void;
}

interface AccordionSectionProps {
  id: ResolveSection;
  label: string;
  open: boolean;
  onToggle: (id: ResolveSection) => void;
  children: React.ReactNode;
}

function AccordionSection({ id, label, open, onToggle, children }: AccordionSectionProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-content`}
        onClick={() => onToggle(id)}
        className="flex min-h-10 w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-bold text-slate-300 hover:bg-slate-800/50 hover:text-slate-100"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90 text-cyan-300' : ''}`} aria-hidden="true" />
        {label}
      </button>
      {open && <div id={`${id}-content`} className="border-t border-slate-800 px-3 pb-3 pt-2.5">{children}</div>}
    </section>
  );
}

function presentationImpact(value: string): string {
  const blocked = value.match(/^Gapwise cannot confidently move to (.+) until this is answered\.?$/i);
  if (blocked) return `This answer is needed before ${blocked[1].replace(/[.!?]+$/, '')}.`;
  const decision = value.match(/^decision:\s*(.+)$/i);
  if (decision) return `The decision “${decision[1].replace(/[.!?]+$/, '')}” may change.`;
  const nextAction = value.match(/^next action:\s*(.+)$/i);
  if (nextAction) return `The next action “${nextAction[1].replace(/[.!?]+$/, '')}” may change.`;
  return value;
}

export function AnswerQuestionModal({
  target,
  onSubmit,
  onDontKnow,
  onNavigateToSource,
  onViewDecisionMap,
  onClose,
}: AnswerQuestionModalProps) {
  const [answer, setAnswer] = useState(target.initialAnswer ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [openSections, setOpenSections] = useState<ResolveSection[]>([]);
  const [expandedSourceIds, setExpandedSourceIds] = useState<string[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState(target.decisionSupport?.recommendation?.optionId ?? target.decisionSupport?.options[0]?.id ?? '');
  const [simulationOptionId, setSimulationOptionId] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useDismissibleModal(onClose, dialogRef);

  useEffect(() => {
    setAnswer(target.initialAnswer ?? '');
    setError('');
    setSaved(false);
    setOpenSections([]);
    setExpandedSourceIds([]);
    const recommendedOptionId = target.decisionSupport?.recommendation?.optionId ?? target.decisionSupport?.options[0]?.id ?? '';
    setSelectedOptionId(recommendedOptionId);
    setSimulationOptionId('');
  }, [target.projectId, target.nodeId, target.historyTimestamp, target.initialAnswer]);

  const sources = (target.explanation?.evidence ?? []).filter((source) => source.title.trim());
  const whatThisAffects = (target.explanation?.whatThisBlocks ?? []).filter((item) => item.trim());
  const whatCouldChange = (target.explanation?.whatCouldChange ?? []).filter((item) => item.trim());
  const relatedChecks = (target.explanation?.relatedChecks ?? []).filter((item) => item.text.trim()).slice(0, 4);
  const decisionSupport = target.decisionSupport;
  const hasOptions = Boolean(decisionSupport && (decisionSupport.options.length > 0 || decisionSupport.recommendation));
  const selectedOption = decisionSupport?.options.find((option) => option.id === selectedOptionId);
  const simulatedOption = decisionSupport?.options.find((option) => option.id === simulationOptionId);
  const missingSavedAnswer = target.mode === 'edit'
    && (typeof target.initialAnswer !== 'string' || !target.initialAnswer.trim());

  const toggleSection = (section: ResolveSection) => {
    setOpenSections((current) => current.includes(section)
      ? current.filter((item) => item !== section)
      : [...current, section]);
  };

  const openSource = (sourceId: string) => {
    if (!onNavigateToSource || sourceId.startsWith('gcal_')) return;
    onNavigateToSource(sourceId);
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!answer.trim() || isSaving) return;
    setError('');
    setIsSaving(true);
    try {
      await onSubmit(answer.trim());
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The answer could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="answer-question-title" className="max-h-[calc(100dvh-1rem)] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-6 sm:pb-6">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Resolve</p>
            <h2 id="answer-question-title" className="mt-2 text-lg font-extrabold leading-relaxed text-slate-100">
              {target.presentationTitle ?? target.question}
            </h2>
            {(target.presentationSummary ?? target.answerSuggestion?.whyItMatters ?? target.reason) && (
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{target.presentationSummary ?? target.answerSuggestion?.whyItMatters ?? target.reason}</p>
            )}
          </div>
          <div className="relative flex shrink-0 items-center gap-1">
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {missingSavedAnswer ? (
          <div className="mt-5 rounded-xl border border-rose-800 bg-rose-950/30 p-4" role="alert">
            <p className="text-sm font-bold text-rose-200">The saved response could not be loaded.</p>
            <p className="mt-1 text-xs leading-relaxed text-rose-300/80">This resolved gap was not opened with a valid saved answer, so it was not opened in an empty editor.</p>
          </div>
        ) : saved ? (
          <div className="mt-5 rounded-xl border border-emerald-800 bg-emerald-950/30 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-bold text-emerald-200">Updated</p>
                <p className="mt-1 text-xs leading-relaxed text-emerald-300/80">Gapwise now understands this question as resolved. The related decision and Today recommendations have been refreshed.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="primary" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              {whatThisAffects.length > 0 && (
                <AccordionSection id="affects" label="What this affects" open={openSections.includes('affects')} onToggle={toggleSection}>
                  <ul className="space-y-2">{whatThisAffects.slice(0, 3).map((item) => <li key={item} className="flex gap-2 text-xs leading-relaxed text-slate-300"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />{presentationImpact(item)}</li>)}</ul>
                </AccordionSection>
              )}
              {whatCouldChange.length > 0 && (
                <AccordionSection id="changes" label="What your answer could change" open={openSections.includes('changes')} onToggle={toggleSection}>
                  <ul className="space-y-2">{whatCouldChange.slice(0, 3).map((item) => <li key={item} className="flex gap-2 text-xs leading-relaxed text-slate-300"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />{presentationImpact(item)}</li>)}</ul>
                </AccordionSection>
              )}
              {relatedChecks.length > 0 && (
                <AccordionSection id="checks" label="Related checks" open={openSections.includes('checks')} onToggle={toggleSection}>
                  <ul className="space-y-2">
                    {relatedChecks.map((item) => (
                      <li key={`${item.kind}-${item.text}`} className="flex gap-2 text-xs leading-relaxed text-slate-300">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                        <span><span className="font-semibold text-slate-400">{item.kind}:</span> {item.text}</span>
                      </li>
                    ))}
                  </ul>
                </AccordionSection>
              )}
              {hasOptions && decisionSupport && (
                <AccordionSection id="options" label="Decision options" open={openSections.includes('options')} onToggle={toggleSection}>
                  <div className="space-y-3">
                    {decisionSupport.recommendation && <div className="rounded-lg border border-cyan-900/70 bg-cyan-950/20 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">Current recommendation · {decisionSupport.recommendation.label}</p><p className="mt-1 text-xs leading-relaxed text-slate-300">{decisionSupport.recommendation.explanation}</p></div>}
                    {decisionSupport.options.slice(0, decisionSupport.recommendation ? 3 : 4).map((option) => (
                      <label key={option.id} className={`block cursor-pointer rounded-lg border p-3 transition ${selectedOptionId === option.id ? 'border-cyan-700 bg-cyan-950/20' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}>
                        <span className="flex items-start gap-2">
                          <input type="radio" name="decision-option" value={option.id} checked={selectedOptionId === option.id} onChange={() => { setSelectedOptionId(option.id); setSimulationOptionId(''); }} className="mt-0.5 accent-cyan-400" />
                          <span className="min-w-0"><span className="block text-xs font-bold text-slate-100">{option.label}</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">{option.text}</span>{option.evidence && option.evidence.length > 0 && <span className="mt-2 block text-[11px] leading-relaxed text-slate-500">Evidence: {option.evidence[0].text}{option.evidence[0].sourceNames && option.evidence[0].sourceNames.length > 0 ? ` · ${option.evidence[0].sourceNames[0]}` : ''}</span>}</span>
                        </span>
                      </label>
                    ))}
                    {selectedOption && <Button variant="secondary" onClick={() => setSimulationOptionId(selectedOption.id)}>Simulate on Decision Map</Button>}
                    {simulatedOption && <div className="rounded-lg border border-indigo-800/70 bg-indigo-950/20 p-3" role="status"><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-indigo-300">Decision Map preview</p><p className="mt-1 text-xs font-semibold text-slate-200">{target.decisionTitle ?? 'The related decision'} would become: {simulatedOption.text}</p><p className="mt-1 text-[11px] text-indigo-200">Selected path: {simulatedOption.label}</p><p className="mt-2 text-[11px] text-slate-500">This is a simulation only; your decision map has not been changed.</p></div>}
                  </div>
                </AccordionSection>
              )}
              {target.explanation && (
                <AccordionSection id="origin" label="Where this comes from" open={openSections.includes('origin')} onToggle={toggleSection}>
                  {sources.length > 0 ? (
                    <div className="space-y-3">
                      {sources.map((source) => (
                        <div key={`${source.sourceId ?? source.title}-${source.excerpt}`} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                          <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            <span className="min-w-0 flex-1 text-xs font-semibold text-slate-300">{source.title}</span>
                            {source.sourceId && onNavigateToSource && !source.sourceId.startsWith('gcal_') && <button type="button" onClick={() => openSource(source.sourceId as string)} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-cyan-200 hover:text-cyan-100">Open source <ChevronRight className="h-3.5 w-3.5" /></button>}
                          </div>
                          <p className="px-3 py-3 text-xs leading-relaxed text-slate-200"><mark className="rounded bg-cyan-400/20 px-1 text-cyan-100">{source.relevantExcerpt ?? source.excerpt}</mark></p>
                          {source.fullText && source.fullText !== (source.relevantExcerpt ?? source.excerpt) && (
                            <>
                              {expandedSourceIds.includes(source.sourceId ?? source.title) && <p className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-slate-800 px-3 py-3 text-xs leading-relaxed text-slate-300">{source.fullText}</p>}
                              <button type="button" onClick={() => {
                                const id = source.sourceId ?? source.title;
                                setExpandedSourceIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
                              }} className="border-t border-slate-800 px-3 py-2 text-[11px] font-bold text-cyan-300 hover:text-cyan-200">
                                {expandedSourceIds.includes(source.sourceId ?? source.title) ? 'Hide full context' : 'Expand full context'}
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs leading-relaxed text-slate-500">No linked source text was recorded for this gap.</p>}
                </AccordionSection>
              )}
              {sources.length > 0 && (
                <AccordionSection id="sources" label="Sources" open={openSections.includes('sources')} onToggle={toggleSection}>
                  <div className="space-y-1.5">
                    {sources.map((source) => source.sourceId && onNavigateToSource && !source.sourceId.startsWith('gcal_') ? (
                      <button key={`${source.sourceId}-${source.title}`} type="button" onClick={() => openSource(source.sourceId as string)} className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left text-xs font-semibold text-cyan-200 hover:border-cyan-700"><FileText className="h-3.5 w-3.5 shrink-0" />{source.title}<ChevronRight className="ml-auto h-3.5 w-3.5" /></button>
                    ) : <div key={`${source.sourceId ?? source.title}-${source.excerpt}`} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300"><FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />{source.title}</div>)}
                  </div>
                </AccordionSection>
              )}
            </div>

            {target.nodeId && onViewDecisionMap && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  onClick={() => { onClose(); onViewDecisionMap(target.nodeId as string); }}
                  icon={<Map className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  View in Decision Map
                </Button>
              </div>
            )}

            <section>
              <label htmlFor="question-answer" className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Your answer</label>
              <textarea
                id="question-answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                rows={4}
                autoFocus
                placeholder={target.intent === 'correct' ? 'Explain what should replace this assumption.' : 'Type your answer...'}
                className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-cyan-600"
              />
            </section>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {onDontKnow && <Button variant="ghost" onClick={onDontKnow} icon={<HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />}>I don&apos;t know yet</Button>}
            </div>

            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

            <div className="flex justify-end border-t border-slate-800 pt-4">
              <Button type="submit" variant="primary" loading={isSaving} disabled={!answer.trim()}>
                Save answer
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
