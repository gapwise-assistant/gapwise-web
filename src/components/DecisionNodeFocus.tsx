'use client';

import React from 'react';
import { ArrowDown, ArrowRight, ChevronRight, GitBranch, ShieldAlert } from 'lucide-react';
import type { ClarityNode } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import type { DecisionNodeFocus } from '@/lib/graph/decisionFocus';

interface DecisionNodeFocusProps {
  focus: DecisionNodeFocus;
  focusAssessment: FocusAssessment | null;
  onBack: () => void;
  onInspectNode: (node: ClarityNode) => void;
  onReviewDecision?: (node: ClarityNode) => void;
  onResolveQuestion?: (node: ClarityNode) => void;
}

const TYPE_LABELS: Record<ClarityNode['type'], string> = {
  GOAL: 'Goal',
  KNOWN: 'Known',
  CONSTRAINT: 'Constraint',
  ASSUMPTION: 'Assumption',
  DECISION: 'Decision',
  UNKNOWN: 'Unknown',
  EVIDENCE: 'Evidence',
  EXPERIMENT: 'Experiment',
  RISK: 'Risk',
  NEXT_ACTION: 'Next action',
  PREFERENCE: 'Preference',
};

const TYPE_STYLES: Record<ClarityNode['type'], string> = {
  GOAL: 'border-emerald-700/80 bg-emerald-950/40 text-emerald-200',
  KNOWN: 'border-slate-700 bg-slate-950 text-slate-200',
  CONSTRAINT: 'border-blue-700/80 bg-blue-950/40 text-blue-200',
  ASSUMPTION: 'border-amber-700/80 bg-amber-950/40 text-amber-200',
  DECISION: 'border-indigo-600/90 bg-indigo-950/60 text-indigo-100',
  UNKNOWN: 'border-rose-700/80 bg-rose-950/40 text-rose-200',
  EVIDENCE: 'border-teal-700/80 bg-teal-950/40 text-teal-200',
  EXPERIMENT: 'border-purple-700/80 bg-purple-950/40 text-purple-200',
  RISK: 'border-orange-700/80 bg-orange-950/40 text-orange-200',
  NEXT_ACTION: 'border-cyan-700/80 bg-cyan-950/40 text-cyan-200',
  PREFERENCE: 'border-fuchsia-700/80 bg-fuchsia-950/40 text-fuchsia-200',
};

