import type { ClarityEdge, ClarityNode, EdgeType, Project } from '@/types/clarity';
import type { AskGraphContext, EvidenceExcerpt } from '@/types/contextPack';
import { projectForReasoning } from '@/lib/context/sourceState';
import { relevanceScore, tokenize } from '@/lib/retrieval/relevance';

export type ProjectReasoningMode =
  | 'factual'
  | 'reasoning'
  | 'impact'
  | 'decision'
  | 'focus';

export interface ProjectReasoningLimits {
  seedNodes: number;
  directNeighbors: number;
  secondHopNodes: number;
  totalNodes: number;
  sources: number;
}

const DEFAULT_LIMITS: ProjectReasoningLimits = {
  seedNodes: 5,
  directNeighbors: 5,
  secondHopNodes: 3,
  totalNodes: 12,
  sources: 6,
};

const TRAVERSABLE_RELATIONSHIPS = new Set<EdgeType>([
  'informs',
  'supports',
  'contradicts',
  'depends_on',
  'blocks',
  'affects',
  'resolves',
  'satisfies',
]);

const OPEN_ACTIONABLE_TYPES = new Set<ClarityNode['type']>([
  'DECISION',
  'UNKNOWN',
  'ASSUMPTION',
  'RISK',
  'NEXT_ACTION',
]);

function nodeSearchText(node: ClarityNode): string {
  return `${node.type} ${node.text} ${node.why_it_matters?.join(' ') ?? ''}`;
}

