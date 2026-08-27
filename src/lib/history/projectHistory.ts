import type {
  ClarityNode,
  Project,
  ProjectHistoryChange,
  ProjectHistoryChangeKind,
  ProjectHistoryEvent,
  ProjectHistoryEventType,
  ProjectHistoryFocus,
  HistoryNodeSnapshot,
} from '@/types/clarity';
import { isNodeBlocked } from '@/lib/focus/sequencing';

const IMPACT_EDGE_TYPES = new Set([
  'informs',
  'affects',
  'depends_on',
  'blocks',
  'satisfies',
  'resolves',
]);

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function nodeMap(project: Project): Map<string, ClarityNode> {
  return new Map(project.nodes.map((node) => [node.id, node]));
}

export function snapshotNode(node: ClarityNode): HistoryNodeSnapshot {
  return {
    nodeId: node.id,
    text: node.text,
    type: node.type,
    status: node.status,
  };
}

function focusSnapshot(project: Project): ProjectHistoryFocus | undefined {
  const active = project.active_question;
  if (!active) return undefined;
  const node = project.nodes.find((candidate) => candidate.id === active.node_id);
  const title = node?.text ?? active.question;
  if (!title?.trim()) return undefined;
  return {
    title: title.trim(),
    actionNodeId: active.node_id,
    sourceNodeIds: node ? [node.id] : [],
    sourceIds: node?.source_refs ?? [],
  };
}

function sameFocus(left?: ProjectHistoryFocus, right?: ProjectHistoryFocus): boolean {
  if (!left || !right) return !left && !right;
  if (left.actionNodeId && right.actionNodeId) return left.actionNodeId === right.actionNodeId;

  const leftNodeIds = new Set(left.sourceNodeIds ?? []);
  const rightNodeIds = new Set(right.sourceNodeIds ?? []);
  if (leftNodeIds.size && rightNodeIds.size) {
    return [...leftNodeIds].some((id) => rightNodeIds.has(id));
  }

  const leftSourceIds = new Set(left.sourceIds ?? []);
  const rightSourceIds = new Set(right.sourceIds ?? []);
  if (leftSourceIds.size && rightSourceIds.size) {
    return [...leftSourceIds].some((id) => rightSourceIds.has(id));
  }

  return normalized(left.title) === normalized(right.title);
}

function withFocusChange(
  event: Omit<ProjectHistoryEvent, 'id' | 'projectId'>,
  before: Project,
  after: Project,
  override?: { before: ProjectHistoryFocus | null | undefined; after: ProjectHistoryFocus | null | undefined },
): Omit<ProjectHistoryEvent, 'id' | 'projectId'> {
  const focusBefore = override ? override.before ?? undefined : focusSnapshot(before);
  const focusAfter = override ? override.after ?? undefined : focusSnapshot(after);
  if (sameFocus(focusBefore, focusAfter)) return event;
  return {
    ...event,
    focusBefore,
    focusAfter,
  };
}

function eventId(project: Project, type: ProjectHistoryEventType, createdAt: string): string {
  return `${project.id}:history:${type}:${createdAt}:${project.historyEvents?.length ?? 0}`;
}

export function appendProjectHistoryEvent(
  project: Project,
  event: Omit<ProjectHistoryEvent, 'id' | 'projectId'>,
): Project {
  const createdAt = event.createdAt || new Date().toISOString();
  const next: ProjectHistoryEvent = {
    ...event,
    id: eventId(project, event.type, createdAt),
    projectId: project.id,
    createdAt,
  };
  project.historyEvents = [...(project.historyEvents ?? []), next];
  return project;
}

function nodeChangeKind(before: ClarityNode | undefined, after: ClarityNode): ProjectHistoryChangeKind {
  if (!before) return 'learned';
  if (before.status !== after.status) {
    if (after.status === 'RESOLVED') return 'resolved';
    if (after.status === 'DEPRECATED') return 'invalidated';
  }
  return 'updated';
}

function nodeChange(kind: ProjectHistoryChangeKind, node: ClarityNode): ProjectHistoryChange {
  return {
    kind,
    nodeId: node.id,
    text: node.text,
    snapshot: snapshotNode(node),
  };
}

