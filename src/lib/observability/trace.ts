import { TraceEvent } from '@/types/observability';

const traces: TraceEvent[] = [];

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

export function clearTracesForTests(): void {
  traces.splice(0);
}