function modeTypeBonus(mode: ProjectReasoningMode, node: ClarityNode): number {
  if (mode === 'decision' && ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'CONSTRAINT', 'EVIDENCE'].includes(node.type)) return 0.18;
  if (mode === 'impact' && ['RISK', 'CONSTRAINT', 'DECISION', 'UNKNOWN'].includes(node.type)) return 0.18;
  if (mode === 'focus' && OPEN_ACTIONABLE_TYPES.has(node.type) && node.status === 'OPEN') return 0.22;
  if (mode === 'factual' && ['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'DECISION'].includes(node.type)) return 0.12;
  return 0;
}

function nodeScore(query: string, node: ClarityNode, mode: ProjectReasoningMode): number {
  const relevance = relevanceScore(query, nodeSearchText(node));
  const openBonus = node.status === 'OPEN' && OPEN_ACTIONABLE_TYPES.has(node.type) ? 0.12 : 0;
  const priority = (node.priority ?? node.impact) * 0.1;
  return relevance + openBonus + priority + modeTypeBonus(mode, node);
}

function compareScoredNodes(
  left: { node: ClarityNode; score: number },
  right: { node: ClarityNode; score: number },
): number {
  return right.score - left.score
    || right.node.impact * right.node.confidence - left.node.impact * left.node.confidence
    || right.node.updated_at.localeCompare(left.node.updated_at)
    || left.node.id.localeCompare(right.node.id);
}

function edgeCanExpandFrom(
  edge: ClarityEdge,
  currentId: string,
  mode: ProjectReasoningMode,
): boolean {
  if (!TRAVERSABLE_RELATIONSHIPS.has(edge.type)) return false;
  const outgoing = edge.source === currentId;
  const incoming = edge.target === currentId;
  if (!outgoing && !incoming) return false;

  if (mode === 'factual') {
    return ['informs', 'supports', 'resolves', 'affects'].includes(edge.type);
  }

  if (mode === 'impact') {
    return edge.type === 'blocks' && outgoing
      || edge.type === 'affects' && outgoing
      || edge.type === 'depends_on' && incoming
      || edge.type === 'resolves' && outgoing;
  }

  if (mode === 'decision') {
    return edge.type === 'depends_on' && outgoing
      || ['informs', 'supports', 'contradicts', 'blocks', 'affects', 'resolves', 'satisfies'].includes(edge.type) && incoming;
  }

  if (mode === 'focus') {
    return edge.type === 'blocks' && (outgoing || incoming)
      || edge.type === 'affects' && outgoing
      || edge.type === 'depends_on' && incoming
      || edge.type === 'satisfies' && (outgoing || incoming)
      || edge.type === 'informs' && incoming;
  }

  // Reasoning mode preserves all useful persisted relationships while keeping
  // provenance-only edges out of the reasoning traversal.
  return true;
}

function neighborId(edge: ClarityEdge, currentId: string): string {
  return edge.source === currentId ? edge.target : edge.source;
}

function edgeBonus(edge: ClarityEdge, mode: ProjectReasoningMode): number {
  if (mode === 'impact' && ['blocks', 'depends_on'].includes(edge.type)) return 0.16;
  if (mode === 'decision' && ['informs', 'supports', 'blocks', 'depends_on'].includes(edge.type)) return 0.14;
  if (mode === 'focus' && ['blocks', 'depends_on', 'satisfies'].includes(edge.type)) return 0.16;
  return edge.type === 'informs' || edge.type === 'affects' ? 0.06 : 0.03;
}

function excerptForSource(source: Project['sources'][number], query: string): string {
  const content = `${source.extraction_summary || ''} ${source.content || ''}`.trim();
  if (!content) return 'No source excerpt available.';
  const terms = tokenize(query);
  const lower = content.toLowerCase();
  const firstMatch = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  const start = Math.max(0, (firstMatch ?? 0) - 60);
  const excerpt = content.slice(start, start + 360).trim();
  return `${start > 0 ? '...' : ''}${excerpt}${start + 360 < content.length ? '...' : ''}`;
}

function retrieveEvidence(
  project: Project,
  selectedNodes: ClarityNode[],
  seedNodeIds: Set<string>,
  paths: Array<{ nodeIds: string[]; edgeIds: string[] }>,
  query: string,
  limit: number,
): EvidenceExcerpt[] {
  const nodesById = new Map(selectedNodes.map((node) => [node.id, node]));
  const sourceById = new Map(project.sources.map((source) => [source.id, source]));
  const pathNodeIds = new Set(paths.flatMap((path) => path.nodeIds));
  const supportBySource = new Map<string, Set<string>>();

  selectedNodes.forEach((node) => {
    node.source_refs.forEach((sourceId) => {
      const source = sourceById.get(sourceId);
      if (!source || source.discarded_at) return;
      const supported = supportBySource.get(sourceId) ?? new Set<string>();
      supported.add(node.id);
      supportBySource.set(sourceId, supported);
    });
  });

  const ranked: Array<EvidenceExcerpt | null> = Array.from(supportBySource.entries())
    .map(([sourceId, supportedIds]) => {
      const source = sourceById.get(sourceId);
      if (!source) return null;
      const supports = Array.from(supportedIds)
        .map((id) => nodesById.get(id)?.text)
        .filter((text): text is string => Boolean(text));
      const seedSupport = Array.from(supportedIds).some((id) => seedNodeIds.has(id)) ? 0.45 : 0;
      const pathSupport = Array.from(supportedIds).some((id) => pathNodeIds.has(id)) ? 0.2 : 0;
      const queryScore = relevanceScore(query, `${source.filename} ${source.extraction_summary ?? ''} ${source.content}`);
      return {
        source_id: source.id,
        filename: source.filename,
        excerpt: excerptForSource(source, query),
        score: Number(Math.min(1, seedSupport + pathSupport + queryScore).toFixed(3)),
        derived_node_ids: source.derived_node_ids,
        supports,
        selectionReason: seedSupport > 0
          ? 'seed_provenance'
          : pathSupport > 0
            ? 'expanded_node_provenance'
            : 'query_match',
      } as EvidenceExcerpt;
    });

  return ranked
    .filter((item): item is EvidenceExcerpt => item !== null)
    .sort((left, right) => right.score - left.score || left.source_id.localeCompare(right.source_id))
    .slice(0, limit);
}

export interface ProjectReasoningContext {
  mode: ProjectReasoningMode;
  seedNodes: ClarityNode[];
  expandedNodes: ClarityNode[];
  relationships: Project['edges'];
  evidence: EvidenceExcerpt[];
  paths: Array<{ nodeIds: string[]; edgeIds: string[] }>;
  diagnostics: {
    seedMethod: 'lexical' | 'fallback';
    truncated: boolean;
  };
}

export function retrieveProjectReasoningContext(params: {
  project: Project;
  query: string;
  mode: ProjectReasoningMode;
  limits?: Partial<ProjectReasoningLimits>;
}): ProjectReasoningContext {
  const limits = { ...DEFAULT_LIMITS, ...params.limits };
  const project = projectForReasoning(params.project);
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const scored = project.nodes
    .map((node) => ({ node, score: nodeScore(params.query, node, params.mode) }))
    .sort(compareScoredNodes);
  const lexical = scored.filter(({ node }) => relevanceScore(params.query, nodeSearchText(node)) > 0);
  const seedMethod = lexical.length > 0 ? 'lexical' : 'fallback';
  const seedCandidates = lexical.length > 0
    ? lexical
    : scored.filter(({ node }) => params.mode === 'factual'
      ? ['GOAL', 'KNOWN', 'EVIDENCE', 'DECISION'].includes(node.type)
      : params.mode === 'decision'
        ? ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'CONSTRAINT', 'EVIDENCE'].includes(node.type)
        : OPEN_ACTIONABLE_TYPES.has(node.type) || node.type === 'GOAL');
  const seeds = seedCandidates.slice(0, limits.seedNodes).map(({ node }) => node);
  const selected = new Map(seeds.map((node) => [node.id, node]));
  const seedIds = new Set(seeds.map((node) => node.id));
  const pathsByNode = new Map<string, { nodeIds: string[]; edgeIds: string[] }>();
  seeds.forEach((node) => pathsByNode.set(node.id, { nodeIds: [node.id], edgeIds: [] }));

  type Neighbor = { node: ClarityNode; edge: ClarityEdge; score: number; path: { nodeIds: string[]; edgeIds: string[] } };
  const neighborsFrom = (frontier: ClarityNode[], excluded: Set<string>): Neighbor[] => {
    const byId = new Map<string, Neighbor>();
    frontier.forEach((current) => {
      const basePath = pathsByNode.get(current.id) ?? { nodeIds: [current.id], edgeIds: [] };
      project.edges.forEach((edge) => {
        if (!edgeCanExpandFrom(edge, current.id, params.mode)) return;
        const id = neighborId(edge, current.id);
        if (excluded.has(id) || !nodesById.has(id)) return;
        const node = nodesById.get(id) as ClarityNode;
        const path = {
          nodeIds: [...basePath.nodeIds, id],
          edgeIds: [...basePath.edgeIds, edge.id],
        };
        if (path.edgeIds.length > 3 || path.nodeIds.length > 4) return;
        const candidate = {
          node,
          edge,
          score: nodeScore(params.query, node, params.mode) + edgeBonus(edge, params.mode),
          path,
        };
        const existing = byId.get(id);
        if (!existing || compareScoredNodes(candidate, existing) < 0 || candidate.score > existing.score) byId.set(id, candidate);
      });
    });
    return Array.from(byId.values()).sort((left, right) => compareScoredNodes(left, right) || left.edge.id.localeCompare(right.edge.id));
  };

  const direct = neighborsFrom(seeds, new Set(selected.keys())).slice(0, Math.min(limits.directNeighbors, limits.totalNodes - selected.size));
  direct.forEach(({ node, path }) => {
    selected.set(node.id, node);
    pathsByNode.set(node.id, path);
  });

  let secondHop: Neighbor[] = [];
  if (params.mode !== 'factual' && selected.size < limits.totalNodes && direct.length > 0) {
    secondHop = neighborsFrom(direct.map(({ node }) => node), new Set(selected.keys()))
      .slice(0, Math.min(limits.secondHopNodes, limits.totalNodes - selected.size));
    secondHop.forEach(({ node, path }) => {
      selected.set(node.id, node);
      pathsByNode.set(node.id, path);
    });
  }

  const selectedNodes = Array.from(selected.values());
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const relationships = project.edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const paths = [...direct, ...secondHop]
    .map(({ path }) => path)
    .filter((path) => path.edgeIds.length > 0)
    .slice(0, Math.max(1, limits.totalNodes));
  const evidence = retrieveEvidence(project, selectedNodes, seedIds, paths, params.query, limits.sources);

  return {
    mode: params.mode,
    seedNodes: seeds,
    expandedNodes: selectedNodes.filter((node) => !seedIds.has(node.id)),
    relationships,
    evidence,
    paths,
    diagnostics: {
      seedMethod,
      truncated: scored.length > selectedNodes.length || evidence.length >= limits.sources,
    },
  };
}

export function reasoningContextToAskGraphContext(context: ProjectReasoningContext, projectGoal: string): AskGraphContext {
  const nodes = [...context.seedNodes, ...context.expandedNodes];
  return {
    projectGoal,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      status: node.status,
      text: node.text,
      confidence: node.confidence,
      impact: node.impact,
    })),
    edges: context.relationships.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
    })),
    startingNodeIds: context.seedNodes.map((node) => node.id),
  };
}
