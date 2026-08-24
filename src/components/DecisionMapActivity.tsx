'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Check, ChevronDown, ChevronUp, Copy, RefreshCw } from 'lucide-react';
import { authFetch } from '@/lib/auth/client';
import type { Project } from '@/types/clarity';
import type { TraceAgentConfig, TraceEvent } from '@/types/observability';
import { summarizeDecisionMapActivity } from '@/lib/graph/decisionMapActivity';

interface DecisionMapActivityProps {
  userId: string;
  project: Project;
  traceRefreshKey?: number;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function sourceActivityDate(source: Project['sources'][number]): string {
  return source.processing_log?.completed_at ?? source.processed_at ?? source.extracted_at;
}

function sourceActivityStatus(source: Project['sources'][number]): string {
  return source.processing_log?.status ?? source.processing_status ?? 'recorded';
}

function CopyValue({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(JSON.stringify(value, null, 2)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-cyan-700 hover:text-cyan-200"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function JsonDetails({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</summary>
      <div className="mt-2 flex justify-end border-t border-slate-800 pt-2"><CopyValue value={value} /></div>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-600">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function ContextProcessingDetails({ project }: { project: Project }) {
  const sources = project.sources
    .filter((source) => source.processing_log || source.processing_status || source.processed_at)
    .slice()
    .sort((left, right) => Date.parse(sourceActivityDate(right)) - Date.parse(sourceActivityDate(left)))
    .slice(0, 8);
  if (sources.length === 0) return <p className="text-[11px] text-slate-600">No saved context-processing logs for this project.</p>;
  return (
    <div className="space-y-2">
      {sources.map((source) => {
        const log = source.processing_log;
        return (
          <details key={source.id} className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="truncate">{source.filename}</span>
              <span className="shrink-0 text-slate-600">{formatDate(sourceActivityDate(source))} · {sourceActivityStatus(source)}</span>
            </summary>
            {log ? (
              <div className="mt-2 space-y-1.5 border-t border-slate-800 pt-2">
                <p className="text-slate-500">{log.duration_ms}ms · {source.derived_node_ids.length} graph nodes · {log.stages.length} stages</p>
                {log.stages.map((stage, index) => (
                  <JsonDetails key={`${source.id}-${stage.name}-${index}`} title={`${stage.name} · ${stage.status} · ${stage.duration_ms}ms`} value={{ input: stage.input, output: stage.output, error: stage.error }} />
                ))}
                {log.error && <p className="text-rose-300">{log.error}</p>}
                <JsonDetails title="Full local processing log" value={log} />
              </div>
            ) : <p className="mt-2 border-t border-slate-800 pt-2 text-slate-600">Only processing metadata was saved; no detailed localhost log is available.</p>}
          </details>
        );
      })}
    </div>
  );
}

function GraphDetails({ trace }: { trace: TraceEvent }) {
  const debug = trace.decisionMapDebug;
  const [showIds, setShowIds] = useState(false);
  if (!debug) return null;
  const visibleIds = new Set(debug.filterVisibilityTrace.find((item) => item.filter === 'story')?.visibleNodeIds ?? []);
  const visibleNodes = debug.rawProjectGraph.nodes.filter((node) => visibleIds.has(node.id));
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-300">Graph</summary>
      <div className="mt-3 space-y-2 text-[11px] text-slate-500">
        <p><span className="text-slate-300">Project graph:</span> {debug.rawProjectGraph.totalNodes} nodes · {debug.rawProjectGraph.totalEdges} relationships</p>
        <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
          <p className="mb-1 font-semibold text-slate-400">Visible story nodes</p>
          {visibleNodes.length > 0 ? visibleNodes.map((node) => (
            <p key={node.id} className="leading-relaxed"><span className="text-slate-300">{node.type}</span> · {node.text}{showIds ? ` · ${node.id}` : ''}</p>
          )) : <p>No visible story nodes.</p>}
        </div>
        <button type="button" onClick={() => setShowIds((current) => !current)} className="text-[10px] font-semibold text-cyan-300 hover:text-cyan-200">{showIds ? 'Hide IDs' : 'Show IDs'}</button>
        <JsonDetails title="Focus analysis" value={debug.currentFocusAnalysis} />
        <JsonDetails title="Story projection" value={debug.storyBackboneCandidates} />
        <JsonDetails title="Collapse groups" value={debug.collapseExpansionAnalysis} />
        <JsonDetails title="Why this matters" value={debug.whyThisMattersDebug} />
        <JsonDetails title="Visibility and filters" value={debug.filterVisibilityTrace} />
      </div>
    </details>
  );
}

function AgentDetails({ trace, project, relatedTraces }: { trace: TraceEvent; project: Project; relatedTraces: TraceEvent[] }) {
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-300">Agent activity</summary>
      <div className="mt-3 space-y-2 text-[11px] text-slate-500">
        {trace.simulation && <p className="rounded-md border border-amber-900/60 bg-amber-950/20 px-2 py-1.5 text-amber-200/80">Simulation only · no model calls executed</p>}
        {trace.agentConfigs && trace.agentConfigs.length > 0 && (
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
            <p className="font-semibold text-slate-400">Configured agents</p>
            {trace.agentConfigs.map((config: TraceAgentConfig) => <p key={config.agentName}>{config.agentName} · {config.model} · {config.thinkingLevel} thinking · {config.maxOutputTokens.toLocaleString()} tokens · {config.execution}</p>)}
          </div>
        )}
        {trace.agentRuns && trace.agentRuns.length > 0 && <JsonDetails title="Model runs · latency, tokens, cost, validation" value={trace.agentRuns} />}
        {trace.gapAnalysis && <JsonDetails title="Gap Agent" value={trace.gapAnalysis} />}
        {trace.gapComparison && <JsonDetails title="Routing comparison" value={trace.gapComparison} />}
        {trace.handoffs && <JsonDetails title="Handoffs" value={trace.handoffs} />}
        {trace.contextSummary && <JsonDetails title="Context used" value={trace.contextSummary} />}
        {trace.pipelineSteps && <JsonDetails title="Pipeline steps" value={trace.pipelineSteps} />}
        {relatedTraces.length > 0 && <JsonDetails title="Related runtime traces" value={relatedTraces} />}
        <details className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Context processing</summary>
          <div className="mt-2"><ContextProcessingDetails project={project} /></div>
        </details>
      </div>
    </details>
  );
}

function RendererDetails({ trace }: { trace: TraceEvent }) {
  const debug = trace.decisionMapDebug;
  if (!debug) return null;
  const layout = debug.layoutDiagnostics;
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-300">Renderer</summary>
      <div className="mt-3 space-y-2 text-[11px] text-slate-500">
        <p className="text-slate-300">{layout.edgeCrossings.count ?? 0} crossings · {layout.edgesPassingThroughAnotherNode.count ?? 0} edge collisions · {layout.emptyLanesOrSections.length} empty sections</p>
        <p>Viewport {layout.viewport.width} × {layout.viewport.height} · zoom {layout.currentZoom.toFixed(2)} · {layout.overlappingNodes.count} overlapping node pairs</p>
        <JsonDetails title="Layout warnings and geometry" value={layout} />
        <JsonDetails title="Rendered readability summary" value={debug.renderedStoryReadabilitySummary} />
      </div>
    </details>
  );
}

