import type { ClarityNode, ClarityEdge, Project } from '@/types/clarity';

const IMPACT_TYPES = new Set<ClarityNode['type']>(['GOAL', 'DECISION', 'NEXT_ACTION', 'CONSTRAINT', 'RISK']);

/** Corrects common auxiliary-verb agreement without changing question meaning. */
export function normalizeQuestionGrammar(value: string): string {
  const normalized = value
    .replace(/\bhas\s+i\b/gi, 'have I')
    .replace(/\bdoes\s+i\b/gi, 'do I')
    .replace(/\b(?:is|are)\s+i\b/gi, 'am I')
    .replace(/\b(and|but)\s+i\s+(am|was|were)\b/gi, '$1 $2 I')
    .replace(/\b(and|but)\s+i\s+(need|have|want|prefer|should|can|could|will|would)\b/gi, '$1 do I $2')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.replace(/^([a-z])/, (character) => character.toUpperCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function singularizeReference(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const last = words.at(-1);
  if (!last) return value.trim();
  const singular = last.length > 4 && last.endsWith('ies')
    ? `${last.slice(0, -3)}y`
    : last.length > 4 && last.endsWith('s') && !last.endsWith('ss')
      ? last.slice(0, -1)
      : last;
  words[words.length - 1] = singular;
  return words.join(' ');
}

function referenceCandidates(question: string, sourceContent: string): string[] {
  const verb = question.match(
    /\b(?:have|has|had|do|does|did|am|is|are|can|could|will|would|should|might|must)\s+(?:i|we|the user)\s+([a-z][a-z0-9'-]*)\s+(?:one|ones)\b/i,
  )?.[1];
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    const cleaned = value
      ?.replace(/^[\s"“'(]+|[\s"”').!?]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || /\b(?:one|ones)\b/i.test(cleaned) || /^(?:not|no|never|still|yet)$/i.test(cleaned)) return;
    if (cleaned.split(/\s+/).length > 6) return;
    if (!candidates.some((candidate) => candidate.toLowerCase() === cleaned.toLowerCase())) {
      candidates.push(cleaned);
    }
  };

  const boundary = '(?=\\s+(?:for|to|with|before|after|on|at|by|earlier|later|and|but|or)|[,.;!?]|$)';
  if (verb) {
    const actionPattern = new RegExp(
      `\\b${escapeRegExp(verb)}\\b\\s+(?:(?:the|a|an|my|our|your|this|that)\\s+)?([a-z][a-z0-9'/-]*(?:\\s+[a-z][a-z0-9'/-]*){0,5}?)${boundary}`,
      'i',
    );
    add(sourceContent.match(actionPattern)?.[1]);
  }

  // If the source uses "one" without repeating the object after the action,
  // use the nearest object introduced by ordinary relationship grammar. The
  // vocabulary here is structural, not domain-specific: it only identifies
  // a noun phrase that a source says it requires, contains, uses, or records.
  const relationshipPattern = new RegExp(
    `\\b(?:requires?|needs?|uses?|contains?|includes?|holds?|stores?|lists?|tracks?|records?)\\s+(?:(?:the|a|an|my|our|your|this|that)\\s+)?([a-z][a-z0-9'/-]*(?:\\s+[a-z][a-z0-9'/-]*){0,5}?)${boundary}`,
    'gi',
  );
  for (const match of sourceContent.matchAll(relationshipPattern)) add(match[1]);

  return candidates;
}

/**
 * Replaces vague source-derived references such as "one" with the closest
 * noun phrase actually present in the supplied context. This keeps generated
 * questions understandable without teaching the system any project domain.
 */
export function resolveQuestionReferences(value: string, sourceContent: string): string {
  if (!/\b(?:one|ones)\b/i.test(value) || !sourceContent.trim()) return value;
  const candidates = referenceCandidates(value, sourceContent);
  const candidate = candidates[0];
  if (!candidate) return value;
  const token = value.match(/\b(ones?)\b/i)?.[1];
  const replacement = token?.toLowerCase() === 'ones'
    ? candidate
    : `the ${singularizeReference(candidate)}`;
  return value.replace(/\b(?:one|ones)\b/i, replacement);
}

/**
 * Compatibility helper for callers that still request question presentation
 * text. Canonical graph wording is the immutable display title.
 */
export function professionalQuestionText(value: string, context: string[] = []): string {
  const normalized = normalizeQuestionGrammar(value);
  const requiredContext = context.join(' ').match(/\b(?:required|requirements?|approval|approved|must|necessary)\b/i);
  const needQuestion = normalized.match(/^Do I need (to .+?)\?$/i);
  if (needQuestion && requiredContext) {
    return `What has been confirmed about whether I am required ${needQuestion[1]}?`;
  }
  return normalized;
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
