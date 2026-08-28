import type { Project } from '@/types/clarity';

const INVALIDATING_RELATIONSHIPS = new Set(['contradicts', 'supersedes']);

/**
 * Retires a conditional risk only when resolved evidence is explicitly linked
 * as contradicting or superseding it. Text similarity and a resolved upstream
 * question are intentionally insufficient because either answer polarity could
 * make the risk more likely instead of disproving it.
 */
export function retireExplicitlyDisprovedRisks(
  project: Project,
  now = new Date().toISOString(),
): string[] {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const retired: string[] = [];

  project.edges.forEach((edge) => {
    if (!INVALIDATING_RELATIONSHIPS.has(edge.type) || (edge.confidence ?? 1) < 0.7) return;
    const source = nodesById.get(edge.source);
    const risk = nodesById.get(edge.target);
    if (!source || source.status !== 'RESOLVED') return;
    if (!risk || risk.type !== 'RISK' || risk.status !== 'OPEN') return;

    risk.status = 'DEPRECATED';
    risk.updated_at = now;
    risk.why_it_matters = Array.from(new Set([
      ...(risk.why_it_matters ?? []),
      `Retired after resolved project evidence ${edge.type === 'contradicts' ? 'contradicted' : 'superseded'} this risk.`,
    ]));
    retired.push(risk.id);
  });

  return Array.from(new Set(retired));
}