function changesBetween(before: Project, after: Project): ProjectHistoryChange[] {
  const beforeNodes = nodeMap(before);
  const changes: ProjectHistoryChange[] = [];

  after.nodes.forEach((node) => {
    const previous = beforeNodes.get(node.id);
    if (!previous && node.status !== 'DEPRECATED') {
      changes.push(nodeChange('learned', node));
      return;
    }
    if (!previous || (previous.status === node.status && previous.text === node.text && previous.type === node.type)) return;
    changes.push(nodeChange(nodeChangeKind(previous, node), node));
  });

  const afterNodes = nodeMap(after);
  before.nodes.forEach((node) => {
    if (!afterNodes.has(node.id) && node.status !== 'DEPRECATED') {
      changes.push({
        kind: 'invalidated',
        nodeId: node.id,
        text: node.text,
        snapshot: snapshotNode(node),
      });
    }
  });

  const blockedBefore = new Set(
    before.nodes
      .filter((node) => node.status === 'OPEN' && isNodeBlocked(before, node.id))
      .map((node) => node.id),
  );
  after.nodes.forEach((node) => {
    if (node.status !== 'OPEN' || !blockedBefore.has(node.id) || isNodeBlocked(after, node.id)) return;
    if (changes.some((change) => change.nodeId === node.id)) return;
    changes.push(nodeChange('unblocked', node));
  });

  return changes.filter((change, index, all) =>
    all.findIndex((candidate) => candidate.nodeId === change.nodeId && candidate.kind === change.kind) === index,
  );
}

function edgeKey(edge: Project['edges'][number]): string {
  return `${edge.source}:${edge.type}:${edge.target}`;
}

function meaningfulAffectedNodes(
  before: Project,
  after: Project,
  changes: ProjectHistoryChange[],
  excludedNodeIds: string[] = [],
): HistoryNodeSnapshot[] {
  const beforeNodes = nodeMap(before);
  const afterNodes = nodeMap(after);
  const learnedNodeIds = new Set(
    changes.filter((change) => change.kind === 'learned').map((change) => change.nodeId ?? ''),
  );
  const directChangeIds = new Set(changes.map((change) => change.nodeId ?? ''));
  const excluded = new Set(excludedNodeIds);
  const affectedIds = new Set<string>();

  const addExistingAffected = (nodeId: string): void => {
    if (!nodeId || excluded.has(nodeId) || learnedNodeIds.has(nodeId) || directChangeIds.has(nodeId)) return;
    if (!beforeNodes.has(nodeId) || !afterNodes.has(nodeId)) return;
    const node = afterNodes.get(nodeId);
    if (node && node.status !== 'DEPRECATED') affectedIds.add(nodeId);
  };

  const priorEdges = new Set(before.edges.map(edgeKey));
  after.edges
    .filter((edge) => !priorEdges.has(edgeKey(edge)) && IMPACT_EDGE_TYPES.has(edge.type))
    .forEach((edge) => {
      const sourceIsNew = learnedNodeIds.has(edge.source);
      const targetIsNew = learnedNodeIds.has(edge.target);

      if (sourceIsNew && !targetIsNew) {
        addExistingAffected(edge.target);
        return;
      }
      if (!sourceIsNew && targetIsNew && (edge.type === 'depends_on' || edge.type === 'blocks')) {
        addExistingAffected(edge.source);
        return;
      }
      // A new relationship between existing nodes can still be meaningful,
      // for example when new evidence connects an existing decision to an
      // existing constraint. Keep the target as the downstream consequence.
      if (!sourceIsNew && !targetIsNew) addExistingAffected(edge.target);
    });

  // A state transition on an existing node is itself meaningful, but it is
  // already represented in `changes`. Only surface newly unblocked nodes as
  // affected when they were not otherwise changed in this event.
  before.nodes.forEach((node) => {
    if (!afterNodes.has(node.id) || node.status !== 'OPEN' || !afterNodes.get(node.id)) return;
    const next = afterNodes.get(node.id)!;
    if (isNodeBlocked(before, node.id) && !isNodeBlocked(after, node.id) && next.status === 'OPEN') {
      addExistingAffected(node.id);
    }
  });

  return [...affectedIds]
    .map((nodeId) => afterNodes.get(nodeId))
    .filter((node): node is ClarityNode => Boolean(node))
    .map(snapshotNode);
}

function changedNodeIds(changes: ProjectHistoryChange[]): string[] {
  return unique(changes.map((change) => change.nodeId ?? ''));
}

const SUMMARY_LABELS: Partial<Record<ClarityNode['type'], string>> = {
  KNOWN: 'fact',
  EVIDENCE: 'evidence',
  DECISION: 'decision',
  CONSTRAINT: 'constraint',
  RISK: 'risk',
  UNKNOWN: 'unknown',
  ASSUMPTION: 'assumption',
  NEXT_ACTION: 'action',
  PREFERENCE: 'preference',
  EXPERIMENT: 'experiment',
  GOAL: 'goal',
};

