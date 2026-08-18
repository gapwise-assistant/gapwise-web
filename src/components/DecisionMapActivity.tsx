'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { authFetch } from '@/lib/auth/client';
import type { TraceAgentConfig, TraceEvent } from '@/types/observability';

interface DecisionMapActivityProps {
  userId: string;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isDecisionMapTrace(trace: TraceEvent): boolean {
  return trace.simulation === true
    || trace.route === '/api/agents/turn'
    || trace.route === '/api/context/ingest';
}

export const DecisionMapActivity: React.FC<DecisionMapActivityProps> = ({ userId }) => {
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [agentPolicy, setAgentPolicy] = useState<TraceAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setTraces([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await authFetch(`/api/dev/traces?userId=${encodeURIComponent(userId)}`);
      if (!response.ok) {
        setTraces([]);
        setAgentPolicy([]);
        return;
      }
      const data = await response.json() as { traces?: TraceEvent[]; agentPolicy?: TraceAgentConfig[] };
      setTraces((data.traces ?? []).filter(isDecisionMapTrace).slice(0, 6));
      setAgentPolicy(data.agentPolicy ?? []);
    } catch {
      // The map remains usable when the optional developer trace endpoint is unavailable.
      setTraces([]);
      setAgentPolicy([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="border-b border-slate-800 bg-slate-950/70 px-4 py-3 sm:px-5" aria-labelledby="decision-map-activity-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <h3 id="decision-map-activity-title" className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-300">
            Decision Map activity
          </h3>
          <span className="text-[10px] text-slate-600">sanitized routing log</span>
        </div>
        <div className="flex items-center gap-1.5">
          {open && (
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-cyan-800 hover:text-cyan-200 disabled:opacity-50"
              title="Refresh Decision Map activity"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-cyan-800 hover:text-cyan-200"
          >
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {open && <>
        <p className="mt-1 text-[11px] text-slate-500">
          Shows which agent configuration was used (or would be used) and how much project context was selected. Prompts and private content are never shown.
        </p>
        {traces.some((trace) => trace.simulation) && (
          <p className="mt-2 rounded-md border border-amber-900/60 bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-200/80">
            This is a deterministic simulation of initial context processing. No Gemini or ADK call ran; the steps show the agent route that would process an uploaded or changed context source.
          </p>
        )}

        {loading ? (
        <div className="mt-3 h-12 animate-pulse rounded-lg bg-slate-900/80" aria-label="Loading Decision Map activity" />
        ) : traces.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-3 py-2 text-[11px] text-slate-500">
          <p>No map activity in this running session yet. Run a graph turn or ingest project context, then refresh this section.</p>
          {agentPolicy.length > 0 && (
            <div className="mt-2 border-t border-slate-800 pt-2">
              <p className="font-semibold uppercase tracking-[0.12em] text-slate-500">Configured routing (no call yet)</p>
              <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {agentPolicy.map((config) => (
                  <p key={config.agentName} className="text-slate-400">
                    <span className="text-slate-300">{config.agentName}</span>
                    {' · '}{config.model} · {config.thinkingLevel} thinking · {config.maxOutputTokens.toLocaleString()} tokens
                    {' · '}{config.execution === 'would_use' ? 'would use' : 'not used locally'}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
        ) : (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {traces.map((trace) => (
            <article key={trace.id} className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2.5 text-[11px]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-200">{trace.label}</p>
                  <p className="mt-0.5 text-slate-600">{formatTimestamp(trace.started_at)} · {trace.duration_ms}ms</p>
                </div>
                <span className={trace.error ? 'text-rose-300' : trace.simulation ? 'text-amber-300' : 'text-emerald-300'}>{trace.error ? 'failed' : trace.simulation ? 'simulation' : 'recorded'}</span>
              </div>

              {trace.agentConfigs && trace.agentConfigs.length > 0 && (
                <div className="mt-2 border-t border-slate-800 pt-2">
                  <p className="font-semibold uppercase tracking-[0.12em] text-slate-500">AI routing</p>
                  <div className="mt-1 space-y-1 text-slate-400">
                    {trace.agentConfigs.map((config) => (
                      <p key={config.agentName}>
                        <span className="text-slate-300">{config.agentName}</span>
                        {' · '}{config.model}
                        {' · '}{config.thinkingLevel} thinking
                        {' · '}{config.maxOutputTokens.toLocaleString()} output tokens
                        {' · '}{config.execution === 'would_use' ? 'would use' : config.execution}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {trace.agentRuns && trace.agentRuns.length > 0 && (
                <details className="mt-2 border-t border-slate-800 pt-2" open>
                  <summary className="cursor-pointer font-semibold uppercase tracking-[0.12em] text-slate-500">Agent run metrics</summary>
                  <div className="mt-2 space-y-2">
                    {trace.agentRuns.map((run) => (
                      <div key={run.runId} className="rounded-md border border-slate-800 bg-slate-950/60 p-2 text-slate-500">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <span className="font-semibold text-slate-300">{run.agent}</span>
                          <span className={run.execution === 'would_use' ? 'text-amber-300' : run.execution === 'used' ? 'text-emerald-300' : 'text-slate-400'}>{run.execution}</span>
                        </div>
                        <p className="mt-1">{run.model} · {run.thinkingLevel} thinking · {run.latencyMs}ms · {run.inputTokens} in / {run.outputTokens} out · {run.estimatedCost === null ? 'cost unavailable' : `$${run.estimatedCost.toFixed(4)} est. cost`}{run.costSource ? ` (${run.costSource.replaceAll('_', ' ')})` : ''}</p>
                        <p className="mt-1">Validation: {run.validationStatus} · Confidence: {run.confidence === null ? 'n/a' : run.confidence.toFixed(3)} · Escalated: {run.escalated ? 'yes' : 'no'}</p>
                        {run.escalationReason && <p className="mt-1 text-slate-600">Escalation: {run.escalationReason}</p>}
                        <p className="mt-1 text-slate-600">Input: {run.inputSummary} · Output: {run.outputSummary}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {trace.gapAnalysis && (
                <details className="mt-2 border-t border-slate-800 pt-2" open>
                  <summary className="cursor-pointer font-semibold uppercase tracking-[0.12em] text-slate-500">Gap Agent detail</summary>
                  <div className="mt-2 space-y-1 text-slate-500">
                    <p className="font-semibold text-slate-400">Candidate gaps</p>
                    {trace.gapAnalysis.candidates.length > 0 ? trace.gapAnalysis.candidates.map((candidate) => (
                      <p key={candidate.id}>#{candidate.rank} {candidate.id} · priority {candidate.priority.toFixed(3)} · confidence {candidate.confidence.toFixed(3)} · {candidate.summary}</p>
                    )) : <p>No candidate gaps.</p>}
                    <p className="mt-1 text-slate-400">Selected gap: <span className="text-cyan-200">{trace.gapAnalysis.selectedGapId ?? 'none'}</span></p>
                    <p>Reason: {trace.gapAnalysis.selectionReason}</p>
                    <p>Confidence: {trace.gapAnalysis.confidence === null ? 'n/a' : trace.gapAnalysis.confidence.toFixed(3)} · Evidence IDs: {trace.gapAnalysis.evidenceIds.join(', ') || 'none'}</p>
                    <p>Escalated: {trace.gapAnalysis.escalated ? 'yes' : 'no'}{trace.gapAnalysis.escalationReason ? ` · ${trace.gapAnalysis.escalationReason}` : ''}</p>
                    {trace.gapAnalysis.escalationModel && <p>Escalation candidate: {trace.gapAnalysis.escalationModel} · {trace.gapAnalysis.escalationThinkingLevel} thinking · {trace.gapAnalysis.escalationMaxOutputTokens?.toLocaleString()} tokens</p>}
                  </div>
                </details>
              )}

              {trace.gapComparison && (
                <details className="mt-2 border-t border-slate-800 pt-2" open>
                  <summary className="cursor-pointer font-semibold uppercase tracking-[0.12em] text-slate-500">Runtime comparison</summary>
                  <div className="mt-2 space-y-1 text-slate-500">
                    <p>Mode: <span className="text-slate-300">{trace.gapComparison.mode}</span> · Validation: {trace.gapComparison.validationStatus}</p>
                    <p>Deterministic: {trace.gapComparison.deterministicGapId ?? 'none'} · Agent: {trace.gapComparison.agentGapId ?? 'none'}</p>
                    <p>Effective: <span className="text-cyan-200">{trace.gapComparison.effectiveGapId ?? 'none'}</span> · Agreement: {trace.gapComparison.agreement === null ? 'n/a' : trace.gapComparison.agreement ? 'yes' : 'no'} · Fallback: {trace.gapComparison.fallbackUsed ? 'yes' : 'no'}</p>
                    {trace.gapComparison.failureReason && <p>Safe failure reason: {trace.gapComparison.failureReason.replaceAll('_', ' ')}</p>}
                  </div>
                </details>
              )}

              {trace.handoffs && trace.handoffs.length > 0 && (
                <details className="mt-2 border-t border-slate-800 pt-2">
                  <summary className="cursor-pointer font-semibold uppercase tracking-[0.12em] text-slate-500">Handoffs</summary>
                  <div className="mt-2 space-y-1 text-slate-500">
                    {trace.handoffs.map((handoff) => (
                      <p key={handoff.id}><span className="text-slate-300">{handoff.from} → {handoff.to}</span> · {handoff.inputCount} in / {handoff.outputCount} out · {handoff.selectedIds.length} selected IDs · {handoff.summary}</p>
                    ))}
                  </div>
                </details>
              )}

              {trace.contextSummary && (
                <p className="mt-2 border-t border-slate-800 pt-2 text-slate-500">
                  Context: {trace.contextSummary.includedContextCount} selected · {trace.contextSummary.goalCount} goals · {trace.contextSummary.unresolvedGapCount} open gaps · {trace.contextSummary.evidenceCount} evidence · {trace.contextSummary.preferenceCount} preferences · {trace.contextSummary.decisionCount} decisions
                  {trace.contextSummary.scope ? ` · ${trace.contextSummary.scope}` : ''}
                </p>
              )}
              {trace.contextIds.length > 0 && (
                <p className="mt-1 truncate text-slate-600" title={trace.contextIds.join(', ')}>
                  Context IDs: {trace.contextIds.slice(0, 6).join(', ')}{trace.contextIds.length > 6 ? '…' : ''}
                </p>
              )}
              {trace.pipelineSteps && trace.pipelineSteps.length > 0 && (
                <details className="mt-2 border-t border-slate-800 pt-2" open>
                  <summary className="cursor-pointer font-semibold uppercase tracking-[0.12em] text-slate-500">How this map was built</summary>
                  <ol className="mt-2 space-y-1.5 border-l border-slate-700 pl-3">
                    {trace.pipelineSteps.map((step, index) => (
                      <li key={`${trace.id}-${step.name}`} className="relative text-slate-400">
                        <span className="absolute -left-[1.05rem] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-[8px] text-cyan-300">{index + 1}</span>
                        <span className="text-slate-300">{step.name}</span>
                        {' · '}{step.execution === 'would_use' ? 'would use' : step.execution === 'not_used' ? 'not used' : step.execution}
                        <span className="block text-slate-600">{step.summary}{typeof step.contextCount === 'number' ? ` · ${step.contextCount} context items` : ''}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          ))}
        </div>
        )}
      </>}
    </section>
  );
};
