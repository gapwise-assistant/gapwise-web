import type { ClarityNode, ClarityEdge, Project } from '@/types/clarity';

const IMPACT_TYPES = new Set<ClarityNode['type']>(['GOAL', 'DECISION', 'NEXT_ACTION', 'CONSTRAINT', 'RISK']);

/**
 * Compatibility helper for callers that still request question presentation
 * text. Canonical graph wording is the immutable display title.
 */
export function professionalQuestionText(value: string, context: string[] = []): string {
  void context;
  return value;
}

function compact(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

function quote(value: string): string {
  return `“${compact(value)}”`;
}

function dateLabel(deadline: string): string {
  const parsed = new Date(`${deadline}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? deadline
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function genericWhy(value: string): boolean {
  return /^(?:this may affect the project direction|this unresolved item|explicitly unresolved in the supplied project context|this is an open question|a decision depends|resolve these)/i.test(value.trim());
}

function otherNode(project: Project, edge: ClarityEdge, nodeId: string): ClarityNode | undefined {
  const id = edge.source === nodeId ? edge.target : edge.source;
  return project.nodes.find((node) => node.id === id);
}

function circularDecision(question: ClarityNode, candidate: ClarityNode): boolean {
  if (candidate.type !== 'DECISION') return false;
  if (!/\b(?:based on|depending on)\b.{0,70}\b(?:confirmation|answer|requirements?|instructions?)\b/i.test(candidate.text)) return false;
  const questionWords = new Set(question.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 4));
  const overlap = candidate.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => questionWords.has(word));
  return overlap.length >= 2;
}

/** Grounded card copy for the impact rationale shown beside an open question. */
export function questionWhyText(project: Project, node: ClarityNode): string {
  const edges = project.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const downstream = edges
    .map((edge) => ({ edge, other: otherNode(project, edge, node.id) }))
    .filter(({ other }) => other && IMPACT_TYPES.has(other.type) && !circularDecision(node, other))
    .sort(({ other: left }, { other: right }) => (right!.impact * right!.confidence) - (left!.impact * left!.confidence));
  const blocked = downstream.find(({ edge }) => edge.type === 'blocks');
  if (blocked?.other) return `This unresolved input blocks ${blocked.other.type.toLowerCase().replace('_', ' ')} ${quote(blocked.other.text)}.`;
  if (downstream[0]?.other) return `Resolving this can change ${downstream[0].other.type.toLowerCase().replace('_', ' ')} ${quote(downstream[0].other.text)}.`;

  const sourceReason = node.why_it_matters?.find((reason) => reason && !genericWhy(reason));
  if (sourceReason) return compact(sourceReason) + (/[.!?]$/.test(sourceReason.trim()) ? '' : '.');
  if (project.deadline && project.goal) return `This must be confirmed before ${dateLabel(project.deadline)} to support ${quote(project.goal)}.`;
  if (project.goal) return `This is an unresolved input to ${quote(project.goal)}.`;
  return 'The impact is not yet connected to another project decision or action.';
}

/**
 * Describes only recorded downstream dependencies. In particular, a decision
 * that merely repeats "decide X based on confirmation" is not a real effect.
 */
export function questionEffectText(project: Project, node: ClarityNode): string {
  const effects = project.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => ({ edge, other: otherNode(project, edge, node.id) }))
    .filter(({ other }) => other && IMPACT_TYPES.has(other.type) && !circularDecision(node, other));

  const effect = effects[0];
  if (effect?.other) {
    const relationship = effect.edge.type === 'blocks'
      ? effect.edge.source === node.id ? 'Blocks' : 'Blocked by'
      : effect.edge.type === 'depends_on'
        ? effect.edge.source === node.id ? 'Depends on' : 'Needed by'
        : effect.edge.type === 'affects'
          ? effect.edge.source === node.id ? 'Affects' : 'Affected by'
          : effect.edge.type === 'resolves'
            ? effect.edge.source === node.id ? 'Resolves' : 'Resolved by'
            : 'Connected to';
    return `${relationship}: ${quote(effect.other.text)}.`;
  }
  return 'No downstream decision or action is recorded yet.';
}