function pluralLabel(label: string, count: number): string {
  if (count === 1 || label === 'evidence') return label;
  if (label.endsWith('s')) return label;
  return `${label}s`;
}

function summaryForContext(changes: ProjectHistoryChange[]): string {
  const learned = changes.filter((change) => change.kind === 'learned');
  const learnedPart = `${learned.length} thing${learned.length === 1 ? '' : 's'} learned`;
  const typeCounts = new Map<string, number>();
  learned.forEach((change) => {
    const label = SUMMARY_LABELS[change.snapshot?.type ?? 'KNOWN'] ?? 'item';
    typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1);
  });
  const breakdown = [...typeCounts.entries()]
    .map(([label, count]) => `${count} ${pluralLabel(label, count)}`)
    .join(' · ');
  return breakdown ? `${learnedPart}\n${breakdown}` : learnedPart;
}

function affectedIds(affectedNodes: HistoryNodeSnapshot[] | undefined): string[] | undefined {
  const ids = unique((affectedNodes ?? []).map((node) => node.nodeId ?? ''));
  return ids.length ? ids : undefined;
}

function resolutionRelevantChanges(
  before: Project,
  after: Project,
  changes: ProjectHistoryChange[],
  primaryNodeId: string,
): ProjectHistoryChange[] {
  const related = new Set([primaryNodeId]);
  const edges = [...before.edges, ...after.edges];
  let expanded = true;
  while (expanded) {
    expanded = false;
    edges.forEach((edge) => {
      if (!IMPACT_EDGE_TYPES.has(edge.type)) return;
      if (related.has(edge.source) && !related.has(edge.target)) {
        related.add(edge.target);
        expanded = true;
      }
      if (related.has(edge.target) && !related.has(edge.source)) {
        related.add(edge.source);
        expanded = true;
      }
    });
  }

  return changes.filter((change) => related.has(change.nodeId ?? ''));
}

export function appendContextAddedHistory(
  before: Project,
  after: Project,
  params: { sourceId: string; filename: string; createdAt?: string },
): Project {
  const changes = changesBetween(before, after);
  const source = after.sources.find((candidate) => candidate.id === params.sourceId);
  const newEdges = after.edges.filter((edge) => !before.edges.some((candidate) => edgeKey(candidate) === edgeKey(edge)));
  const affectedNodes = meaningfulAffectedNodes(before, after, changes);
  // A source can be added again while merely repeating facts already present
  // in the graph. The source itself is not a user-meaningful project change.
  if (changes.length === 0 && newEdges.length === 0) return after;

  return appendProjectHistoryEvent(after, withFocusChange({
    createdAt: params.createdAt ?? new Date().toISOString(),
    type: 'context_added',
    title: `${params.filename} added`,
    summary: summaryForContext(changes),
    sourceId: params.sourceId,
    sourceNodeIds: source?.derived_node_ids ?? [],
    affectedNodeIds: affectedIds(affectedNodes),
    affectedNodes: affectedNodes.length ? affectedNodes : undefined,
    changes: changes.length ? changes : undefined,
  }, before, after));
}

function appendResolutionHistory(
  before: Project,
  after: Project,
  params: {
    nodeId: string;
    answer: string;
    type: 'decision_resolved' | 'gap_resolved';
    question: string;
    createdAt?: string;
    focusBefore?: ProjectHistoryFocus | null;
    focusAfter?: ProjectHistoryFocus | null;
  },
): Project {
  const changes = changesBetween(before, after);
  const resolvedNode = after.nodes.find((node) => node.id === params.nodeId);
  const explicitResolution: ProjectHistoryChange = resolvedNode
    ? nodeChange('resolved', resolvedNode)
    : {
      kind: 'resolved',
      nodeId: params.nodeId,
      text: params.question,
      snapshot: { nodeId: params.nodeId, text: params.question, status: 'RESOLVED' },
    };
  const allChanges = [explicitResolution, ...changes].filter((change, index, all) =>
    all.findIndex((candidate) => candidate.nodeId === change.nodeId && candidate.kind === change.kind) === index,
  );
  const relevantChanges = resolutionRelevantChanges(before, after, allChanges, params.nodeId);
  const affectedNodes = meaningfulAffectedNodes(before, after, relevantChanges, [params.nodeId]);
  const focusOverride = 'focusBefore' in params || 'focusAfter' in params
    ? { before: params.focusBefore, after: params.focusAfter }
    : undefined;
  return appendProjectHistoryEvent(after, withFocusChange({
    createdAt: params.createdAt ?? new Date().toISOString(),
    type: params.type,
    title: params.type === 'decision_resolved' ? 'Decision made' : 'Question resolved',
    summary: params.answer.trim(),
    primaryNodeId: params.nodeId,
    primarySnapshot: resolvedNode ? snapshotNode(resolvedNode) : explicitResolution.snapshot,
    affectedNodeIds: affectedIds(affectedNodes),
    affectedNodes: affectedNodes.length ? affectedNodes : undefined,
    changes: relevantChanges,
  }, before, after, focusOverride));
}

