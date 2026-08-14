import { ClarityNode, ContextSource, Project } from '@/types/clarity';

export function isDiscardedSource(source: Pick<ContextSource, 'discarded_at'>): boolean {
  return Boolean(source.discarded_at);
}

export function activeContextSources(project: Project): ContextSource[] {
  return project.sources.filter((source) => !isDiscardedSource(source));
}

export function nodeUsesActiveSource(project: Project, node: ClarityNode): boolean {
  if (!node.source_refs.length) return true;

  return node.source_refs.some((sourceId) => {
    if (sourceId.startsWith('gcal_')) return true;
    const source = project.sources.find((candidate) => candidate.id === sourceId);
    return !source || !isDiscardedSource(source);
  });
}

export function activeReasoningNodes(project: Project): ClarityNode[] {
  return project.nodes.filter((node) => node.status !== 'DEPRECATED' && nodeUsesActiveSource(project, node));
}

export function projectForReasoning(project: Project): Project {
  const nodes = activeReasoningNodes(project);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...project,
    sources: activeContextSources(project),
    nodes,
    edges: project.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}
