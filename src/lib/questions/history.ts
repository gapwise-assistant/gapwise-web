import { Project } from '@/types/clarity';

export type AnsweredQuestion = Project['history'][number];

export type ResolvedGapKind = 'question' | 'assumption' | 'decision';

export interface ResolvedGapRecord {
  nodeId: string;
  projectId: string;
  kind: ResolvedGapKind;
  prompt: string;
  resolution: string;
  timestamp?: string;
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function legacyTextMatches(left: string, right: string): boolean {
  const normalizedLeft = normalizedText(left);
  const normalizedRight = normalizedText(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
}

function latestHistoryForNode(project: Project, node: Project['nodes'][number]): AnsweredQuestion | undefined {
  const stable = project.history
    .filter((entry) => entry.nodeId === node.id && Boolean(entry.answer?.trim()))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  if (stable[0]) return stable[0];

  // Older records did not persist nodeId. Keep this compatibility path
  // isolated from the stable lookup so presentation wording changes cannot
  // affect new records.
  return project.history
    .filter((entry) => !entry.nodeId && Boolean(entry.answer?.trim()) && legacyTextMatches(entry.question, node.text))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
}

function resolutionFromIncomingEdge(project: Project, node: Project['nodes'][number]): string | undefined {
  const edge = project.edges
    .slice()
    .reverse()
    .find((candidate) => candidate.type === 'resolves' && candidate.target === node.id);
  if (!edge) return undefined;

  const source = project.nodes.find((candidate) => candidate.id === edge.source);
  if (!source) return undefined;
  if (source.type === 'DECISION' && source.decision_outcome?.trim()) return source.decision_outcome.trim();
  if (source.created_by === 'user' || source.status === 'RESOLVED') return source.text.trim();
  return undefined;
}

function resolutionForNode(project: Project, node: Project['nodes'][number]): { resolution: string; timestamp?: string } {
  const history = latestHistoryForNode(project, node);
  if (node.type === 'DECISION' && node.decision_outcome?.trim()) {
    return { resolution: node.decision_outcome.trim(), timestamp: history?.timestamp ?? node.updated_at };
  }
  if (history?.answer?.trim()) {
    return { resolution: history.answer.trim(), timestamp: history.timestamp };
  }
  return {
    resolution: resolutionFromIncomingEdge(project, node) ?? '',
    timestamp: history?.timestamp ?? node.updated_at,
  };
}

/**
 * Projects resolved graph nodes into the records used by the Gaps UI.
 * Resolution data is deliberately read from canonical graph/history state,
 * not reconstructed from display wording.
 */
export function resolvedGapRecords(project: Project): ResolvedGapRecord[] {
  return project.nodes
    .filter((node) =>
      node.status === 'RESOLVED'
      && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION' || node.type === 'DECISION'),
    )
    .map((node) => {
      const result = resolutionForNode(project, node);
      return {
        nodeId: node.id,
        projectId: project.id,
        kind: node.type === 'DECISION' ? 'decision' : node.type === 'ASSUMPTION' ? 'assumption' : 'question',
        prompt: node.text,
        resolution: result.resolution,
        timestamp: result.timestamp,
      } satisfies ResolvedGapRecord;
    })
    .sort((left, right) => (right.timestamp ?? '').localeCompare(left.timestamp ?? ''));
}

export function resolvedGapMatchesHistory(record: ResolvedGapRecord, entry: AnsweredQuestion): boolean {
  return record.nodeId === entry.nodeId
    || (!entry.nodeId && legacyTextMatches(record.prompt, entry.question));
}

/** Returns the complete persisted answer history, newest first for the Questions view. */
export function answeredQuestionHistory(project: Pick<Project, 'history'>): AnsweredQuestion[] {
  return [...project.history]
    .filter((entry) =>
      !entry.graph_diff_summary?.startsWith('Response cancelled; reopened')
      && !entry.graph_diff_summary?.startsWith('Decision confirmed'),
    )
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}