export function appendGapResolvedHistory(
  before: Project,
  after: Project,
  params: { nodeId: string; question: string; answer: string; createdAt?: string },
): Project {
  return appendResolutionHistory(before, after, { ...params, type: 'gap_resolved' });
}

export function appendDecisionResolvedHistory(
  before: Project,
  after: Project,
  params: {
    nodeId: string;
    question: string;
    answer: string;
    createdAt?: string;
    focusBefore?: ProjectHistoryFocus | null;
    focusAfter?: ProjectHistoryFocus | null;
  },
): Project {
  return appendResolutionHistory(before, after, { ...params, type: 'decision_resolved' });
}

/** Records workflow actions that became obsolete because their explicit
 * intended outcomes were resolved. */
export function appendNextActionCompletionHistory(
  project: Project,
  actionNodeIds: string[],
  createdAt = new Date().toISOString(),
): Project {
  const nodes = nodeMap(project);
  actionNodeIds.forEach((nodeId) => {
    const action = nodes.get(nodeId);
    if (!action || action.type !== 'NEXT_ACTION' || action.status !== 'RESOLVED') return;
    appendProjectHistoryEvent(project, {
      createdAt,
      type: 'action_completed',
      title: 'Action completed',
      summary: action.text,
      primaryNodeId: action.id,
      primarySnapshot: snapshotNode(action),
      changes: [nodeChange('resolved', action)],
    });
  });
  return project;
}

/**
 * Adds a shared before/after Focus Assessment to an already-created mutation
 * event. Focus is derived after the real mutation and refresh path; this
 * helper only annotates the existing event and never creates timeline noise.
 */
export function attachHistoryFocus(
  project: Project,
  params: {
    eventType: ProjectHistoryEventType;
    before: ProjectHistoryFocus | null | undefined;
    after: ProjectHistoryFocus | null | undefined;
  },
): Project {
  const events = [...(project.historyEvents ?? [])];
  const index = [...events].reverse().findIndex((event) => event.type === params.eventType);
  if (index < 0) return project;
  const eventIndex = events.length - 1 - index;
  const event = events[eventIndex];
  if (sameFocus(params.before ?? undefined, params.after ?? undefined)) {
    delete event.focusBefore;
    delete event.focusAfter;
  } else {
    event.focusBefore = params.before ?? undefined;
    event.focusAfter = params.after ?? undefined;
  }
  return project;
}

export function appendGoalChangedHistory(
  before: Project,
  after: Project,
  createdAt = new Date().toISOString(),
): Project {
  if (before.goal.trim() === after.goal.trim()) return after;
  const goalNode = after.nodes.find((node) => node.type === 'GOAL');
  const oldGoalSnapshot: HistoryNodeSnapshot = {
    nodeId: goalNode?.id,
    text: before.goal,
    type: 'GOAL',
    status: goalNode?.status,
  };
  const newGoalSnapshot: HistoryNodeSnapshot = {
    nodeId: goalNode?.id,
    text: after.goal,
    type: 'GOAL',
    status: goalNode?.status,
  };
  return appendProjectHistoryEvent(after, withFocusChange({
    createdAt,
    type: 'goal_changed',
    title: 'Goal updated',
    summary: 'The project goal changed.',
    changes: [
      { kind: 'updated', text: `Old: ${before.goal}`, snapshot: oldGoalSnapshot },
      { kind: 'updated', text: `New: ${after.goal}`, snapshot: newGoalSnapshot },
    ],
  }, before, after));
}

export function historyCurrentFocus(
  project: Project,
  currentFocus?: ProjectHistoryFocus | null,
): ProjectHistoryFocus | undefined {
  if (currentFocus !== undefined) return currentFocus ?? undefined;
  return focusSnapshot(project)
    ?? [...(project.historyEvents ?? [])]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .find((event) => event.focusAfter)?.focusAfter;
}
