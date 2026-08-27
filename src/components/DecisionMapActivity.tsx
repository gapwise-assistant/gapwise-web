'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Check, ChevronDown, ChevronUp, Copy, RefreshCw } from 'lucide-react';
import { authFetch } from '@/lib/auth/client';
import type { Project } from '@/types/clarity';
import type { TraceAgentConfig, TraceEvent } from '@/types/observability';
import type { DeveloperGenerationRun, DeveloperGenerationStep } from '@/lib/storage/types';
import { summarizeDecisionMapActivity } from '@/lib/graph/decisionMapActivity';
import { formatDateTime } from '@/lib/datetime/displayDateTime';

interface DecisionMapActivityProps {
  userId: string;
  project: Project;
  traceRefreshKey?: number;
}

function formatTime(value: string): string {
  return formatDateTime(value);
}

function formatDate(value: string): string {
  return formatDateTime(value);
}

function sourceActivityDate(source: Project['sources'][number]): string {
  return source.processing_log?.completed_at ?? source.processed_at ?? source.extracted_at;
}

function sourceActivityStatus(source: Project['sources'][number]): string {
  return source.processing_log?.status ?? source.processing_status ?? 'recorded';
}

interface GenerationTimeline {
  run: DeveloperGenerationRun;
  steps: DeveloperGenerationStep[];
}

function generationStatusIcon(status: DeveloperGenerationRun['status'] | DeveloperGenerationStep['status']) {
  if (status === 'completed') return <Check className="h-3.5 w-3.5 text-emerald-400" aria-label="Completed" />;
  if (status === 'failed') return <span className="text-rose-400" aria-label="Failed">✕</span>;
  if (status === 'running') return <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" aria-label="Running" />;
  return <span className="text-slate-600" aria-label="Skipped">—</span>;
}

