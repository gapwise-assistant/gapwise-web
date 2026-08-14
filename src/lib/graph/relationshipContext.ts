import { ClarityEdge, Project } from '@/types/clarity';

const relationshipLabels: Record<ClarityEdge['type'], { outgoing: string; incoming: string }> = {
  supports: { outgoing: 'Supports', incoming: 'Supported by' },
  contradicts: { outgoing: 'Contradicts', incoming: 'Contradicted by' },
  supersedes: { outgoing: 'Supersedes', incoming: 'Superseded by' },
  resolves: { outgoing: 'Resolves', incoming: 'Resolved by' },
  depends_on: { outgoing: 'Depends on', incoming: 'Dependency' },
  blocks: { outgoing: 'Blocks', incoming: 'Blocked by' },
  affects: { outgoing: 'Affects', incoming: 'Affected by' },
  informs: { outgoing: 'Informs', incoming: 'Informed by' },
  derived_from: { outgoing: 'Derived from', incoming: 'Source context' },
};

function shorten(text: string, maxLength = 150): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

export function relationshipReasons(project: Project, nodeId: string, limit = 4): string[] {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  return project.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => {
      const outgoing = edge.source === nodeId;
      const other = nodes.get(outgoing ? edge.target : edge.source);
      if (!other) return null;
      const label = relationshipLabels[edge.type][outgoing ? 'outgoing' : 'incoming'];
      return `${label}: "${shorten(other.text)}"`;
    })
    .filter((reason): reason is string => Boolean(reason))
    .slice(0, limit);
}
