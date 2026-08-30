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

type DetailRecord = Record<string, unknown>;

function detailString(details: DetailRecord | undefined, key: string): string | null {
  const value = details?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function detailNumber(details: DetailRecord | undefined, key: string): number | null {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function detailBoolean(details: DetailRecord | undefined, key: string): boolean | null {
  const value = details?.[key];
  return typeof value === 'boolean' ? value : null;
}

function detailStrings(details: DetailRecord | undefined, key: string): string[] {
  const value = details?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function detailRecords(details: DetailRecord | undefined, key: string): DetailRecord[] {
  const value = details?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is DetailRecord => Boolean(item) && typeof item === 'object')
    : [];
}

function formatValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'none';
  return JSON.stringify(value) ?? 'none';
}

function DetailLine({ label, value }: { label: string; value: unknown }) {
  return (
    <p>
      <span className="text-slate-400">{label}:</span> {formatValue(value)}
    </p>
  );
}

function CalendarStageDetails({ details }: { details?: DetailRecord }) {
  if (!details) return null;
  const eventIds = detailStrings(details, 'eventIds');
  const candidateEventIds = detailStrings(details, 'candidateEventIds');
  const relevantEventIds = detailStrings(details, 'relevantEventIds');
  const calendarEventIds = detailStrings(details, 'calendarEventIds');
  const calendarSourceIds = detailStrings(details, 'calendarSourceIds');
  const projectNodeIds = detailStrings(details, 'projectNodeIds');
  const derivedNodeIds = detailStrings(details, 'derivedNodeIds');
  const candidates = detailRecords(details, 'candidates');
  const results = detailRecords(details, 'results');
  const renderedKeys = new Set<string>();
  const lines: Array<{ key: string; label: string; value: unknown }> = [];
  const add = (key: string, label: string, value: unknown) => {
    if (value === null || value === undefined || renderedKeys.has(key)) return;
    renderedKeys.add(key);
    lines.push({ key, label, value });
  };

  add('calendarId', 'Calendar', detailString(details, 'calendarId'));
  add('rawResultCount', 'Google events retrieved', detailNumber(details, 'rawResultCount'));
  add('inputCount', 'Prefilter input', detailNumber(details, 'inputCount'));
  add('outputCount', 'Prefilter output', detailNumber(details, 'outputCount'));
  add('assessmentId', 'Assessment ID', detailString(details, 'assessmentId'));
  add('cacheStatus', 'Cache', detailString(details, 'cacheStatus'));
  add('projectId', 'Project', detailString(details, 'projectId'));
  add('projectSemanticVersion', 'Project semantic version', detailString(details, 'projectSemanticVersion'));
  add('model', 'Classifier model', detailString(details, 'model'));
  add('thinkingLevel', 'Thinking', detailString(details, 'thinkingLevel'));
  add('maxOutputTokens', 'Output limit', detailNumber(details, 'maxOutputTokens'));
  add('validationStatus', 'Validation', detailString(details, 'validationStatus'));
  add('eventFingerprint', 'Event fingerprint', detailString(details, 'eventFingerprint'));
  add('outcome', 'Import result', detailString(details, 'outcome'));
  add('sourceId', 'Source ID', detailString(details, 'sourceId'));
  add('importedSourceId', 'Imported source ID', detailString(details, 'importedSourceId'));
  add('processingStatus', 'Processing status', detailString(details, 'processingStatus'));
  add('historyEventId', 'History event ID', detailString(details, 'historyEventId'));
  add('saveCompleted', 'Save completed', detailBoolean(details, 'saveCompleted'));
  add('reloadCompleted', 'Reload completed', detailBoolean(details, 'reloadCompleted'));
  add('reloadedProjectId', 'Reloaded project ID', detailString(details, 'reloadedProjectId'));
  add('saveSucceeded', 'Assessment save', detailBoolean(details, 'saveSucceeded'));
  add('readAfterWrite', 'Read after write', detailBoolean(details, 'readAfterWrite'));

  return (
    <div className="mt-2 space-y-1 text-[11px] text-slate-500">
      {lines.map((line) => <DetailLine key={line.key} label={line.label} value={line.value} />)}
      {eventIds.length > 0 && <DetailLine label="Google event IDs" value={eventIds.join(', ')} />}
      {candidateEventIds.length > 0 && <DetailLine label="Classifier candidates" value={candidateEventIds.join(', ')} />}
      {relevantEventIds.length > 0 && <DetailLine label="Relevant event IDs" value={relevantEventIds.join(', ')} />}
      {calendarEventIds.length > 0 && <DetailLine label="Returned event IDs" value={calendarEventIds.join(', ')} />}
      {calendarSourceIds.length > 0 && <DetailLine label="Returned source IDs" value={calendarSourceIds.join(', ')} />}
      {projectNodeIds.length > 0 && <DetailLine label="Project node IDs" value={projectNodeIds.join(', ')} />}
      {derivedNodeIds.length > 0 && <DetailLine label="Derived node IDs" value={derivedNodeIds.join(', ')} />}
      {candidates.length > 0 && (
        <div>
          <p className="text-slate-400">Prefilter outcomes:</p>
          <ul className="ml-3 list-disc">
            {candidates.map((candidate, index) => (
              <li key={`${formatValue(candidate.eventId)}-${index}`}>
                {formatValue(candidate.eventId)} · {formatValue(candidate.outcome)}
                {candidate.reason ? ` · ${formatValue(candidate.reason)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {results.length > 0 && (
        <div>
          <p className="text-slate-400">Classifier results:</p>
          <ul className="ml-3 list-disc">
            {results.map((result, index) => (
              <li key={`${formatValue(result.eventId)}-${index}`}>
                {formatValue(result.eventId)} · {result.relevant ? 'relevant' : 'irrelevant'} · confidence {formatValue(result.confidence)} · {formatValue(result.thresholdOutcome)}
                {Array.isArray(result.matchedNodeIds) && result.matchedNodeIds.length > 0
                  ? ` · nodes ${result.matchedNodeIds.map(formatValue).join(', ')}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lines.length === 0 && eventIds.length === 0 && candidateEventIds.length === 0 && relevantEventIds.length === 0 && calendarEventIds.length === 0 && calendarSourceIds.length === 0 && candidates.length === 0 && results.length === 0 && (
        <p>No structured stage details recorded.</p>
      )}
    </div>
  );
}

export function CalendarSyncTraceView({ trace }: { trace: TraceEvent }) {
  const calendar = trace.calendarSync;
  if (!calendar) return null;
  return (
    <details className="mt-2 rounded-lg border border-cyan-900/70 bg-cyan-950/20 p-2" open>
      <summary className="cursor-pointer text-xs font-bold text-cyan-100">Calendar sync pipeline</summary>
      <div className="mt-2 space-y-2 text-[11px] text-slate-300">
        <div className="border-b border-cyan-900/50 pb-2">
          <DetailLine label="Run ID" value={calendar.runId} />
          <DetailLine label="Status" value={calendar.status} />
          <DetailLine label="Project ID" value={calendar.projectId ?? 'none'} />
        </div>
        {calendar.steps.length > 0 ? (
          <ol className="space-y-2">
            {calendar.steps.map((step, index) => (
              <li key={`${step.name}-${step.startedAt}-${index}`} className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-slate-200">{index + 1}. {step.name}</span>
                  <span className={step.status === 'failed' ? 'text-rose-300' : 'text-cyan-300'}>{step.status}</span>
                </div>
                <p className="mt-1 text-slate-500">{step.durationMs}ms · {step.startedAt}</p>
                <CalendarStageDetails details={step.details} />
                {step.error && <p className="mt-1 text-rose-300">Error: {step.error}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-slate-500">No pipeline stages recorded yet.</p>
        )}
      </div>
    </details>
  );
}

function CalendarContextPackTraceView({ trace }: { trace: TraceEvent }) {
  const contextPack = trace.calendarContextPack;
  if (!contextPack) return null;
  return (
    <details className="mt-2 rounded-lg border border-violet-900/70 bg-violet-950/20 p-2" open>
      <summary className="cursor-pointer text-xs font-bold text-violet-100">Calendar Context Pack</summary>
      <div className="mt-2 space-y-1 text-[11px] text-slate-400">
        <DetailLine label="Project ID" value={contextPack.projectId} />
        <DetailLine label="Cache" value={`${contextPack.cacheStatus}${contextPack.stale ? ' · stale' : ''}`} />
        <DetailLine label="Assessment ID" value={contextPack.assessmentId ?? 'none'} />
        <DetailLine label="Relevant event IDs" value={contextPack.relevantEventIds.join(', ') || 'none'} />
        <DetailLine label="Commitment IDs" value={contextPack.commitmentIds.join(', ') || 'none'} />
        <DetailLine label="Refresh scheduled" value={contextPack.refreshScheduled ? 'yes' : 'no'} />
      </div>
    </details>
  );
}

function CalendarDiagnostics({ trace }: { trace: TraceEvent }) {
  return (
    <>
      <CalendarSyncTraceView trace={trace} />
      <CalendarContextPackTraceView trace={trace} />
    </>
  );
}

export function selectCalendarTraceViews(traces: TraceEvent[]): {
  latestCalendarSyncTrace?: TraceEvent;
  latestCalendarContextPackTrace?: TraceEvent;
  recentTraces: TraceEvent[];
} {
  const latestCalendarSyncTrace = traces.find((trace) => trace.calendarSync);
  const latestCalendarContextPackTrace = traces.find((trace) => trace.calendarContextPack);
  const dedicatedCalendarTraceIds = new Set(
    [latestCalendarSyncTrace?.id, latestCalendarContextPackTrace?.id].filter(
      (id): id is string => Boolean(id),
    ),
  );
  return {
    latestCalendarSyncTrace,
    latestCalendarContextPackTrace,
    recentTraces: traces
      .filter((trace) => !dedicatedCalendarTraceIds.has(trace.id))
      .slice(0, 8),
  };
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

  const {
    latestCalendarSyncTrace,
    latestCalendarContextPackTrace,
    recentTraces,
  } = selectCalendarTraceViews(traces);

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
            {(latestCalendarSyncTrace || latestCalendarContextPackTrace) && (
              <details className="rounded-xl border border-cyan-800/80 bg-slate-900 p-3" open>
                <summary className="cursor-pointer text-xs font-bold text-cyan-100">
                  Latest Calendar diagnostics
                </summary>
                <div className="mt-2">
                  {latestCalendarSyncTrace && <CalendarDiagnostics trace={latestCalendarSyncTrace} />}
                  {latestCalendarContextPackTrace && latestCalendarContextPackTrace.id !== latestCalendarSyncTrace?.id && (
                    <CalendarDiagnostics trace={latestCalendarContextPackTrace} />
                  )}
                </div>
              </details>
            )}
            {traces.length === 0 ? (
              <p className="text-xs text-slate-500">No traces recorded yet.</p>
            ) : (
              recentTraces.map((trace) => (
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
                  {!trace.calendarSync && !trace.calendarContextPack && (
                    <>
                      <p className="mt-2 text-slate-400">
                        Agents: {trace.agentNames.join(', ') || 'none'}
                      </p>
                      <p className="text-slate-500">
                        Context IDs ({trace.contextIds.length}): {trace.contextIds.slice(0, 8).join(', ') || 'none'}{trace.contextIds.length > 8 ? '…' : ''}
                      </p>
                    </>
                  )}
                  <CalendarDiagnostics trace={trace} />
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