function formatGenerationDuration(durationMs?: number): string {
  if (durationMs === undefined) return '—';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function GenerationDetails({ timeline }: { timeline: GenerationTimeline }) {
  const { run, steps } = timeline;
  return (
    <section className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3" aria-labelledby="fresh-generation-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 id="fresh-generation-title" className="text-xs font-bold text-slate-200">Fresh project generation</h4>
          <p className="mt-1 text-[10px] text-slate-500">{run.generator} · {formatDateTime(run.startedAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold text-slate-400">
          {generationStatusIcon(run.status)}
          <span>{run.status}</span>
        </div>
      </div>
      {run.status === 'running' && <p className="mt-2 animate-pulse text-[10px] text-cyan-300">Generation in progress…</p>}
      {run.status === 'failed' && run.error && <p className="mt-2 rounded-md border border-rose-900/60 bg-rose-950/20 px-2 py-1.5 text-[10px] text-rose-200">{run.error}</p>}
      <div className="mt-3 space-y-1.5">
        {steps.map((step) => (
          <details key={step.id} className="rounded-md border border-slate-800/80 bg-slate-950/40 px-2 py-1.5">
            <summary className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{generationStatusIcon(step.status)}</span>
              <span className="min-w-0 flex-1 truncate">{step.name}</span>
              <span className="shrink-0 text-[10px] text-slate-600">{formatGenerationDuration(step.durationMs)}</span>
            </summary>
            <div className="mt-2 space-y-1 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
              <p>Step {step.sequence} · {step.category} · {step.status}</p>
              <p>Started {formatDateTime(step.startedAt)}{step.completedAt ? ` · completed ${formatDateTime(step.completedAt)}` : ''}</p>
              {step.sourceId && <p>Source: {step.sourceId}{step.filename ? ` · ${step.filename}` : ''}</p>}
              {step.reloadedProjectId && <p>Reloaded project: {step.reloadedProjectId}</p>}
              {step.chatId && <p>Chat: {step.chatId}</p>}
              {step.messageId && <p>Message: {step.messageId}</p>}
              {step.proposalId && <p>Proposal: {step.proposalId}</p>}
              {step.historyEventId && <p>History event: {step.historyEventId}</p>}
              {step.snapshotId && <p>Snapshot: {step.snapshotId}</p>}
              {(step.nodeCountBefore !== undefined || step.nodeCountAfter !== undefined) && <p>Nodes: {step.nodeCountBefore ?? '—'} → {step.nodeCountAfter ?? '—'}</p>}
              {(step.edgeCountBefore !== undefined || step.edgeCountAfter !== undefined) && <p>Edges: {step.edgeCountBefore ?? '—'} → {step.edgeCountAfter ?? '—'}</p>}
              {step.derivedNodeIds && step.derivedNodeIds.length > 0 && <p>Derived nodes: {step.derivedNodeIds.join(', ')}</p>}
              {step.summary && <p className="text-slate-400">{step.summary}</p>}
              {step.error && <p className="text-rose-300">{step.error}</p>}
            </div>
          </details>
        ))}
      </div>
      <details className="mt-2 border-t border-slate-800 pt-2">
        <summary className="cursor-pointer text-[10px] font-semibold text-slate-600">Advanced generation details</summary>
        <div className="mt-2 space-y-1 text-[10px] text-slate-600">
          <p>Run ID: {run.id}</p>
          <p>Project ID: {run.projectId}</p>
          <p>Total duration: {formatGenerationDuration(run.durationMs)}</p>
          {run.currentStep && <p>Current step: {run.currentStep}</p>}
        </div>
      </details>
    </section>
  );
}

export function sourceActivityRenderKey(
  source: Pick<Project['sources'][number], 'id' | 'filename' | 'extracted_at'>,
  occurrence: number,
): string {
  return `${source.id}:${source.filename}:${source.extracted_at}:${occurrence}`;
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

export function ContextProcessingDetails({ project }: { project: Project }) {
  const sources = project.sources
    .filter((source) => source.processing_log || source.processing_status || source.processed_at)
    .slice()
    .sort((left, right) => Date.parse(sourceActivityDate(right)) - Date.parse(sourceActivityDate(left)))
    .slice(0, 8);
  if (sources.length === 0) return <p className="text-[11px] text-slate-600">No saved context-processing logs for this project.</p>;
  return (
    <div className="space-y-2">
      {sources.map((source, occurrence) => {
        const log = source.processing_log;
        return (
          <details key={sourceActivityRenderKey(source, occurrence)} className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
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
  const visibleIds = new Set(debug.filterVisibilityTrace.find((item) => item.filter === 'all')?.visibleNodeIds ?? []);
  const visibleNodes = debug.rawProjectGraph.nodes.filter((node) => visibleIds.has(node.id));
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-300">Graph</summary>
      <div className="mt-3 space-y-2 text-[11px] text-slate-500">
        <p><span className="text-slate-300">Project graph:</span> {debug.rawProjectGraph.totalNodes} nodes · {debug.rawProjectGraph.totalEdges} relationships</p>
        <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
          <p className="mb-1 font-semibold text-slate-400">Visible All nodes</p>
          {visibleNodes.length > 0 ? visibleNodes.map((node) => (
            <p key={node.id} className="leading-relaxed"><span className="text-slate-300">{node.type}</span> · {node.text}{showIds ? ` · ${node.id}` : ''}</p>
          )) : <p>No visible All nodes.</p>}
        </div>
        <button type="button" onClick={() => setShowIds((current) => !current)} className="text-[10px] font-semibold text-cyan-300 hover:text-cyan-200">{showIds ? 'Hide IDs' : 'Show IDs'}</button>
        <JsonDetails title="Focus analysis" value={debug.currentFocusAnalysis} />
        <JsonDetails title="All graph structure" value={debug.rawProjectGraph.topology} />
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
        <JsonDetails title="Rendered readability summary" value={debug.renderedMapReadabilitySummary ?? null} />
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
  const [generationTimelines, setGenerationTimelines] = useState<GenerationTimeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setTraces([]);
      setRelatedTraces([]);
      setGenerationTimelines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await authFetch(`/api/dev/traces?userId=${encodeURIComponent(userId)}&projectId=${encodeURIComponent(project.id)}`);
      if (!response.ok) {
        setTraces([]);
        setRelatedTraces([]);
        setGenerationTimelines([]);
        setAgentPolicy([]);
        return;
      }
      const data = await response.json() as { traces?: TraceEvent[]; agentPolicy?: TraceAgentConfig[]; generationRuns?: GenerationTimeline[] };
      setTraces((data.traces ?? [])
        .filter((trace) => trace.decisionMapActivity?.projectId === project.id)
        .slice(0, 6));
      setRelatedTraces((data.traces ?? []).filter((trace) => (
        trace.contextSummary?.scope === project.id
        || trace.decisionMapActivity?.projectId === project.id
      )));
      setAgentPolicy(data.agentPolicy ?? []);
      setGenerationTimelines(data.generationRuns ?? []);
    } catch {
      setTraces([]);
      setRelatedTraces([]);
      setAgentPolicy([]);
      setGenerationTimelines([]);
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
          : (
            <>
              {generationTimelines[0] && <GenerationDetails timeline={generationTimelines[0]} />}
              {traces.length === 0 ? (
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
                        <p className="mt-2 text-slate-500">{summary.visibleNodes ?? 0} visible · {summary.relationships ?? 0} relationships</p>
                        <ActivityDetails trace={trace} project={project} relatedTraces={relatedTraces.filter((related) => related.id !== trace.id)} />
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )
      )}
    </section>
  );
};
