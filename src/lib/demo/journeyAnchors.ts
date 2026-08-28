import type { ClarityNode, NodeType, Project, ProjectHistoryEventType } from '@/types/clarity';
import { appendNextActionCompletionHistory } from '@/lib/history/projectHistory';
import { canonicalQuestionGroups } from '@/lib/questions/canonical';

export type JourneyActionableNodeType = Extract<
  NodeType,
  'UNKNOWN' | 'ASSUMPTION' | 'DECISION' | 'NEXT_ACTION'
>;

const ACTIONABLE_NODE_TYPES: ReadonlySet<JourneyActionableNodeType> = new Set([
  'UNKNOWN',
  'ASSUMPTION',
  'DECISION',
  'NEXT_ACTION',
]);

const EXPLICIT_OUTCOME_EDGE_TYPES = new Set(['resolves', 'satisfies', 'supersedes']);
const OUTCOME_HISTORY_TYPES: ReadonlySet<ProjectHistoryEventType> = new Set([
  'decision_resolved',
  'gap_resolved',
  'action_completed',
]);

export interface DemoJourneyAnchor {
  key: string;
  projectId: string;
  /** The exact canonical node created by the controlled transition. */
  actionNodeId?: string;
  /** The explicit outcome target of a NEXT_ACTION → satisfies edge, when present. */
  outcomeNodeId?: string;
  /** IDs captured for diagnostics when a controlled source produced more than one node. */
  candidateNodeIds: string[];
}

export type JourneyAnchorBook = Map<string, DemoJourneyAnchor>;

export interface JourneyAnchorInspection {
  key: string;
  anchor?: DemoJourneyAnchor;
  candidateNodes: ClarityNode[];
  actionableCandidates: ClarityNode[];
  openCandidates: ClarityNode[];
  resolvedCandidates: ClarityNode[];
  explicitOutcomeNodeIds: string[];
  satisfiedCandidateNodeIds: string[];
  node?: ClarityNode;
  status: 'selected' | 'missing' | 'ambiguous' | 'not_actionable';
}

export function createJourneyAnchorBook(): JourneyAnchorBook {
  return new Map();
}

