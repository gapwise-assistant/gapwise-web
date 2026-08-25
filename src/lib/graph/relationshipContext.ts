import { ClarityEdge, ClarityNode, Project } from '@/types/clarity';

export const relationshipLabels: Record<ClarityEdge['type'], { outgoing: string; incoming: string }> = {
  supports: { outgoing: 'Supports', incoming: 'Supported by' },
  contradicts: { outgoing: 'Contradicts', incoming: 'Contradicted by' },
  supersedes: { outgoing: 'Supersedes', incoming: 'Superseded by' },
  resolves: { outgoing: 'Resolves', incoming: 'Resolved by' },
  satisfies: { outgoing: 'Satisfies', incoming: 'Satisfied by' },
  depends_on: { outgoing: 'Depends on', incoming: 'Required by' },
  blocks: { outgoing: 'Blocks', incoming: 'Blocked by' },
  affects: { outgoing: 'Affects', incoming: 'Affected by' },
  informs: { outgoing: 'Informs', incoming: 'Informed by' },
  derived_from: { outgoing: 'Derived from', incoming: 'Source context' },
};

export function relationshipLabel(
  type: ClarityEdge['type'],
  direction: 'outgoing' | 'incoming',
): string {
  return relationshipLabels[type][direction];
}

export interface NodeRelationship {
  edge: ClarityEdge;
  other: ClarityNode;
  outgoing: boolean;
  label: string;
}

export interface NodeRelationshipGroup {
  label: string;
  outgoing: boolean;
  items: NodeRelationship[];
}

export function nodeRelationships(project: Project, nodeId: string): NodeRelationship[] {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  return project.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => {
      const outgoing = edge.source === nodeId;
      const other = nodes.get(outgoing ? edge.target : edge.source);
      if (!other) return null;
      return {
        edge,
        other,
        outgoing,
        label: relationshipLabel(edge.type, outgoing ? 'outgoing' : 'incoming'),
      };
    })
    .filter((item): item is NodeRelationship => Boolean(item));
}

export function relationshipGroupsForNode(project: Project, nodeId: string): NodeRelationshipGroup[] {
  return nodeRelationships(project, nodeId).reduce<NodeRelationshipGroup[]>((groups, item) => {
    const existing = groups.find((group) => group.label === item.label && group.outgoing === item.outgoing);
    if (existing) existing.items.push(item);
    else groups.push({ label: item.label, outgoing: item.outgoing, items: [item] });
    return groups;
  }, []);
}

function shorten(text: string, maxLength = 150): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

export function relationshipReasons(project: Project, nodeId: string, limit = 4): string[] {
  return nodeRelationships(project, nodeId)
    .map(({ label, other }) => `${label}: "${shorten(other.text)}"`)
    .slice(0, limit);
}
