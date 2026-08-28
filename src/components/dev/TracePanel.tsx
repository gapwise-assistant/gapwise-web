'use client';

import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { TraceEvent } from '@/types/observability';
import { authFetch } from '@/lib/auth/client';
import type { DeveloperGenerationRun, DeveloperGenerationStep } from '@/lib/storage/types';

interface GenerationTimeline {
  run: DeveloperGenerationRun;
  steps: DeveloperGenerationStep[];
}

interface TracePanelProps {
  userId: string;
}

export const TracePanel: React.FC<TracePanelProps> = ({ userId }) => {
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [generationTimelines, setGenerationTimelines] = useState<GenerationTimeline[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const res = await authFetch(`/api/dev/traces?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    setTraces(data.traces ?? []);
    setGenerationTimelines(data.generationRuns ?? []);
  };

  useEffect(() => {
    load();
  }, [userId]);

  return (
    <section className="fixed bottom-3 right-3 z-40">
      {open && (
        <div className="mb-2 w-[min(92vw,440px)] max-h-[420px] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-100">Developer Trace</h2>
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:text-cyan-300"
              title="Refresh traces"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {generationTimelines.length > 0 && (
              <details className="rounded-xl border border-slate-800 bg-slate-900 p-3" open>
                <summary className="cursor-pointer text-xs font-bold text-slate-300">
                  Generation runs · {generationTimelines.length}
                </summary>
                <div className="mt-3 space-y-2 text-[11px] text-slate-500">
                  {generationTimelines.map(({ run, steps }) => (
                    <details key={run.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                      <summary className="cursor-pointer text-slate-300">
                        {run.generator} · {run.status} · {run.durationMs ?? 0}ms
                      </summary>
                      <div className="mt-2 space-y-1 border-t border-slate-800 pt-2">
                        <p>Run: {run.id}</p>
                        {run.currentStep && <p>Current step: {run.currentStep}</p>}
                        {run.error && <p className="text-rose-300">{run.error}</p>}
                        {steps.map((step) => (
                          <p key={step.id}>
                            {step.sequence}. {step.name} · {step.status}
                            {step.durationMs !== undefined ? ` · ${step.durationMs}ms` : ''}
                            {step.summary ? ` · ${step.summary}` : ''}
                          </p>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            )}
            {traces.length === 0 ? (
              <p className="text-xs text-slate-500">No traces recorded yet.</p>
            ) : (
              traces.slice(0, 8).map((trace) => (
                <div key={trace.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold text-slate-200">{trace.label}</span>
                    <span className="text-cyan-300">{trace.duration_ms}ms</span>
                  </div>
                  <p className="mt-1 text-slate-500">{trace.route}</p>
                  {trace.model && <p className="mt-1 text-cyan-200">Model: {trace.model}</p>}
                  {trace.agentConfigs && trace.agentConfigs.length > 0 && (
                    <div className="mt-2 border-t border-slate-800 pt-2 text-slate-500">
                      <p className="font-semibold text-slate-400">AI routing</p>
                      <ul className="mt-1 space-y-1">
                        {trace.agentConfigs.map((config) => (
                          <li key={config.agentName}>
                            {config.agentName}: <span className="text-cyan-200">{config.model}</span>
                            {' · '}{config.thinkingLevel} thinking · {config.maxOutputTokens.toLocaleString()} tokens
                            {' · '}{config.execution === 'would_use' ? 'would use' : config.execution}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {trace.agentRuns && trace.agentRuns.length > 0 && (
                    <div className="mt-2 border-t border-slate-800 pt-2 text-slate-500">
                      <p className="font-semibold text-slate-400">Run metrics</p>
                      {trace.agentRuns.map((run) => (
                        <p key={run.runId} className="mt-1">
                          {run.agent}: {run.execution} · {run.latencyMs}ms · {run.inputTokens} in / {run.outputTokens} out · validation {run.validationStatus} · confidence {run.confidence === null ? 'n/a' : run.confidence.toFixed(3)} · escalated {run.escalated ? 'yes' : 'no'}
                        </p>
                      ))}
                    </div>
                  )}
                  {trace.gapAnalysis && (
                    <p className="mt-2 border-t border-slate-800 pt-2 text-slate-500">
                      Gap candidates: {trace.gapAnalysis.candidates.map((candidate) => `${candidate.rank}:${candidate.id}`).join(', ') || 'none'} · selected {trace.gapAnalysis.selectedGapId ?? 'none'} · confidence {trace.gapAnalysis.confidence === null ? 'n/a' : trace.gapAnalysis.confidence.toFixed(3)} · escalated {trace.gapAnalysis.escalated ? 'yes' : 'no'}
                    </p>
                  )}
                  {trace.handoffs && trace.handoffs.length > 0 && (
                    <p className="mt-2 border-t border-slate-800 pt-2 text-slate-500">
                      Handoffs: {trace.handoffs.map((handoff) => `${handoff.from}→${handoff.to} (${handoff.inputCount}/${handoff.outputCount})`).join(' · ')}
                    </p>
                  )}
                  {trace.contextSummary && (
                    <p className="mt-2 text-slate-500">
                      Context: {trace.contextSummary.includedContextCount} selected IDs · {trace.contextSummary.goalCount} goals · {trace.contextSummary.unresolvedGapCount} open gaps · {trace.contextSummary.evidenceCount} evidence · {trace.contextSummary.preferenceCount} preferences · {trace.contextSummary.decisionCount} decisions · {trace.contextSummary.commitmentCount} commitments
                    </p>
                  )}
                  <p className="mt-2 text-slate-400">
                    Agents: {trace.agentNames.join(', ') || 'none'}
                  </p>
                  <p className="text-slate-500">
                    Context IDs ({trace.contextIds.length}): {trace.contextIds.slice(0, 8).join(', ') || 'none'}{trace.contextIds.length > 8 ? '…' : ''}
                  </p>
                  {trace.decisionMapDebug && (
                    <details className="mt-2 border-t border-slate-800 pt-2">
                      <summary className="cursor-pointer text-xs font-bold text-slate-300">Decision Map diagnostics</summary>
                      <div className="mt-2 space-y-1 text-[11px] text-slate-500">
                        {trace.decisionMapActivity && (
                          <p>
                            {trace.decisionMapActivity.type} · {trace.decisionMapActivity.change ?? 'No semantic change recorded'}
                            {trace.decisionMapActivity.focus ? ` · Focus: ${trace.decisionMapActivity.focus}` : ''}
                          </p>
                        )}
                        <p>
                          Graph: {trace.decisionMapDebug.rawProjectGraph.totalNodes} nodes · {trace.decisionMapDebug.rawProjectGraph.totalEdges} relationships · {trace.decisionMapDebug.renderedMapReadabilitySummary.visibleNodes} visible
                        </p>
                        {trace.decisionMapActivity && trace.decisionMapActivity.warningCodes.length > 0 && (
                          <p>Warnings: {trace.decisionMapActivity.warningCodes.join(', ')}</p>
                        )}
                        <details className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
                          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Raw Decision Map trace</summary>
                          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-600">{JSON.stringify(trace.decisionMapDebug, null, 2)}</pre>
                        </details>
                      </div>
                    </details>
                  )}
                  {trace.scores.length > 0 && (
                    <p className="text-slate-500">Scores: {trace.scores.map((score) => `${score.id}:${score.score}`).join(', ')}</p>
                  )}
                  {trace.error && <p className="mt-1 text-rose-300">{trace.error}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-full border border-cyan-800 bg-cyan-950 p-3 text-cyan-200 shadow-xl hover:bg-cyan-900"
        title="Open developer trace panel"
      >
        <Activity className="w-5 h-5" />
      </button>
    </section>
  );
};
