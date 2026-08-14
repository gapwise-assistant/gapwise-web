import type { ClarityEdge, ClarityNode, Project } from '@/types/clarity';

export interface CurrentPictureItem {
  id: string;
  text: string;
}

const RELATIONSHIP_TEXT: Partial<Record<ClarityEdge['type'], string>> = {
  blocks: 'is blocking',
  affects: 'could affect',
  contradicts: 'conflicts with',
  depends_on: 'depends on',
  supports: 'supports',
  resolves: 'resolves',
};

function shorten(text: string, maxLength = 150): string {
  const normalized = text.trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function nodePriority(node?: ClarityNode): number {
  return node?.priority ?? node?.impact ?? 0;
}

function relationshipItem(edge: ClarityEdge, nodes: Map<string, ClarityNode>): CurrentPictureItem | null {
  const relationship = RELATIONSHIP_TEXT[edge.type];
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!relationship || !source || !target) return null;

  return {
    id: `edge:${edge.id}`,
    text: `${shorten(source.text)} ${relationship} ${shorten(target.text)}.`,
  };
}

/** Builds a compact deterministic summary from the stored project graph. */
export function buildCurrentPicture(project: Project, limit = 3): CurrentPictureItem[] {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const items: CurrentPictureItem[] = [];
  const seen = new Set<string>();
  const add = (item: CurrentPictureItem | null) => {
    if (!item || seen.has(item.text)) return;
    seen.add(item.text);
    items.push(item);
  };

  project.edges
    .filter((edge) => ['blocks', 'affects', 'contradicts', 'depends_on'].includes(edge.type))
    .sort((a, b) => {
      const aScore = Math.max(nodePriority(nodes.get(a.source)), nodePriority(nodes.get(a.target)));
      const bScore = Math.max(nodePriority(nodes.get(b.source)), nodePriority(nodes.get(b.target)));
      return bScore - aScore;
    })
    .forEach((edge) => add(relationshipItem(edge, nodes)));

  project.nodes
    .filter((node) => node.status === 'OPEN' && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION'))
    .sort((a, b) => nodePriority(b) - nodePriority(a))
    .forEach((node) => {
      add({
        id: `node:${node.id}`,
        text: node.why_it_matters?.[0] ?? `Still to resolve: ${shorten(node.text)}`,
      });
    });

  project.nodes
    .filter((node) => ['KNOWN', 'CONSTRAINT', 'DECISION', 'NEXT_ACTION'].includes(node.type))
    .sort((a, b) => nodePriority(b) - nodePriority(a))
    .forEach((node) => {
      const prefix = node.type === 'DECISION' || node.type === 'NEXT_ACTION' ? 'Direction so far' : 'Already understood';
      add({ id: `node:${node.id}`, text: `${prefix}: ${shorten(node.text)}` });
    });

  if (!items.length && project.goal) {
    add({ id: `goal:${project.id}`, text: `The current goal is to ${shorten(project.goal).replace(/[.]$/, '')}.` });
  }

  return items.slice(0, limit);
}