function ActivityDetails({ trace, project, relatedTraces }: { trace: TraceEvent; project: Project; relatedTraces: TraceEvent[] }) {
  return (
    <details className="mt-3 border-t border-slate-800 pt-3">
      <summary className="cursor-pointer text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Details</summary>
      <div className="mt-2 grid gap-2">
        <GraphDetails trace={trace} />
        <AgentDetails trace={trace} project={project} relatedTraces={relatedTraces} />
        <RendererDetails trace={trace} />
        <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <summary className="cursor-pointer text-xs font-bold text-slate-300">Raw data</summary>
          <div className="mt-3 grid gap-2">
            <JsonDetails title="Raw trace JSON" value={trace} />
            {trace.decisionMapDebug && <JsonDetails title="Raw graph JSON" value={trace.decisionMapDebug.rawProjectGraph} />}
            {trace.decisionMapDebug && <JsonDetails title="Raw renderer JSON" value={trace.decisionMapDebug.layoutDiagnostics} />}
          </div>
        </details>
      </div>
    </details>
  );
}

export const DecisionMapActivity: React.FC<DecisionMapActivityProps> = ({ userId, project, traceRefreshKey = 0 }) => {
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [relatedTraces, setRelatedTraces] = useState<TraceEvent[]>([]);
  const [agentPolicy, setAgentPolicy] = useState<TraceAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setTraces([]);
      setRelatedTraces([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await authFetch(`/api/dev/traces?userId=${encodeURIComponent(userId)}`);
      if (!response.ok) {
        setTraces([]);
        setRelatedTraces([]);
        setAgentPolicy([]);
        return;
      }
      const data = await response.json() as { traces?: TraceEvent[]; agentPolicy?: TraceAgentConfig[] };
      setTraces((data.traces ?? [])
        .filter((trace) => trace.decisionMapActivity?.projectId === project.id)
        .slice(0, 6));
      setRelatedTraces((data.traces ?? []).filter((trace) => (
        trace.contextSummary?.scope === project.id
        || trace.decisionMapActivity?.projectId === project.id
      )));
      setAgentPolicy(data.agentPolicy ?? []);
    } catch {
      setTraces([]);
      setRelatedTraces([]);
      setAgentPolicy([]);
    } finally {
      setLoading(false);
    }
  }, [project.id, userId]);

  useEffect(() => {
    void load();
  }, [load, traceRefreshKey]);

  return (
    <section className="border-b border-slate-800 bg-slate-950/70 px-4 py-3 sm:px-5" aria-labelledby="decision-map-activity-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <h3 id="decision-map-activity-title" className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-300">Decision Map Activity · {traces.length}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {open && <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-cyan-800 hover:text-cyan-200 disabled:opacity-50" title="Refresh Decision Map activity"><RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />Refresh</button>}
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-cyan-800 hover:text-cyan-200">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}{open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {open && (
        loading ? <div className="mt-3 h-12 animate-pulse rounded-lg bg-slate-900/80" aria-label="Loading Decision Map activity" />
          : traces.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-3 py-2 text-[11px] text-slate-500">
              No semantic map activity is available yet. Add project context or wait for the map to finish building.
              {agentPolicy.length > 0 && <span className="ml-1 text-slate-600">Developer agent configuration remains available in the trace panel.</span>}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {traces.map((trace) => {
                const summary = summarizeDecisionMapActivity(trace);
                if (!summary) return null;
                return (
                  <article key={trace.id} className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-3 text-[11px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-200">{formatTime(trace.started_at)} · {summary.title}</p>
                        {summary.trigger && <p className="mt-1 truncate text-slate-400">{summary.type === 'map_built' ? 'Built from' : 'Source'} · {summary.trigger}</p>}
                        {summary.change && <p className="mt-1 text-slate-300">{summary.change}</p>}
                      </div>
                      {summary.warningCount ? <span className="shrink-0 text-amber-300">{summary.warningCount} warning{summary.warningCount === 1 ? '' : 's'}</span> : null}
                    </div>
                    {summary.focus && <p className="mt-2"><span className="font-semibold text-slate-400">Current focus</span><span className="mt-0.5 block text-slate-200">{summary.focus}</span></p>}
                    <p className="mt-2 text-slate-500">{summary.visibleNodes ?? 0} visible · {summary.collapsedNodes ?? 0} collapsed · {summary.relationships ?? 0} relationships</p>
                    <ActivityDetails trace={trace} project={project} relatedTraces={relatedTraces.filter((related) => related.id !== trace.id)} />
                  </article>
                );
              })}
            </div>
          )
      )}
    </section>
  );
};
