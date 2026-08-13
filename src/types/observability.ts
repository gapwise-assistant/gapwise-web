export interface TraceEvent {
  id: string;
  userId: string;
  route: string;
  label: string;
  started_at: string;
  duration_ms: number;
  agentNames: string[];
  contextIds: string[];
  scores: Array<{ id: string; score: number }>;
  toolCalls: string[];
  error?: string;
}
