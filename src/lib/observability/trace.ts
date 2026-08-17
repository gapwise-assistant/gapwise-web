import { TraceEvent } from '@/types/observability';

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

/** Clear the in-memory developer history for one user before a repeatable demo reset. */
export function clearTracesForUser(userId: string): void {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    if (traces[index].userId === userId) traces.splice(index, 1);
  }
}

export function clearTracesForTests(): void {
  traces.splice(0);
}
