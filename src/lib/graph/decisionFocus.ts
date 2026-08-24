import type { ClarityEdge, ClarityNode, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { buildDecisionStoryEdges } from '@/lib/graph/decisionStory';

export interface DecisionNodeFocus {
  node: ClarityNode;
  inputs: ClarityNode[];
  prerequisites: ClarityNode[];
  nextActions: ClarityNode[];
  downstream: ClarityNode[];
  risks: ClarityNode[];
  goalPath: ClarityNode[];
}

const INPUT_TYPES = new Set<ClarityNode['type']>([
  'KNOWN',
  'EVIDENCE',
  'CONSTRAINT',
  'PREFERENCE',
]);

function nodeMap(project: Project): Map<string, ClarityNode> {
  return new Map(project.nodes.map((node) => [node.id, node]));
}

function sortByProjectOrder(project: Project, nodeIds: Set<string>): ClarityNode[] {
  return project.nodes.filter((node) => nodeIds.has(node.id));
}

function connectedNode(
  edge: ClarityEdge,
  nodeId: string,
  nodes: Map<string, ClarityNode>,
): ClarityNode | undefined {
  return nodes.get(edge.source === nodeId ? edge.target : edge.source);
}

function focusInputs(project: Project, node: ClarityNode, nodes: Map<string, ClarityNode>): ClarityNode[] {
  const ids = new Set<string>();
  project.edges.forEach((edge) => {
    const other = connectedNode(edge, node.id, nodes);
    if (!other || !INPUT_TYPES.has(other.type)) return;

    const isIncomingInfluence = edge.target === node.id && ['informs', 'affects', 'supports'].includes(edge.type);
    const isSupportingContext = edge.source === node.id && ['informs', 'affects', 'supports'].includes(edge.type);
    if (isIncomingInfluence || isSupportingContext) ids.add(other.id);
  });
  return sortByProjectOrder(project, ids);
}

function focusPrerequisites(project: Project, node: ClarityNode, nodes: Map<string, ClarityNode>): ClarityNode[] {
  const ids = new Set<string>();
  project.edges.forEach((edge) => {
    if (edge.type === 'depends_on' && edge.source === node.id) {
      const prerequisite = nodes.get(edge.target);
      if (prerequisite) ids.add(prerequisite.id);
    }
    if (edge.type === 'blocks' && edge.target === node.id) {
      const prerequisite = nodes.get(edge.source);
      if (prerequisite) ids.add(prerequisite.id);
    }
  });
  return sortByProjectOrder(project, ids);
}

function focusNextActions(project: Project, node: ClarityNode, nodes: Map<string, ClarityNode>): ClarityNode[] {
  const ids = new Set<string>();
  project.edges.forEach((edge) => {
    if (edge.type !== 'satisfies' || edge.target !== node.id) return;
    const action = nodes.get(edge.source);
    if (action?.type === 'NEXT_ACTION') ids.add(action.id);
  });
  return sortByProjectOrder(project, ids);
}

function focusDownstream(project: Project, node: ClarityNode, nodes: Map<string, ClarityNode>): ClarityNode[] {
  const ids = new Set<string>();
  const forwardActions = new Set(
    project.edges
      .filter((edge) => edge.type === 'satisfies' && edge.target === node.id)
      .map((edge) => edge.source),
  );
  project.edges.forEach((edge) => {
    if (edge.type === 'depends_on' && edge.target === node.id) {
      const dependent = nodes.get(edge.source);
      if (dependent && !(dependent.type === 'NEXT_ACTION' && forwardActions.has(dependent.id))) {
        ids.add(dependent.id);
      }
    }
    if (edge.type === 'blocks' && edge.source === node.id) {
      const dependent = nodes.get(edge.target);
      if (dependent) ids.add(dependent.id);
    }
  });
  return sortByProjectOrder(project, ids);
}

function focusRisks(project: Project, node: ClarityNode, nodes: Map<string, ClarityNode>): ClarityNode[] {
  const ids = new Set<string>();
  project.edges.forEach((edge) => {
    if (!['affects', 'blocks', 'informs', 'supports'].includes(edge.type)) return;
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const risk = source?.type === 'RISK' ? source : target?.type === 'RISK' ? target : undefined;
    const other = risk?.id === source?.id ? target : source;
    if (risk?.status === 'OPEN' && other?.id === node.id) ids.add(risk.id);
  });
  return sortByProjectOrder(project, ids);
}

function focusGoalPath(project: Project, node: ClarityNode): ClarityNode[] {
  const storyNodeIds = project.nodes
    .filter((candidate) => ['GOAL', 'DECISION', 'UNKNOWN', 'ASSUMPTION', 'NEXT_ACTION', 'EXPERIMENT'].includes(candidate.type))
    .map((candidate) => candidate.id);
  const edges = buildDecisionStoryEdges(project, { visibleNodeIds: storyNodeIds });
  const goals = new Set(project.nodes.filter((candidate) => candidate.type === 'GOAL').map((candidate) => candidate.id));
  if (goals.has(node.id)) return [];

  const queue: Array<{ id: string; path: string[] }> = [{ id: node.id, path: [] }];
  const visited = new Set([node.id]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const edge of edges.filter((candidate) => candidate.source === current.id)) {
      if (visited.has(edge.target)) continue;
      const nextPath = [...current.path, edge.target];
      if (goals.has(edge.target)) {
        const map = nodeMap(project);
        return nextPath.flatMap((id) => {
          const candidate = map.get(id);
          return candidate ? [candidate] : [];
        });
      }
      visited.add(edge.target);
      queue.push({ id: edge.target, path: nextPath });
    }
  }
  return [];
}

export function buildDecisionNodeFocus(
  project: Project,
  nodeId: string,
  _focusAssessment?: FocusAssessment | null,
): DecisionNodeFocus | null {
  const nodes = nodeMap(project);
  const node = nodes.get(nodeId);
  if (!node) return null;

  return {
    node,
    inputs: focusInputs(project, node, nodes),
    prerequisites: focusPrerequisites(project, node, nodes),
    nextActions: focusNextActions(project, node, nodes),
    downstream: focusDownstream(project, node, nodes),
    risks: focusRisks(project, node, nodes),
    goalPath: focusGoalPath(project, node),
  };
}
