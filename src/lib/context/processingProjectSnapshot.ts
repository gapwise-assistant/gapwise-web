import type { ClarityNode, EdgeType, NodeType, Project } from '@/types/clarity';
import { canonicalOpenQuestions } from '@/lib/questions/canonical';

/**
 * The project state embedded in a processing diagnostic.
 *
 * This is deliberately a semantic projection rather than a Project clone. In
 * particular, sources and their processing logs are not part of this shape.
 */
export interface ProcessingProjectSnapshot {
  project_id: string;
  project_title: string;
  project_goal: string;
  deadline: string | null;
  important_nodes: Array<{
    id: string;
    type: NodeType;
    text: string;
    status: ClarityNode['status'];
    confidence: number;
    impact: number;
    decision_outcome?: string;
  }>;
  unresolved_gaps: Array<{
    id: string;
    type: NodeType;
    text: string;
    status: ClarityNode['status'];
    confidence: number;
    impact: number;
    decision_outcome?: string;
  }>;
  canonical_questions: Array<{
    id: string;
    text: string;
    status: ClarityNode['status'];
    type: NodeType;
  }>;
  important_edges: Array<{
    source: string;
    target: string;
    type: EdgeType;
    confidence: number | null;
  }>;
}

const STRUCTURAL_TYPES = new Set<ClarityNode['type']>([
  'GOAL',
  'UNKNOWN',
  'ASSUMPTION',
  'DECISION',
  'CONSTRAINT',
  'RISK',
  'NEXT_ACTION',
]);

const CONTEXTUAL_TYPES = new Set<ClarityNode['type']>([
  'KNOWN',
  'EVIDENCE',
  'PREFERENCE',
]);

const CANDIDATE_TYPES = new Set([
  ...STRUCTURAL_TYPES,
  ...CONTEXTUAL_TYPES,
]);

const IGNORED_TOKENS = new Set([
  'what', 'where', 'when', 'which', 'who', 'how', 'why', 'does', 'could',
  'would', 'should', 'are', 'the', 'and', 'for', 'from', 'with', 'this',
  'that', 'about', 'into', 'your', 'you', 'can', 'will', 'have', 'need',
  'know',
]);

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length >= 4 && !IGNORED_TOKENS.has(token)),
  );
}

function compactNode(node: ClarityNode): ProcessingProjectSnapshot['important_nodes'][number] {
  return {
    id: node.id,
    type: node.type,
    text: node.text,
    status: node.status,
    confidence: node.confidence,
    impact: node.impact,
    ...(node.decision_outcome ? { decision_outcome: node.decision_outcome } : {}),
  };
}

/**
 * Build a bounded, JSON-safe semantic snapshot for model diagnostics.
 * `query` only controls relevance ordering; it is never persisted as project
 * state and does not cause source data or processing metadata to be included.
 */
export function buildProcessingProjectSnapshot(
  project: Project,
  query = '',
): ProcessingProjectSnapshot {
  const queryTokens = meaningfulTokens(query);
  const relevanceFor = (node: ClarityNode): number => {
    if (!queryTokens.size) return node.impact * node.confidence;
    const nodeTokens = meaningfulTokens(
      `${node.text} ${node.why_it_matters?.join(' ') ?? ''}`,
    );
    return [...nodeTokens].filter((token) => queryTokens.has(token)).length;
  };
  const compareNodes = (left: ClarityNode, right: ClarityNode): number =>
    relevanceFor(right) - relevanceFor(left)
    || (right.impact * right.confidence) - (left.impact * left.confidence)
    || left.id.localeCompare(right.id);

  const validNodes = project.nodes.filter(
    (node) => node.status !== 'DEPRECATED' && CANDIDATE_TYPES.has(node.type),
  );
  const rankedStructural = validNodes
    .filter((node) => STRUCTURAL_TYPES.has(node.type))
    .sort(compareNodes);
  const rankedContextual = validNodes
    .filter((node) => CONTEXTUAL_TYPES.has(node.type))
    .sort(compareNodes);

  const selectedNodes: ClarityNode[] = [];
  const addSelected = (node: ClarityNode | undefined): void => {
    if (!node || selectedNodes.some((candidate) => candidate.id === node.id)) return;
    selectedNodes.push(node);
  };

  // Keep gaps and decisions represented, then add the context that explains
  // them. The cap bounds the prompt without embedding the whole Project.
  rankedStructural.slice(0, 10).forEach(addSelected);
  rankedStructural.filter((node) => node.status === 'OPEN').slice(0, 8).forEach(addSelected);
  rankedStructural
    .filter((node) => node.type === 'GOAL' || node.type === 'DECISION')
    .slice(0, 5)
    .forEach(addSelected);
  rankedContextual.slice(0, 8).forEach(addSelected);

  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  project.edges
    .filter((edge) => selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target))
    .map((edge) => project.nodes.find(
      (node) => node.id === (selectedNodeIds.has(edge.source) ? edge.target : edge.source),
    ))
    .filter(
      (node): node is ClarityNode =>
        node !== undefined
        && node.status !== 'DEPRECATED'
        && CANDIDATE_TYPES.has(node.type),
    )
    .sort(compareNodes)
    .forEach(addSelected);

  const importantGraphNodes = selectedNodes.slice(0, 24);
  const importantNodeIds = new Set(importantGraphNodes.map((node) => node.id));
  const importantEdges = project.edges
    .filter((edge) => importantNodeIds.has(edge.source) && importantNodeIds.has(edge.target))
    .slice(0, 24)
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      confidence: edge.confidence ?? null,
    }));

  return {
    project_id: project.id,
    project_title: project.title,
    project_goal: project.goal,
    deadline: project.deadline ?? null,
    important_nodes: importantGraphNodes.map(compactNode),
    unresolved_gaps: project.nodes
      .filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN')
      .slice(0, 8)
      .map(compactNode),
    canonical_questions: canonicalOpenQuestions(project)
      .slice(0, 12)
      .map((node) => ({
        id: node.id,
        text: node.text,
        status: node.status,
        type: node.type,
      })),
    important_edges: importantEdges,
  };
}

export function serializeProcessingProjectSnapshot(
  project: Project,
  query = '',
): string {
  return JSON.stringify(buildProcessingProjectSnapshot(project, query));
}