function NodeRow({ node, onClick }: { node: ClarityNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition hover:border-cyan-500/70 hover:bg-slate-800/70 focus:outline-none focus:ring-2 focus:ring-cyan-400/70 ${TYPE_STYLES[node.type]}`}
    >
      <span className="mt-0.5 shrink-0 text-[9px] font-extrabold uppercase tracking-[0.14em] opacity-75">{TYPE_LABELS[node.type]}</span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-slate-100">{node.text}</span>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition group-hover:text-cyan-300" aria-hidden="true" />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-labelledby={`decision-focus-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <h3 id={`decision-focus-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function SupportingInputs({
  nodes,
  subject,
  onInspect,
}: {
  nodes: ClarityNode[];
  subject: string;
  onInspect: (node: ClarityNode) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const canCollapse = nodes.length > 3;

  React.useEffect(() => {
    setExpanded(false);
  }, [nodes]);

  if (!canCollapse) {
    return (
      <div className="space-y-2">
        {nodes.map((node) => <NodeRow key={node.id} node={node} onClick={() => onInspect(node)} />)}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="text-sm font-semibold text-slate-300">{nodes.length} things inform this {subject}</span>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-bold text-cyan-300 hover:border-cyan-600 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-slate-800 p-2">
          {nodes.map((node) => <NodeRow key={node.id} node={node} onClick={() => onInspect(node)} />)}
        </div>
      )}
    </div>
  );
}

export function DecisionNodeFocus({
  focus,
  focusAssessment,
  onBack,
  onInspectNode,
  onReviewDecision,
  onResolveQuestion,
}: DecisionNodeFocusProps) {
  const isCurrentFocus = focusAssessment?.actionNodeId === focus.node.id;
  const canDecide = focus.node.type === 'DECISION' && focus.node.status === 'OPEN' && onReviewDecision;
  const canResolve = ['UNKNOWN', 'ASSUMPTION'].includes(focus.node.type) && focus.node.status === 'OPEN' && onResolveQuestion;
  const goal = focus.goalPath[focus.goalPath.length - 1];
  const visibleInputs = [...focus.inputs, ...focus.prerequisites.filter((node) => !focus.inputs.some((input) => input.id === node.id))];
  const inputSubject = focus.node.type === 'DECISION'
    ? 'decision'
    : ['UNKNOWN', 'ASSUMPTION'].includes(focus.node.type)
      ? 'question'
      : 'this item';

  return (
    <div className="space-y-4 rounded-xl border border-cyan-950/80 bg-[#040b17] p-4 sm:p-6" aria-label="Decision Focus">
      <nav className="flex items-center gap-1 text-xs" aria-label="Decision Map breadcrumb">
        <button type="button" onClick={onBack} className="font-semibold text-cyan-300 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/70">Project story</button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
        <span className="truncate text-slate-400">{focus.node.text}</span>
      </nav>

      <div className="space-y-3">
        <Section title="What informs this">
          {visibleInputs.length > 0 ? (
            <SupportingInputs nodes={visibleInputs} subject={inputSubject} onInspect={onInspectNode} />
          ) : (
            <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-500">No directly connected context is recorded yet.</p>
          )}
        </Section>

        <div className="flex justify-center text-slate-600" aria-hidden="true"><ArrowDown className="h-5 w-5" /></div>

        <section className={`rounded-2xl border p-4 shadow-lg ${TYPE_STYLES[focus.node.type]}`} aria-labelledby="decision-focus-node-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] opacity-75">CURRENT FOCUS · {TYPE_LABELS[focus.node.type]}</p>
              {isCurrentFocus && <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-200">★ Current focus</p>}
              <h2 id="decision-focus-node-title" className="mt-2 text-lg font-extrabold leading-relaxed text-slate-50">{focus.node.text}</h2>
            </div>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-300">{focus.node.status === 'RESOLVED' ? 'Resolved' : 'Open'}</span>
          </div>

          {focus.risks.length > 0 && (
            <div className="mt-4 space-y-2" aria-label="Open risks">
              {focus.risks.map((risk) => (
                <button key={risk.id} type="button" onClick={() => onInspectNode(risk)} className="flex w-full items-start gap-2 rounded-lg border border-orange-800/70 bg-orange-950/40 p-2 text-left text-xs leading-relaxed text-orange-100 hover:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-400/70">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" aria-hidden="true" />
                  <span>{risk.text}</span>
                </button>
              ))}
            </div>
          )}

          {(canDecide || canResolve) && (
            <div className="mt-4">
              {canDecide && <button type="button" onClick={() => onReviewDecision?.(focus.node)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-indigo-500/90 bg-indigo-500 px-4 py-2 text-xs font-extrabold text-white hover:bg-indigo-400">Decide <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}
              {canResolve && <button type="button" onClick={() => onResolveQuestion?.(focus.node)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-500/90 bg-rose-500 px-4 py-2 text-xs font-extrabold text-white hover:bg-rose-400">Resolve <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}
            </div>
          )}
        </section>

        <div className="flex justify-center text-slate-600" aria-hidden="true"><ArrowDown className="h-5 w-5" /></div>

        {focus.nextActions.length > 0 && (
          <Section title="How to move this forward">
            <div className="space-y-2">
              {focus.nextActions.map((node) => <NodeRow key={node.id} node={node} onClick={() => onInspectNode(node)} />)}
            </div>
          </Section>
        )}

        {focus.nextActions.length > 0 && <div className="flex justify-center text-slate-600" aria-hidden="true"><ArrowDown className="h-5 w-5" /></div>}

        <Section title="What this unlocks">
          {focus.downstream.length > 0 ? (
            <div className="space-y-2">
              {focus.downstream.map((node) => <NodeRow key={node.id} node={node} onClick={() => onInspectNode(node)} />)}
            </div>
          ) : (
            <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-500">No downstream dependency is recorded yet.</p>
          )}
        </Section>

        {goal && (
          <Section title="Toward the goal">
            <div className="rounded-xl border border-emerald-800/70 bg-emerald-950/30 p-3">
              <div className="flex items-start gap-3">
                <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <button type="button" onClick={() => onInspectNode(goal)} className="text-left text-sm leading-relaxed text-emerald-100 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/70">{goal.text}</button>
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
