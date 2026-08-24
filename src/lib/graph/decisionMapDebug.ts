import type { ClarityEdge, ClarityNode, NodeType, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { getUnresolvedPrerequisites, isNodeBlocked } from '@/lib/focus/sequencing';
import { isNextActionSatisfied } from '@/lib/actions/completion';
import {
  calculateDecisionMapLayout,
  calculateDecisionMapMetrics,
  decisionMapLaneForType,
  decisionMapNodeDimensions,
  isDecisionMapSecondaryNode,
  type ConstellationPoint,
  type DecisionMapLane,
} from '@/lib/graph/constellation';

export type DecisionMapFilter = 'all' | 'unresolved' | 'critical' | 'assumptions';

export interface DecisionMapRendererDiagnostics {
  positions: Record<string, ConstellationPoint>;
  showSecondaryContext: boolean;
  zoom: number;
  pan: { x: number; y: number };
  viewport: { width: number; height: number };
  mapWidth: number;
  mapHeight: number;
}

export interface DecisionMapDebugOptions {
  filter: DecisionMapFilter;
  selectedNodeId: string | null;
  focusMode: boolean;
  pathMode: boolean;
  focusAssessment?: FocusAssessment | null;
  renderer?: DecisionMapRendererDiagnostics;
}

type NodeStatus = ClarityNode['status'];

export interface DecisionMapDebugTrace {
  schemaVersion: 1;
  projectId: string;
  capturedAt: string;
  render: {
    filter: DecisionMapFilter;
    selectedNodeId: string | null;
    focusMode: boolean;
    pathMode: boolean;
    rendererReported: boolean;
  };
  rawProjectGraph: {
    projectId: string;
    focusAssessment: FocusAssessment | null;
    totalNodes: number;
    totalEdges: number;
    nodes: Array<{
      id: string;
      type: NodeType;
      text: string;
      status: NodeStatus;
      confidence: number;
      impact: number;
      priority: number | null;
      sourceRefs: string[];
      isCurrentFocusAction: boolean;
      isResolved: boolean;
      createdAt: string | null;
      updatedAt: string | null;
    }>;
    edges: Array<{
      id: string;
      source: { id: string; type: NodeType | null; text: string | null };
      relationship: ClarityEdge['type'];
      target: { id: string; type: NodeType | null; text: string | null };
      confidence: number | null;
    }>;
    topology: {
      connectedComponents: string[][];
      isolatedNodeIds: string[];
      zeroIncomingNodeIds: string[];
      zeroOutgoingNodeIds: string[];
      decisionsWithoutIncomingReasoningOrEvidence: string[];
      decisionsWithoutDownstreamRelationship: string[];
      nodesWithoutGoalPath: string[];
    };
  };
  semanticGraphInterpretation: {
    pathTraversal: 'undirected breadth-first traversal used by the current Why this matters UI';
    nodes: SemanticNodeTrace[];
  };
  currentFocusAnalysis: FocusAnalysisTrace;
  storyBackboneCandidates: {
    nodes: Array<{ nodeId: string; roles: Array<{ role: StoryRole; reason: string }> }>;
    suggestedBackbone: Array<{ nodeId: string; storyRole: StoryRole; selectionReason: string }>;
    omittedNodes: Array<{ nodeId: string; omissionReason: string; proposedParentNodeId: string | null }>;
  };
  collapseExpansionAnalysis: {
    possibleSupportingClusters: Array<{
      parentNodeId: string;
      supportingNodeIds: string[];
      count: number;
      categories: Record<string, number>;
    }>;
    evidenceOrKnownNodeIdsUsedByOnlyOneMajorDecision: string[];
    supportNodesSharedAcrossMajorDecisions: Array<{ nodeId: string; decisionIds: string[] }>;
    resolvedOrHistoricalNodeIdsHideableByDefault: string[];
  };
  whyThisMattersDebug: WhyThisMattersTrace[];
  filterVisibilityTrace: FilterVisibilityTrace[];
  layoutDiagnostics: LayoutDiagnosticsTrace;
  renderedStoryReadabilitySummary: {
    totalNodes: number;
    totalEdges: number;
    visibleNodes: number;
    visibleEdges: number;
    majorDecisions: number;
    unresolvedBlockers: number;
    disconnectedComponents: number;
    isolatedNodes: number;
    nodesWithoutGoalPaths: number;
    currentFocusActionNodeId: string | null;
    currentFocusPrerequisiteCount: number;
    currentFocusDownstreamUnlockCount: number;
    proposedStoryBackboneNodeCount: number;
    collapsibleSupportNodeCount: number;
    resolvedOrHistoricalNodeCount: number;
    filterUsefulness: Array<{ filter: DecisionMapFilter; meaningful: boolean; visibleNodeCount: number; visibleEdgeCount: number; reductionFromAllPercent: number }>;
    layoutWarnings: string[];
  };
}

export interface SemanticNodeTrace {
  nodeId: string;
  directPrerequisiteIds: string[];
  unresolvedPrerequisiteIds: string[];
  directDependentIds: string[];
  informsNodeIds: string[];
  informedByNodeIds: string[];
  blocksNodeIds: string[];
  blockedByNodeIds: string[];
  satisfiesNodeIds: string[];
  satisfiedByNodeIds: string[];
  actionableNow: boolean;
  blocked: boolean;
  terminal: boolean;
  historicalOrResolved: boolean;
  shortestPathsToReachableGoals: PathTrace[];
  strongestUsefulDownstreamPath: DownstreamPathTrace | null;
}

export interface PathTrace {
  goalNodeId: string;
  nodeIds: string[];
  edgeIds: string[];
  hopCount: number;
}

export interface DownstreamPathTrace {
  nodeIds: string[];
  edgeIds: string[];
  endpointNodeId: string;
  endpointReason: string;
}

export interface FocusAnalysisTrace {
  assessment: FocusAssessment | null;
  actionNode: {
    id: string;
    type: NodeType;
    text: string;
    status: NodeStatus;
  } | null;
  unresolvedPrerequisiteIds: string[];
  immediateSupportingEvidenceOrConstraintIds: string[];
  immediateDownstreamNodeIds: string[];
  shortestGoalPath: PathTrace | null;
  strongestDownstreamReasoningPath: DownstreamPathTrace | null;
  visibleInCurrentMap: boolean;
  visibilityReason: string;
}

export type StoryRole =
  | 'goal'
  | 'current_focus'
  | 'prerequisite'
  | 'major_decision'
  | 'blocker'
  | 'key_unknown'
  | 'key_risk'
  | 'key_action'
  | 'downstream_unlock'
  | 'supporting_context'
  | 'historical';

export interface WhyThisMattersTrace {
  selectedNodeId: string;
  pathSearchDirection: 'undirected breadth-first traversal';
  candidateGoalIds: string[];
  pathsConsidered: PathTrace[];
  selectedPath: PathTrace | null;
  selectionReason: string;
  noGoalPathFound: boolean;
  strongestReachableDownstreamPath: DownstreamPathTrace | null;
  endpointsReached: string[];
  whyThatPathIsNotCurrentlyDisplayed: string | null;
}

export interface FilterVisibilityTrace {
  filter: DecisionMapFilter;
  visibleNodeIds: string[];
  hiddenNodeIds: string[];
  visibleEdgeIds: string[];
  nodeReasons: Array<{ nodeId: string; visible: boolean; reason: string }>;
  visibleNodeCount: number;
  visibleEdgeCount: number;
  reductionFromAllPercent: number;
  meaningfullyChangesGraph: boolean;
}

export interface LayoutDiagnosticsTrace {
  renderer: '2d deterministic Decision Map';
  nodes: Array<{
    nodeId: string;
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
    lane: string;
    visible: boolean;
    collapsed: boolean;
    label: { estimatedWidth: number | null; estimatedHeight: number | null; estimatedLineCount: number | null };
  }>;
  graphBoundingBox: { minX: number | null; minY: number | null; maxX: number | null; maxY: number | null; width: number; height: number };
  viewport: { width: number; height: number; mapWidth: number; mapHeight: number };
  initialZoom: number;
  currentZoom: number;
  fitZoom: number;
  horizontalSpan: number;
  verticalSpan: number;
  edgeCrossings: { count: number | null; method: string; skippedReason: string | null };
  overlappingNodes: { count: number; nodePairs: Array<[string, string]> };
  edgesPassingThroughAnotherNode: { count: number | null; edgeIds: string[]; skippedReason: string | null };
  longestEdge: { edgeId: string; length: number } | null;
  averageEdgeLength: number;
  maximumNodeDensityByLane: { lane: string; count: number } | null;
  emptyLanesOrSections: string[];
}

const ACTIONABLE_TYPES = new Set<NodeType>(['DECISION', 'UNKNOWN', 'ASSUMPTION', 'NEXT_ACTION']);
const SUPPORT_TYPES = new Set<NodeType>(['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'RISK', 'PREFERENCE']);
const EDGE_PRIORITY: Record<ClarityEdge['type'], number> = {
  blocks: 0,
  depends_on: 1,
  affects: 2,
  resolves: 3,
  satisfies: 4,
  contradicts: 5,
  supports: 6,
  supersedes: 7,
  informs: 8,
  derived_from: 9,
};

function byId(project: Project): Map<string, ClarityNode> {
  return new Map(project.nodes.map((node) => [node.id, node]));
}

function edgesFor(project: Project, nodeId: string): ClarityEdge[] {
  return project.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}

function otherId(edge: ClarityEdge, nodeId: string): string {
  return edge.source === nodeId ? edge.target : edge.source;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function directPrerequisites(project: Project, nodeId: string): string[] {
  return unique(project.edges.flatMap((edge) => {
    if (edge.type === 'depends_on' && edge.source === nodeId) return [edge.target];
    if (edge.type === 'blocks' && edge.target === nodeId) return [edge.source];
    return [];
  }));
}

function directDependents(project: Project, nodeId: string): string[] {
  return unique(project.edges.flatMap((edge) => {
    if (edge.type === 'depends_on' && edge.target === nodeId) return [edge.source];
    if (edge.type === 'blocks' && edge.source === nodeId) return [edge.target];
    return [];
  }));
}

function pathToGoal(project: Project, startNodeId: string, goalNodeId: string): PathTrace | null {
  if (!project.nodes.some((node) => node.id === startNodeId) || !project.nodes.some((node) => node.id === goalNodeId)) return null;
  if (startNodeId === goalNodeId) return { goalNodeId, nodeIds: [startNodeId], edgeIds: [], hopCount: 0 };

  const queue = [startNodeId];
  const visited = new Set<string>([startNodeId]);
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = edgesFor(project, current)
      .slice()
      .sort((left, right) => EDGE_PRIORITY[left.type] - EDGE_PRIORITY[right.type] || left.id.localeCompare(right.id));
    for (const edge of neighbors) {
      const next = otherId(edge, current);
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, { nodeId: current, edgeId: edge.id });
      if (next === goalNodeId) {
        const nodeIds = [goalNodeId];
        const edgeIds: string[] = [];
        let cursor = goalNodeId;
        while (cursor !== startNodeId) {
          const step = previous.get(cursor);
          if (!step) return null;
          edgeIds.unshift(step.edgeId);
          nodeIds.unshift(step.nodeId);
          cursor = step.nodeId;
        }
        return { goalNodeId, nodeIds, edgeIds, hopCount: edgeIds.length };
      }
      queue.push(next);
    }
  }
  return null;
}

function goalPaths(project: Project, nodeId: string): PathTrace[] {
  return project.nodes
    .filter((node) => node.type === 'GOAL')
    .flatMap((goal) => {
      const path = pathToGoal(project, nodeId, goal.id);
      return path ? [path] : [];
    })
    .sort((left, right) => left.hopCount - right.hopCount || left.goalNodeId.localeCompare(right.goalNodeId));
}

function strongestDownstreamPath(project: Project, nodeId: string): DownstreamPathTrace | null {
  const nodes = byId(project);
  const queue: Array<{ nodeId: string; nodeIds: string[]; edgeIds: string[] }> = [{ nodeId, nodeIds: [nodeId], edgeIds: [] }];
  const paths: Array<{ nodeId: string; nodeIds: string[]; edgeIds: string[] }> = [];
  const visited = new Set<string>([nodeId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const outgoing = project.edges
      .filter((edge) => edge.source === current.nodeId)
      .sort((left, right) => EDGE_PRIORITY[left.type] - EDGE_PRIORITY[right.type] || left.id.localeCompare(right.id));
    if (current.nodeId !== nodeId) paths.push(current);
    outgoing.forEach((edge) => {
      if (visited.has(edge.target)) return;
      visited.add(edge.target);
      queue.push({ nodeId: edge.target, nodeIds: [...current.nodeIds, edge.target], edgeIds: [...current.edgeIds, edge.id] });
    });
  }

  const best = paths
    .map((path) => ({
      ...path,
      node: nodes.get(path.nodeId),
    }))
    .filter((path): path is typeof path & { node: ClarityNode } => Boolean(path.node))
    .sort((left, right) => {
      const leftScore = left.node.impact + (left.node.priority ?? 0) * 0.25 + (ACTIONABLE_TYPES.has(left.node.type) ? 0.15 : 0);
      const rightScore = right.node.impact + (right.node.priority ?? 0) * 0.25 + (ACTIONABLE_TYPES.has(right.node.type) ? 0.15 : 0);
      return rightScore - leftScore || right.edgeIds.length - left.edgeIds.length || left.nodeId.localeCompare(right.nodeId);
    })[0];
  if (!best) return null;
  return {
    nodeIds: best.nodeIds,
    edgeIds: best.edgeIds,
    endpointNodeId: best.nodeId,
    endpointReason: `Selected from persisted outgoing relationships by highest endpoint impact/priority${ACTIONABLE_TYPES.has(best.node.type) ? ' with actionable-node preference' : ''}.`,
  };
}

function components(project: Project): string[][] {
  const remaining = new Set(project.nodes.map((node) => node.id));
  const result: string[][] = [];
  while (remaining.size > 0) {
    const start = [...remaining].sort()[0];
    if (!start) break;
    const component = new Set<string>([start]);
    const queue = [start];
    remaining.delete(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      edgesFor(project, current).forEach((edge) => {
        const next = otherId(edge, current);
        if (component.has(next)) return;
        component.add(next);
        remaining.delete(next);
        queue.push(next);
      });
    }
    result.push([...component].sort());
  }
  return result.sort((left, right) => left[0].localeCompare(right[0]));
}

function isHistorical(node: ClarityNode): boolean {
  return node.status === 'RESOLVED' || node.status === 'DEPRECATED' || node.status === 'DEFERRED';
}

function isActionableNow(project: Project, node: ClarityNode): boolean {
  if (node.status !== 'OPEN' || !ACTIONABLE_TYPES.has(node.type)) return false;
  if (node.type === 'NEXT_ACTION' && isNextActionSatisfied(project, node)) return false;
  return !isNodeBlocked(project, node.id);
}

function visibleForFilter(project: Project, filter: DecisionMapFilter, showSecondaryContext: boolean): FilterVisibilityTrace {
  const includedByFilter = (node: ClarityNode): boolean => {
    if (filter === 'unresolved') return node.type === 'UNKNOWN' && node.status === 'OPEN';
    if (filter === 'critical') return node.type === 'GOAL' || node.type === 'DECISION' || node.type === 'UNKNOWN';
    if (filter === 'assumptions') return node.type === 'ASSUMPTION';
    return true;
  };
  const nodeReasons = project.nodes.map((node) => {
    if (!includedByFilter(node)) {
      const reason = filter === 'unresolved'
        ? 'Excluded: the current Unresolved filter keeps only OPEN UNKNOWN nodes.'
        : filter === 'critical'
          ? 'Excluded: the current Critical path filter keeps GOAL, DECISION, and UNKNOWN nodes.'
          : 'Excluded: the current Assumptions filter keeps ASSUMPTION nodes.';
      return { nodeId: node.id, visible: false, reason };
    }
    if (!showSecondaryContext && isDecisionMapSecondaryNode(node, project)) {
      return { nodeId: node.id, visible: false, reason: 'Collapsed: secondary context is hidden by the renderer default.' };
    }
    return { nodeId: node.id, visible: true, reason: 'Included by the current filter and rendered in the default map view.' };
  });
  const visibleNodeIds = nodeReasons.filter((node) => node.visible).map((node) => node.nodeId);
  const visibleSet = new Set(visibleNodeIds);
  return {
    filter,
    visibleNodeIds,
    hiddenNodeIds: nodeReasons.filter((node) => !node.visible).map((node) => node.nodeId),
    visibleEdgeIds: project.edges.filter((edge) => visibleSet.has(edge.source) && visibleSet.has(edge.target)).map((edge) => edge.id),
    nodeReasons,
    visibleNodeCount: visibleNodeIds.length,
    visibleEdgeCount: project.edges.filter((edge) => visibleSet.has(edge.source) && visibleSet.has(edge.target)).length,
    reductionFromAllPercent: 0,
    meaningfullyChangesGraph: false,
  };
}

function storyRoles(project: Project, node: ClarityNode, focusNodeId: string | null, focusPrerequisites: Set<string>): Array<{ role: StoryRole; reason: string }> {
  const roles: Array<{ role: StoryRole; reason: string }> = [];
  if (node.type === 'GOAL') roles.push({ role: 'goal', reason: 'Persisted node type is GOAL.' });
  if (node.id === focusNodeId) roles.push({ role: 'current_focus', reason: 'Matches FocusAssessment.actionNodeId.' });
  if (focusPrerequisites.has(node.id)) roles.push({ role: 'prerequisite', reason: 'Is an unresolved prerequisite of the current focus under persisted blocks/depends_on edges.' });
  if (node.type === 'DECISION' && node.status === 'OPEN' && (node.impact >= 0.65 || directDependents(project, node.id).length > 0)) {
    roles.push({ role: 'major_decision', reason: 'Open DECISION has material impact or direct dependents.' });
  }
  if (node.type === 'RISK' || project.edges.some((edge) => edge.type === 'blocks' && edge.source === node.id)) {
    roles.push({ role: 'blocker', reason: node.type === 'RISK' ? 'Persisted node type is RISK.' : 'Has a persisted blocks relationship to another node.' });
  }
  if (node.type === 'UNKNOWN' && node.status === 'OPEN') roles.push({ role: 'key_unknown', reason: 'Persisted node is an OPEN UNKNOWN.' });
  if (node.type === 'RISK' && node.status === 'OPEN') roles.push({ role: 'key_risk', reason: 'Persisted node is an OPEN RISK.' });
  if (node.type === 'NEXT_ACTION' && node.status === 'OPEN') roles.push({ role: 'key_action', reason: 'Persisted node is an OPEN NEXT_ACTION.' });
  if (directDependents(project, node.id).some((id) => project.nodes.find((candidate) => candidate.id === id && ACTIONABLE_TYPES.has(candidate.type)))) {
    roles.push({ role: 'downstream_unlock', reason: 'Has an actionable dependent through persisted blocks/depends_on edges.' });
  }
  if (SUPPORT_TYPES.has(node.type)) roles.push({ role: 'supporting_context', reason: `Persisted node type ${node.type} is supporting context.` });
  if (isHistorical(node)) roles.push({ role: 'historical', reason: `Persisted status is ${node.status}.` });
  return roles;
}

function categoryForSupport(node: ClarityNode): string {
  if (node.type === 'KNOWN' || node.type === 'EVIDENCE') return 'evidence';
  if (node.type === 'CONSTRAINT') return 'constraints';
  if (node.type === 'RISK') return 'risks';
  if (node.type === 'PREFERENCE') return 'preferences';
  if (node.type === 'ASSUMPTION' || node.type === 'UNKNOWN') return 'uncertainties';
  return 'other';
}

function boundsForNodes(
  project: Project,
  visibleNodeIds: Set<string>,
  positions: Record<string, ConstellationPoint>,
): { minX: number | null; minY: number | null; maxX: number | null; maxY: number | null; width: number; height: number } {
  const boxes = project.nodes
    .filter((node) => visibleNodeIds.has(node.id) && positions[node.id])
    .map((node) => {
      const point = positions[node.id];
      const dimensions = decisionMapNodeDimensions(node, isDecisionMapSecondaryNode(node, project));
      return { minX: point.x - dimensions.width / 2, maxX: point.x + dimensions.width / 2, minY: point.y - dimensions.height / 2, maxY: point.y + dimensions.height / 2 };
    });
  if (boxes.length === 0) return { minX: null, minY: null, maxX: null, maxY: null, width: 0, height: 0 };
  const minX = Math.min(...boxes.map((box) => box.minX));
  const maxX = Math.max(...boxes.map((box) => box.maxX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  const maxY = Math.max(...boxes.map((box) => box.maxY));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function segmentsIntersect(firstStart: ConstellationPoint, firstEnd: ConstellationPoint, secondStart: ConstellationPoint, secondEnd: ConstellationPoint): boolean {
  const cross = (a: ConstellationPoint, b: ConstellationPoint, c: ConstellationPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const first = cross(firstStart, firstEnd, secondStart);
  const second = cross(firstStart, firstEnd, secondEnd);
  const third = cross(secondStart, secondEnd, firstStart);
  const fourth = cross(secondStart, secondEnd, firstEnd);
  return first * second < 0 && third * fourth < 0;
}

function segmentPassesThroughBox(start: ConstellationPoint, end: ConstellationPoint, point: ConstellationPoint, width: number, height: number): boolean {
  const steps = 24;
  for (let index = 1; index < steps; index += 1) {
    const ratio = index / steps;
    const x = start.x + (end.x - start.x) * ratio;
    const y = start.y + (end.y - start.y) * ratio;
    if (x >= point.x - width / 2 && x <= point.x + width / 2 && y >= point.y - height / 2 && y <= point.y + height / 2) return true;
  }
  return false;
}

function layoutDiagnostics(project: Project, options: DecisionMapDebugOptions, currentVisibility: FilterVisibilityTrace): LayoutDiagnosticsTrace {
  const renderer = options.renderer;
  const fallbackMetrics = calculateDecisionMapMetrics({
    nodes: project.nodes.filter((node) => currentVisibility.visibleNodeIds.includes(node.id)),
    edges: project.edges,
  });
  const positions = renderer?.positions ?? calculateDecisionMapLayout(project);
  const visibleSet = new Set(currentVisibility.visibleNodeIds);
  const graphBoundingBox = boundsForNodes(project, visibleSet, positions);
  const layoutNodes = project.nodes.map((node) => {
    const visible = visibleSet.has(node.id);
    const secondary = isDecisionMapSecondaryNode(node, project);
    const point = positions[node.id];
    const dimensions = point ? decisionMapNodeDimensions(node, secondary) : null;
    const estimatedLineCount = dimensions ? Math.min(6, Math.max(3, Math.ceil(node.text.length / (secondary ? 24 : 42)))) : null;
    const lane = decisionMapLaneForType(node.type);
    return {
      nodeId: node.id,
      x: point?.x ?? null,
      y: point?.y ?? null,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      lane: lane === null ? 'Other context' : `Lane ${lane}: ${['Evidence & known', 'Assumptions & risks', 'Open questions', 'Decisions & actions', 'Goal'][lane]}`,
      visible,
      collapsed: !visible && secondary && options.renderer?.showSecondaryContext === false,
      label: {
        estimatedWidth: dimensions ? Math.max(0, dimensions.width - 24) : null,
        estimatedHeight: dimensions ? Math.max(0, dimensions.height - 42) : null,
        estimatedLineCount,
      },
    };
  });
  const visibleEdges = project.edges.filter((edge) => visibleSet.has(edge.source) && visibleSet.has(edge.target) && positions[edge.source] && positions[edge.target]);
  const edgeLengths = visibleEdges.map((edge) => ({ edgeId: edge.id, length: Math.hypot(positions[edge.source].x - positions[edge.target].x, positions[edge.source].y - positions[edge.target].y) }));
  const geometryLimit = 120;
  const canInspectGeometry = visibleEdges.length <= geometryLimit;
  let crossingCount: number | null = null;
  let edgesThroughNodes: string[] = [];
  if (canInspectGeometry) {
    crossingCount = 0;
    for (let first = 0; first < visibleEdges.length; first += 1) {
      for (let second = first + 1; second < visibleEdges.length; second += 1) {
        const left = visibleEdges[first];
        const right = visibleEdges[second];
        if (left.source === right.source || left.source === right.target || left.target === right.source || left.target === right.target) continue;
        if (segmentsIntersect(positions[left.source], positions[left.target], positions[right.source], positions[right.target])) crossingCount += 1;
      }
    }
    edgesThroughNodes = visibleEdges.flatMap((edge) => project.nodes.some((node) => {
      if (!visibleSet.has(node.id) || node.id === edge.source || node.id === edge.target || !positions[node.id]) return false;
      const dimensions = decisionMapNodeDimensions(node, isDecisionMapSecondaryNode(node, project));
      return segmentPassesThroughBox(positions[edge.source], positions[edge.target], positions[node.id], dimensions.width, dimensions.height);
    }) ? [edge.id] : []);
  }
  const overlapPairs: Array<[string, string]> = [];
  const visibleNodes = project.nodes.filter((node) => visibleSet.has(node.id) && positions[node.id]);
  for (let first = 0; first < visibleNodes.length; first += 1) {
    for (let second = first + 1; second < visibleNodes.length; second += 1) {
      const left = visibleNodes[first];
      const right = visibleNodes[second];
      const leftPoint = positions[left.id];
      const rightPoint = positions[right.id];
      const leftDimensions = decisionMapNodeDimensions(left, isDecisionMapSecondaryNode(left, project));
      const rightDimensions = decisionMapNodeDimensions(right, isDecisionMapSecondaryNode(right, project));
      if (Math.abs(leftPoint.x - rightPoint.x) < (leftDimensions.width + rightDimensions.width) / 2 && Math.abs(leftPoint.y - rightPoint.y) < (leftDimensions.height + rightDimensions.height) / 2) overlapPairs.push([left.id, right.id]);
    }
  }
  const laneCounts = ([0, 1, 2, 3, 4] as DecisionMapLane[]).map((lane) => ({ lane: `Lane ${lane}: ${['Evidence & known', 'Assumptions & risks', 'Open questions', 'Decisions & actions', 'Goal'][lane]}`, count: visibleNodes.filter((node) => decisionMapLaneForType(node.type) === lane).length }));
  const maxDensity = laneCounts.slice().sort((left, right) => right.count - left.count || left.lane.localeCompare(right.lane))[0] ?? null;
  const fitZoom = graphBoundingBox.width === 0 || graphBoundingBox.height === 0
    ? 1
    : Math.max(0.72, Math.min(2.2, Math.min(Math.max(1, (renderer?.mapWidth ?? fallbackMetrics.width) - 144) / graphBoundingBox.width, Math.max(1, (renderer?.mapHeight ?? fallbackMetrics.height) - 144) / graphBoundingBox.height)));
  return {
    renderer: '2d deterministic Decision Map',
    nodes: layoutNodes,
    graphBoundingBox,
    viewport: {
      width: renderer?.viewport.width ?? 0,
      height: renderer?.viewport.height ?? 0,
      mapWidth: renderer?.mapWidth ?? fallbackMetrics.width,
      mapHeight: renderer?.mapHeight ?? fallbackMetrics.height,
    },
    initialZoom: 1,
    currentZoom: renderer?.zoom ?? 1,
    fitZoom,
    horizontalSpan: graphBoundingBox.width,
    verticalSpan: graphBoundingBox.height,
    edgeCrossings: { count: crossingCount, method: 'Straight center-to-center segment approximation; renderer uses curved SVG edges.', skippedReason: canInspectGeometry ? null : `Skipped because ${visibleEdges.length} visible edges exceeds the ${geometryLimit}-edge debug limit.` },
    overlappingNodes: { count: overlapPairs.length, nodePairs: overlapPairs },
    edgesPassingThroughAnotherNode: { count: canInspectGeometry ? edgesThroughNodes.length : null, edgeIds: edgesThroughNodes, skippedReason: canInspectGeometry ? null : `Skipped because ${visibleEdges.length} visible edges exceeds the ${geometryLimit}-edge debug limit.` },
    longestEdge: edgeLengths.sort((left, right) => right.length - left.length || left.edgeId.localeCompare(right.edgeId))[0] ?? null,
    averageEdgeLength: edgeLengths.length ? edgeLengths.reduce((total, edge) => total + edge.length, 0) / edgeLengths.length : 0,
    maximumNodeDensityByLane: maxDensity,
    emptyLanesOrSections: laneCounts.filter((lane) => lane.count === 0).map((lane) => lane.lane).concat(project.nodes.some((node) => isDecisionMapSecondaryNode(node, project)) ? [] : ['Other context']),
  };
}

/**
 * Produces an inspectable, deterministic explanation of the current map. It
 * never writes to the graph or calls an LLM; it only reads persisted edges and
 * renderer diagnostics supplied by the active 2D map.
 */
export function buildDecisionMapDebugTrace(project: Project, options: DecisionMapDebugOptions): DecisionMapDebugTrace {
  const nodes = byId(project);
  const focusAssessment = options.focusAssessment ?? null;
  const focusNodeId = focusAssessment?.actionNodeId ?? null;
  const focusPrerequisites = new Set(focusNodeId ? getUnresolvedPrerequisites(project, focusNodeId).map((node) => node.id) : []);
  const showSecondaryContext = options.renderer?.showSecondaryContext ?? false;
  const rawComponents = components(project);
  const goalPathByNode = new Map(project.nodes.map((node) => [node.id, goalPaths(project, node.id)]));
  const filterTraces = (['all', 'unresolved', 'critical', 'assumptions'] as DecisionMapFilter[]).map((filter) => visibleForFilter(project, filter, showSecondaryContext));
  const allFilter = filterTraces.find((trace) => trace.filter === 'all')!;
  filterTraces.forEach((trace) => {
    trace.reductionFromAllPercent = allFilter.visibleNodeCount === 0 ? 0 : Number((((allFilter.visibleNodeCount - trace.visibleNodeCount) / allFilter.visibleNodeCount) * 100).toFixed(2));
    trace.meaningfullyChangesGraph = trace.visibleNodeCount !== allFilter.visibleNodeCount || trace.visibleEdgeCount !== allFilter.visibleEdgeCount;
  });
  const currentVisibility = filterTraces.find((trace) => trace.filter === options.filter)!;
  const visibleSet = new Set(currentVisibility.visibleNodeIds);
  const semanticNodes: SemanticNodeTrace[] = project.nodes.map((node) => {
    const directPaths = goalPathByNode.get(node.id) ?? [];
    return {
      nodeId: node.id,
      directPrerequisiteIds: directPrerequisites(project, node.id),
      unresolvedPrerequisiteIds: getUnresolvedPrerequisites(project, node.id).map((item) => item.id),
      directDependentIds: directDependents(project, node.id),
      informsNodeIds: project.edges.filter((edge) => edge.type === 'informs' && edge.source === node.id).map((edge) => edge.target),
      informedByNodeIds: project.edges.filter((edge) => edge.type === 'informs' && edge.target === node.id).map((edge) => edge.source),
      blocksNodeIds: project.edges.filter((edge) => edge.type === 'blocks' && edge.source === node.id).map((edge) => edge.target),
      blockedByNodeIds: project.edges.filter((edge) => edge.type === 'blocks' && edge.target === node.id).map((edge) => edge.source),
      satisfiesNodeIds: project.edges.filter((edge) => edge.type === 'satisfies' && edge.source === node.id).map((edge) => edge.target),
      satisfiedByNodeIds: project.edges.filter((edge) => edge.type === 'satisfies' && edge.target === node.id).map((edge) => edge.source),
      actionableNow: isActionableNow(project, node),
      blocked: isNodeBlocked(project, node.id),
      terminal: !project.edges.some((edge) => edge.source === node.id),
      historicalOrResolved: isHistorical(node),
      shortestPathsToReachableGoals: directPaths,
      strongestUsefulDownstreamPath: directPaths.length === 0 ? strongestDownstreamPath(project, node.id) : null,
    };
  });
  const focusNode = focusNodeId ? nodes.get(focusNodeId) ?? null : null;
  const focusPaths = focusNodeId ? goalPathByNode.get(focusNodeId) ?? [] : [];
  const focusSupporting = focusNodeId
    ? edgesFor(project, focusNodeId)
      .map((edge) => nodes.get(otherId(edge, focusNodeId)))
      .filter((node): node is ClarityNode => Boolean(node && ['KNOWN', 'EVIDENCE', 'CONSTRAINT'].includes(node.type)))
      .map((node) => node.id)
    : [];
  const focusDownstream = focusNodeId ? directDependents(project, focusNodeId) : [];
  const rolesByNode = project.nodes.map((node) => ({ nodeId: node.id, roles: storyRoles(project, node, focusNodeId, focusPrerequisites) }));
  const rolePreference: StoryRole[] = ['goal', 'current_focus', 'prerequisite', 'major_decision', 'blocker', 'key_unknown', 'key_risk', 'key_action', 'downstream_unlock', 'supporting_context', 'historical'];
  const backbone: Array<{ nodeId: string; storyRole: StoryRole; selectionReason: string }> = [];
  rolePreference.forEach((role) => {
    rolesByNode
      .filter((entry) => entry.roles.some((candidate) => candidate.role === role))
      .sort((left, right) => {
        const leftNode = nodes.get(left.nodeId)!;
        const rightNode = nodes.get(right.nodeId)!;
        return (rightNode.impact - leftNode.impact) || ((rightNode.priority ?? 0) - (leftNode.priority ?? 0)) || left.nodeId.localeCompare(right.nodeId);
      })
      .forEach((entry) => {
        if (backbone.length >= 8 || backbone.some((selected) => selected.nodeId === entry.nodeId)) return;
        const reason = entry.roles.find((candidate) => candidate.role === role)?.reason ?? 'Selected from persisted graph structure.';
        backbone.push({ nodeId: entry.nodeId, storyRole: role, selectionReason: reason });
      });
  });
  const backboneIds = new Set(backbone.map((entry) => entry.nodeId));
  const majorDecisionIds = project.nodes.filter((node) => node.type === 'DECISION' && node.status === 'OPEN' && (node.impact >= 0.65 || directDependents(project, node.id).length > 0)).map((node) => node.id);
  const supportUse = new Map<string, string[]>();
  const clusters = unique([...(focusNodeId ? [focusNodeId] : []), ...majorDecisionIds]).flatMap((parentNodeId) => {
    const supportingNodeIds = unique(edgesFor(project, parentNodeId)
      .map((edge) => otherId(edge, parentNodeId))
      .filter((nodeId) => SUPPORT_TYPES.has(nodes.get(nodeId)?.type ?? 'GOAL')));
    supportingNodeIds.forEach((nodeId) => supportUse.set(nodeId, [...(supportUse.get(nodeId) ?? []), parentNodeId]));
    const categories = supportingNodeIds.reduce<Record<string, number>>((result, nodeId) => {
      const node = nodes.get(nodeId);
      if (!node) return result;
      const category = categoryForSupport(node);
      result[category] = (result[category] ?? 0) + 1;
      return result;
    }, {});
    return [{ parentNodeId, supportingNodeIds, count: supportingNodeIds.length, categories }];
  });
  const whyThisMatters = project.nodes
    .filter((node) => !isDecisionMapSecondaryNode(node, project))
    .map((node) => {
      const paths = goalPathByNode.get(node.id) ?? [];
      const selectedPath = paths[0] ?? null;
      const downstream = selectedPath ? null : strongestDownstreamPath(project, node.id);
      return {
        selectedNodeId: node.id,
        pathSearchDirection: 'undirected breadth-first traversal' as const,
        candidateGoalIds: project.nodes.filter((candidate) => candidate.type === 'GOAL').map((candidate) => candidate.id),
        pathsConsidered: paths,
        selectedPath,
        selectionReason: selectedPath
          ? `Selected shortest path with ${selectedPath.hopCount} relationship hop${selectedPath.hopCount === 1 ? '' : 's'}; relationship priority only breaks same-depth traversal ties.`
          : 'No persisted undirected relationship path reaches a GOAL node.',
        noGoalPathFound: !selectedPath,
        strongestReachableDownstreamPath: downstream,
        endpointsReached: downstream ? [downstream.endpointNodeId] : [],
        whyThatPathIsNotCurrentlyDisplayed: downstream ? 'The current Why this matters UI only displays a connected GOAL path; it does not render non-goal downstream paths.' : null,
      };
    });
  const computedLayout = layoutDiagnostics(project, options, currentVisibility);
  const layoutWarnings = [
    ...(computedLayout.overlappingNodes.count > 0 ? [`${computedLayout.overlappingNodes.count} overlapping node pair${computedLayout.overlappingNodes.count === 1 ? '' : 's'} detected.`] : []),
    ...(computedLayout.edgeCrossings.count && computedLayout.edgeCrossings.count > 0 ? [`${computedLayout.edgeCrossings.count} approximate edge crossing${computedLayout.edgeCrossings.count === 1 ? '' : 's'} detected.`] : []),
    ...(computedLayout.edgesPassingThroughAnotherNode.count && computedLayout.edgesPassingThroughAnotherNode.count > 0 ? [`${computedLayout.edgesPassingThroughAnotherNode.count} edge${computedLayout.edgesPassingThroughAnotherNode.count === 1 ? '' : 's'} may pass through another node.`] : []),
    ...(computedLayout.emptyLanesOrSections.length > 0 ? [`Empty sections: ${computedLayout.emptyLanesOrSections.join(', ')}.`] : []),
  ];
  return {
    schemaVersion: 1,
    projectId: project.id,
    capturedAt: new Date().toISOString(),
    render: { filter: options.filter, selectedNodeId: options.selectedNodeId, focusMode: options.focusMode, pathMode: options.pathMode, rendererReported: Boolean(options.renderer) },
    rawProjectGraph: {
      projectId: project.id,
      focusAssessment,
      totalNodes: project.nodes.length,
      totalEdges: project.edges.length,
      nodes: project.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        text: node.text,
        status: node.status,
        confidence: node.confidence,
        impact: node.impact,
        priority: node.priority ?? null,
        sourceRefs: node.source_refs,
        isCurrentFocusAction: node.id === focusNodeId,
        isResolved: node.status === 'RESOLVED',
        createdAt: node.created_at ?? null,
        updatedAt: node.updated_at ?? null,
      })),
      edges: project.edges.map((edge) => ({
        id: edge.id,
        source: { id: edge.source, type: nodes.get(edge.source)?.type ?? null, text: nodes.get(edge.source)?.text ?? null },
        relationship: edge.type,
        target: { id: edge.target, type: nodes.get(edge.target)?.type ?? null, text: nodes.get(edge.target)?.text ?? null },
        confidence: edge.confidence ?? null,
      })),
      topology: {
        connectedComponents: rawComponents,
        isolatedNodeIds: project.nodes.filter((node) => edgesFor(project, node.id).length === 0).map((node) => node.id),
        zeroIncomingNodeIds: project.nodes.filter((node) => !project.edges.some((edge) => edge.target === node.id)).map((node) => node.id),
        zeroOutgoingNodeIds: project.nodes.filter((node) => !project.edges.some((edge) => edge.source === node.id)).map((node) => node.id),
        decisionsWithoutIncomingReasoningOrEvidence: project.nodes.filter((node) => node.type === 'DECISION' && !project.edges.some((edge) => edge.target === node.id)).map((node) => node.id),
        decisionsWithoutDownstreamRelationship: project.nodes.filter((node) => node.type === 'DECISION' && !project.edges.some((edge) => edge.source === node.id)).map((node) => node.id),
        nodesWithoutGoalPath: project.nodes.filter((node) => (goalPathByNode.get(node.id) ?? []).length === 0).map((node) => node.id),
      },
    },
    semanticGraphInterpretation: { pathTraversal: 'undirected breadth-first traversal used by the current Why this matters UI', nodes: semanticNodes },
    currentFocusAnalysis: {
      assessment: focusAssessment,
      actionNode: focusNode ? { id: focusNode.id, type: focusNode.type, text: focusNode.text, status: focusNode.status } : null,
      unresolvedPrerequisiteIds: focusNode ? getUnresolvedPrerequisites(project, focusNode.id).map((node) => node.id) : [],
      immediateSupportingEvidenceOrConstraintIds: unique(focusSupporting),
      immediateDownstreamNodeIds: focusDownstream,
      shortestGoalPath: focusPaths[0] ?? null,
      strongestDownstreamReasoningPath: focusNode && focusPaths.length === 0 ? strongestDownstreamPath(project, focusNode.id) : null,
      visibleInCurrentMap: Boolean(focusNode && visibleSet.has(focusNode.id)),
      visibilityReason: !focusAssessment
        ? 'No cached FocusAssessment was available when this map trace was captured.'
        : !focusNode
          ? 'FocusAssessment.actionNodeId does not resolve to a node in the rendered project graph.'
          : visibleSet.has(focusNode.id)
            ? 'The focus action node is included by the active filter and is not collapsed as secondary context.'
            : currentVisibility.nodeReasons.find((entry) => entry.nodeId === focusNode.id)?.reason ?? 'The focus action node is not visible in the active map view.',
    },
    storyBackboneCandidates: {
      nodes: rolesByNode,
      suggestedBackbone: backbone,
      omittedNodes: project.nodes.filter((node) => !backboneIds.has(node.id)).map((node) => {
        const directParent = edgesFor(project, node.id)
          .map((edge) => otherId(edge, node.id))
          .find((nodeId) => backboneIds.has(nodeId)) ?? null;
        const roles = rolesByNode.find((entry) => entry.nodeId === node.id)?.roles ?? [];
        return {
          nodeId: node.id,
          omissionReason: roles.length === 0
            ? 'No story role qualifies from the persisted graph structure.'
            : backbone.length >= 8
              ? 'Backbone is capped at eight nodes; this qualifying node remains supporting context.'
              : 'A higher-priority story role already represents this branch.',
          proposedParentNodeId: directParent,
        };
      }),
    },
    collapseExpansionAnalysis: {
      possibleSupportingClusters: clusters,
      evidenceOrKnownNodeIdsUsedByOnlyOneMajorDecision: [...supportUse.entries()]
        .filter(([nodeId, parentIds]) => parentIds.length === 1 && ['KNOWN', 'EVIDENCE'].includes(nodes.get(nodeId)?.type ?? ''))
        .map(([nodeId]) => nodeId)
        .sort(),
      supportNodesSharedAcrossMajorDecisions: [...supportUse.entries()].filter(([, parentIds]) => parentIds.length > 1).map(([nodeId, decisionIds]) => ({ nodeId, decisionIds: unique(decisionIds) })).sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
      resolvedOrHistoricalNodeIdsHideableByDefault: project.nodes.filter(isHistorical).map((node) => node.id),
    },
    whyThisMattersDebug: whyThisMatters,
    filterVisibilityTrace: filterTraces,
    layoutDiagnostics: computedLayout,
    renderedStoryReadabilitySummary: {
      totalNodes: project.nodes.length,
      totalEdges: project.edges.length,
      visibleNodes: currentVisibility.visibleNodeCount,
      visibleEdges: currentVisibility.visibleEdgeCount,
      majorDecisions: majorDecisionIds.length,
      unresolvedBlockers: project.nodes.filter((node) => node.status === 'OPEN' && (node.type === 'RISK' || project.edges.some((edge) => edge.type === 'blocks' && edge.source === node.id))).length,
      disconnectedComponents: rawComponents.length,
      isolatedNodes: project.nodes.filter((node) => edgesFor(project, node.id).length === 0).length,
      nodesWithoutGoalPaths: project.nodes.filter((node) => (goalPathByNode.get(node.id) ?? []).length === 0).length,
      currentFocusActionNodeId: focusNodeId,
      currentFocusPrerequisiteCount: focusNode ? getUnresolvedPrerequisites(project, focusNode.id).length : 0,
      currentFocusDownstreamUnlockCount: focusDownstream.length,
      proposedStoryBackboneNodeCount: backbone.length,
      collapsibleSupportNodeCount: [...supportUse.keys()].length,
      resolvedOrHistoricalNodeCount: project.nodes.filter(isHistorical).length,
      filterUsefulness: filterTraces.map((trace) => ({ filter: trace.filter, meaningful: trace.meaningfullyChangesGraph, visibleNodeCount: trace.visibleNodeCount, visibleEdgeCount: trace.visibleEdgeCount, reductionFromAllPercent: trace.reductionFromAllPercent })),
      layoutWarnings,
    },
  };
}
