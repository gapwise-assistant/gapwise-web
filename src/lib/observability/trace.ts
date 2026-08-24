import { TraceEvent } from '@/types/observability';
import type { DecisionMapDebugTrace } from '@/lib/graph/decisionMapDebug';

const traces: TraceEvent[] = [];

/** Coarse, non-sensitive token estimate used when provider usage is unavailable. */
export function estimateTokenCount(value: string): number {
  return value.trim() ? Math.ceil(value.trim().length / 4) : 0;
}

export function recordTrace(event: Omit<TraceEvent, 'id'>): TraceEvent {
  const trace: TraceEvent = {
    ...event,
    id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
  traces.unshift(trace);
  traces.splice(50);
  return trace;
}

export function listTraces(userId?: string): TraceEvent[] {
  return userId ? traces.filter((trace) => trace.userId === userId) : traces;
}

export function latestDecisionMapActivity(userId: string, projectId: string): TraceEvent | null {
  return traces.find((trace) => trace.userId === userId && trace.decisionMapActivity?.projectId === projectId) ?? null;
}

/** Update the latest semantic event without appending another activity record. */
export function updateLatestDecisionMapRenderer(
  userId: string,
  projectId: string,
  fingerprint: string,
  debug: DecisionMapDebugTrace,
): TraceEvent | null {
  const latest = latestDecisionMapActivity(userId, projectId);
  if (!latest || latest.decisionMapActivity?.fingerprint !== fingerprint) return null;
  if (latest.decisionMapDebug) {
    // Keep the semantic graph/projection that created the activity. Only the
    // ephemeral renderer snapshot is replaced by zoom, pan, or layout changes.
    latest.decisionMapDebug = {
      ...latest.decisionMapDebug,
      render: debug.render,
      layoutDiagnostics: debug.layoutDiagnostics,
    };
  }
  return latest;
}

/** Clear the in-memory developer history for one user before a repeatable demo reset. */
export function clearTracesForUser(userId: string): void {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    if (traces[index].userId === userId) traces.splice(index, 1);
  }
}

export function clearTracesForTests(): void {
  traces.splice(0);
}