export function isJourneyActionableNode(node: ClarityNode | undefined): node is ClarityNode & {
  type: JourneyActionableNodeType;
} {
  return Boolean(node && ACTIONABLE_NODE_TYPES.has(node.type as JourneyActionableNodeType));
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function nodeSemanticSignature(node: ClarityNode): string {
  return JSON.stringify({
    id: node.id,
    type: node.type,
    text: node.text,
    status: node.status,
    confidence: node.confidence,
    impact: node.impact,
    decision_outcome: node.decision_outcome,
  });
}

/**
 * Captures IDs that were created or materially changed by one ingestion.
 * Identity comes from the graph, not from text matching or array position.
 */
export function changedCanonicalNodeIds(before: Project, after: Project): string[] {
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  return after.nodes
    .filter((node) => {
      const previous = beforeById.get(node.id);
      return !previous || nodeSemanticSignature(previous) !== nodeSemanticSignature(node);
    })
    .map((node) => node.id);
}

/**
 * Returns the canonical IDs associated with a source transition. The source's
 * derived IDs are preferred when available, while changed IDs cover storage
 * implementations that do not populate derived_node_ids in test or fallback
 * paths.
 */
export function candidateNodeIdsForJourneyAnchor(
  before: Project,
  after: Project,
  sourceId?: string,
): string[] {
  const sourceNodeIds = sourceId
    ? after.sources.find((source) => source.id === sourceId)?.derived_node_ids ?? []
    : [];
  const afterNodeIds = new Set(after.nodes.map((node) => node.id));
  return uniqueIds([
    ...sourceNodeIds,
    ...changedCanonicalNodeIds(before, after),
  ]).filter((id) => afterNodeIds.has(id));
}

export function recordJourneyAnchor(
  anchors: JourneyAnchorBook,
  params: {
    key: string;
    project: Project;
    candidateNodeIds: string[];
    actionNodeId?: string;
    outcomeNodeId?: string;
  },
): DemoJourneyAnchor {
  const previous = anchors.get(params.key);
  const projectNodeIds = new Set(params.project.nodes.map((node) => node.id));
  const anchor: DemoJourneyAnchor = {
    key: params.key,
    projectId: params.project.id,
    candidateNodeIds: uniqueIds([
      ...(previous?.candidateNodeIds ?? []),
      ...params.candidateNodeIds,
    ]).filter((id) => projectNodeIds.has(id)),
    ...(previous?.actionNodeId && projectNodeIds.has(previous.actionNodeId)
      ? { actionNodeId: previous.actionNodeId }
      : params.actionNodeId && projectNodeIds.has(params.actionNodeId)
        ? { actionNodeId: params.actionNodeId }
        : {}),
    ...(previous?.outcomeNodeId && projectNodeIds.has(previous.outcomeNodeId)
      ? { outcomeNodeId: previous.outcomeNodeId }
      : params.outcomeNodeId && projectNodeIds.has(params.outcomeNodeId)
        ? { outcomeNodeId: params.outcomeNodeId }
        : {}),
  };
  anchors.set(params.key, anchor);
  return anchor;
}

function canonicalNodeIds(project: Project, nodeIds: string[]): string[] {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  return uniqueIds(nodeIds.map((id) => nodesById.get(id)?.canonical_node_id ?? id))
    .filter((id) => nodesById.has(id));
}

function satisfiesTargetIds(project: Project, actionNodeId: string): string[] {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  return uniqueIds(
    project.edges
      .filter((edge) => edge.source === actionNodeId && edge.type === 'satisfies')
      .map((edge) => edge.target)
      .filter((id) => nodesById.has(id)),
  );
}

function canonicalActionNode(project: Project, node: ClarityNode | undefined): ClarityNode | undefined {
  if (!node || (node.type !== 'UNKNOWN' && node.type !== 'ASSUMPTION')) return node;
  return canonicalQuestionGroups(project)
    .find((group) => group.nodeIds.includes(node.id))
    ?.canonical ?? node;
}

/**
 * Records an anchor only from a controlled source. A source with one
 * canonical result can provide the stable action ID; a source with several
 * results remains diagnosable but cannot be guessed later.
 */
export function recordControlledJourneyAnchor(
  anchors: JourneyAnchorBook,
  params: {
    key: string;
    before: Project;
    after: Project;
    sourceId?: string;
    actionNodeId?: string;
  },
): DemoJourneyAnchor {
  const sourceNodeIds = params.sourceId
    ? params.after.sources.find((source) => source.id === params.sourceId)?.derived_node_ids ?? []
    : [];
  const changedNodeIds = changedCanonicalNodeIds(params.before, params.after);
  const candidateNodeIds = uniqueIds([...sourceNodeIds, ...changedNodeIds]);
  const canonicalCandidates = canonicalNodeIds(params.after, sourceNodeIds);
  const actionNodeId = params.actionNodeId
    ?? (canonicalCandidates.length === 1 ? canonicalCandidates[0] : undefined)
    ?? (sourceNodeIds.length === 0 && changedNodeIds.length === 1
      ? canonicalNodeIds(params.after, changedNodeIds)[0]
      : undefined);
  const outcomeNodeId = actionNodeId
    ? satisfiesTargetIds(params.after, actionNodeId).length === 1
      ? satisfiesTargetIds(params.after, actionNodeId)[0]
      : undefined
    : undefined;

  return recordJourneyAnchor(anchors, {
    key: params.key,
    project: params.after,
    candidateNodeIds,
    ...(actionNodeId ? { actionNodeId } : {}),
    ...(outcomeNodeId ? { outcomeNodeId } : {}),
  });
}

function explicitOutcomeTargetIds(project: Project, candidateIds: Set<string>): string[] {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  return uniqueIds(
    project.edges
      .filter((edge) => candidateIds.has(edge.target) && EXPLICIT_OUTCOME_EDGE_TYPES.has(edge.type))
      .filter((edge) => {
        const target = nodesById.get(edge.target);
        return Boolean(target && target.status === 'RESOLVED');
      })
      .map((edge) => edge.target),
  );
}

function explicitSatisfiedSourceIds(project: Project, candidateIds: Set<string>): string[] {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  return uniqueIds(
    project.edges
      .filter((edge) => candidateIds.has(edge.source) && EXPLICIT_OUTCOME_EDGE_TYPES.has(edge.type))
      .filter((edge) => nodesById.get(edge.target)?.status === 'RESOLVED')
      .map((edge) => edge.source),
  );
}

/**
 * Resolves an anchor only from IDs captured at creation/change time. If a
 * controlled transition did not identify one exact node, ambiguous candidates
 * are reported instead of guessed.
 */
export function inspectJourneyAnchor(
  anchors: JourneyAnchorBook,
  key: string,
  project: Project,
): JourneyAnchorInspection {
  const anchor = anchors.get(key);
  if (!anchor || anchor.projectId !== project.id) {
    return {
      key,
      ...(anchor ? { anchor } : {}),
      candidateNodes: [],
      actionableCandidates: [],
      openCandidates: [],
      resolvedCandidates: [],
      explicitOutcomeNodeIds: [],
      satisfiedCandidateNodeIds: [],
      status: 'missing',
    };
  }

  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const recordedIds = uniqueIds([
    ...anchor.candidateNodeIds,
    ...(anchor.actionNodeId ? [anchor.actionNodeId] : []),
    ...(anchor.outcomeNodeId ? [anchor.outcomeNodeId] : []),
  ]);
  const candidateNodes = recordedIds
    .map((id) => nodesById.get(id))
    .filter((node): node is ClarityNode => Boolean(node));
  const actionableCandidates = candidateNodes.filter(isJourneyActionableNode);
  const openCandidates = actionableCandidates.filter((node) => node.status === 'OPEN');
  const resolvedCandidates = actionableCandidates.filter((node) => node.status === 'RESOLVED');
  const explicitOutcomeNodeIds = explicitOutcomeTargetIds(project, new Set(recordedIds));
  const satisfiedCandidateNodeIds = explicitSatisfiedSourceIds(
    project,
    new Set(recordedIds),
  );

  if (anchor.actionNodeId) {
    const actionNode = canonicalActionNode(project, nodesById.get(anchor.actionNodeId));
    if (actionNode && isJourneyActionableNode(actionNode)) {
      if (actionNode.id !== anchor.actionNodeId) {
        anchor.actionNodeId = actionNode.id;
        anchor.candidateNodeIds = uniqueIds([...anchor.candidateNodeIds, actionNode.id]);
        anchors.set(key, anchor);
      }
      if (!anchor.outcomeNodeId) {
        const targets = satisfiesTargetIds(project, actionNode.id);
        if (targets.length === 1) {
          anchor.outcomeNodeId = targets[0];
          anchors.set(key, anchor);
        }
      }
      return {
        key,
        anchor,
        candidateNodes,
        actionableCandidates,
        openCandidates,
        resolvedCandidates,
        explicitOutcomeNodeIds,
        satisfiedCandidateNodeIds,
        node: actionNode,
        status: 'selected',
      };
    }
    return {
      key,
      anchor,
      candidateNodes,
      actionableCandidates,
      openCandidates,
      resolvedCandidates,
      explicitOutcomeNodeIds,
      satisfiedCandidateNodeIds,
      status: 'missing',
    };
  }

  return {
    key,
    anchor,
    candidateNodes,
    actionableCandidates,
    openCandidates,
    resolvedCandidates,
    explicitOutcomeNodeIds,
    satisfiedCandidateNodeIds,
    status: actionableCandidates.length > 1 ? 'ambiguous' : 'not_actionable',
  };
}

export function journeyAnchorHasOutcome(inspection: JourneyAnchorInspection): boolean {
  return Boolean(
    inspection.node
    && (
      inspection.node.status === 'RESOLVED'
      || inspection.satisfiedCandidateNodeIds.includes(inspection.node.id)
      || inspection.explicitOutcomeNodeIds.includes(inspection.anchor?.outcomeNodeId ?? '')
    ),
  );
}

export function hasJourneyOutcomeHistory(project: Project, nodeId: string): boolean {
  return (project.historyEvents ?? []).some((event) =>
    event.primaryNodeId === nodeId && OUTCOME_HISTORY_TYPES.has(event.type),
  );
}

export function hasJourneyActionCompletionHistory(project: Project, nodeId: string): boolean {
  return (project.historyEvents ?? []).some((event) =>
    event.primaryNodeId === nodeId && event.type === 'action_completed',
  );
}

/**
 * Records the shared action-completion event for a standalone completed
 * NEXT_ACTION. This never changes graph state or infers completion; the node
 * must already be RESOLVED by an explicit workflow or model outcome.
 */
export function recordJourneyActionCompletionHistory(
  project: Project,
  actionNodeId: string,
  createdAt = new Date().toISOString(),
): boolean {
  const action = project.nodes.find((node) => node.id === actionNodeId);
  if (!action || action.type !== 'NEXT_ACTION' || action.status !== 'RESOLVED') return false;
  if (hasJourneyActionCompletionHistory(project, actionNodeId)) return false;
  appendNextActionCompletionHistory(project, [actionNodeId], createdAt);
  return true;
}

export function journeyAnchorDiagnostics(inspection: JourneyAnchorInspection): string {
  const candidates = inspection.candidateNodes.map((node) => ({
    id: node.id,
    type: node.type,
    status: node.status,
    text: node.text,
  }));
  return `Journey anchor "${inspection.key}" is ${inspection.status}; action node: ${inspection.anchor?.actionNodeId ?? 'unset'}; outcome node: ${inspection.anchor?.outcomeNodeId ?? 'unset'}; candidate nodes: ${JSON.stringify(candidates)}`;
}
