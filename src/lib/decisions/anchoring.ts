import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import type { ClarityNode, Project, UserMemoryProfile } from '@/types/clarity';
import { canonicalOpenQuestions } from '@/lib/questions/canonical';
import { writeSemanticEdge } from '@/lib/graph/relationshipSemantics';

export interface DecisionAnchorSuggestion {
  title: string;
  sourceId?: string;
  questionNodeIds: string[];
  confidence: number;
  reason: string;
}

const OPEN_QUESTION_TYPES = new Set<ClarityNode['type']>(['UNKNOWN', 'ASSUMPTION']);
const IGNORED_TOKENS = new Set([
  'what', 'where', 'when', 'which', 'who', 'how', 'why', 'does', 'could', 'would', 'should',
  'are', 'the', 'and', 'for', 'from', 'with', 'this', 'that', 'about', 'into', 'your', 'you',
  'can', 'will', 'have', 'need', 'know', 'still', 'whether', 'decision', 'open',
]);

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    normalized(value)
      .split(' ')
      .filter((token) => token.length >= 4 && !IGNORED_TOKENS.has(token))
  );
}

function slug(value: string): string {
  return normalized(value).replace(/\s+/g, '-').slice(0, 64) || 'decision';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function compactTitle(value: string): string {
  const normalizedValue = value
    .replace(/^[-–—:]+\s*/, '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const questionEnd = normalizedValue.indexOf('?');
  const sentenceEnd = normalizedValue.search(/[.!](?:\s|$)/);
  const end = questionEnd >= 0 ? questionEnd + 1 : sentenceEnd >= 0 ? sentenceEnd + 1 : normalizedValue.length;
  return normalizedValue.slice(0, end).replace(/[.;]+$/, '').trim().slice(0, 220);
}

/**
 * Strong markers only. A generic mention of a decision is not enough to
 * create graph structure: the user must be looking at a pending choice.
 */
export function hasExplicitOpenDecisionCue(value: string): boolean {
  return /\b(?:open decision|pending(?:\s+[a-z0-9/-]+){0,3}\s+decision|unresolved(?:\s+[a-z0-9/-]+){0,3}\s+decision|decision pending|decision\s*:\s*(?:should|whether|which|do|can|will|choose|launch|pilot)|decision or choice remains?\s+(?:open|pending|unresolved)|go\s*\/\s*no[- ]go|still deciding|we need to decide|need to decide|decide whether|should we|choose between|launch or|pilot or|before we decide|open launch decision)\b/i.test(value);
}

export function extractOpenDecisionTitle(value: string): string | null {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const marker = /(?:open decision|pending decision|unresolved decision|decision pending|decision\s*:\s*|decision to make|we need to decide|need to decide|decide whether|should we|choose between|go\s*\/\s*no[- ]go)\s*[:\-–—]?\s*/i;
  for (const line of lines) {
    const match = line.match(marker);
    if (!match) continue;
    const title = compactTitle(line.slice((match.index ?? 0) + match[0].length));
    if (title.length >= 12) return title.endsWith('?') ? title : `${title}?`;
  }
  return null;
}

/** Returns true when a derived DECISION text matches the explicit source decision. */
export function matchesExplicitDecisionTitle(nodeText: string, sourceContent: string): boolean {
  if (hasExplicitOpenDecisionCue(nodeText)) return true;
  const title = extractOpenDecisionTitle(sourceContent);
  if (!title) return false;
  const titleTokens = meaningfulTokens(title);
  const nodeTokens = meaningfulTokens(nodeText);
  if (titleTokens.size === 0 || nodeTokens.size === 0) return false;
  const overlap = [...titleTokens].filter((token) => nodeTokens.has(token)).length;
  return overlap >= Math.min(3, titleTokens.size);
}

export function openDecisions(project: Project): ClarityNode[] {
  return project.nodes.filter((node) => node.type === 'DECISION' && node.status === 'OPEN');
}

export function openQuestions(project: Project): ClarityNode[] {
  return canonicalOpenQuestions(project)
    .filter((node) => OPEN_QUESTION_TYPES.has(node.type))
    .sort((left, right) => (right.impact * right.confidence) - (left.impact * left.confidence));
}

function reachableOpenDecisionIds(project: Project, sourceId: string): string[] {
  const openDecisionIds = new Set(openDecisions(project).map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  project.edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });
  const queue: Array<{ id: string; depth: number }> = [{ id: sourceId, depth: 0 }];
  const visited = new Set([sourceId]);
  const matches: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth > 0 && openDecisionIds.has(current.id)) matches.push(current.id);
    if (current.depth >= 6) continue;
    for (const next of outgoing.get(current.id) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ id: next, depth: current.depth + 1 });
    }
  }
  return matches;
}

export function unlinkedOpenQuestions(project: Project): ClarityNode[] {
  return openQuestions(project).filter((question) => reachableOpenDecisionIds(project, question.id).length === 0);
}

/**
 * Suggests creating a decision only when the project has no open decision and
 * a source explicitly describes a pending choice. Questions are not attached
 * automatically; their relationships must be explicit.
 */
export function findDecisionAnchorSuggestion(project: Project): DecisionAnchorSuggestion | null {
  if (openDecisions(project).length > 0) return null;

  for (const source of project.sources.filter((candidate) => !candidate.discarded_at)) {
    if (!hasExplicitOpenDecisionCue(source.content)) {
      continue;
    }

    const title = extractOpenDecisionTitle(source.content);
    if (!title) {
      continue;
    }

    return {
      title,
      sourceId: source.id,
      questionNodeIds: [],
      confidence: 0.8,
      reason: 'The source explicitly describes a pending choice.',
    };
  }
  return null;
}

function decisionTitleMatches(left: string, right: string): boolean {
  return normalized(left) === normalized(right);
}

/**
 * Explicit user action for projects whose context did not contain a decision.
 * The returned clone is safe to persist through the normal project update path.
 */
export function anchorProjectDecision(
  project: Project,
  title: string,
  questionNodeIds?: string[],
  profile?: UserMemoryProfile,
): Project {
  const cleanedTitle = compactTitle(title);
  if (!cleanedTitle) return project;
  const updated: Project = JSON.parse(JSON.stringify(project));
  const now = new Date().toISOString();
  const questions = questionNodeIds?.length
    ? updated.nodes.filter((node) =>
        questionNodeIds.includes(node.id)
        && OPEN_QUESTION_TYPES.has(node.type)
        && node.status === 'OPEN'
      )
    : [];

  let decision = updated.nodes.find((node) => node.type === 'DECISION' && decisionTitleMatches(node.text, cleanedTitle));
  if (!decision) {
    const baseId = `decision_anchor_${slug(updated.id)}`;
    const id = updated.nodes.some((node) => node.id === baseId)
      ? `${baseId}_${stableHash(cleanedTitle)}`
      : baseId;
    decision = {
      id,
      type: 'DECISION',
      text: cleanedTitle.endsWith('?') ? cleanedTitle : `${cleanedTitle}?`,
      status: 'OPEN',
      confidence: 0.9,
      impact: 0.95,
      source_refs: Array.from(new Set(questions.flatMap((node) => node.source_refs))),
      why_it_matters: ['This decision was explicitly anchored by the user.'],
      created_by: 'user',
      created_at: now,
      updated_at: now,
      x: 760,
      y: 180,
    };
    updated.nodes.push(decision);
  } else {
    decision.status = 'OPEN';
    decision.updated_at = now;
  }

  questions.forEach((question) => {
    writeSemanticEdge(updated, {
      source: question.id,
      target: decision!.id,
      type: 'informs',
      confidence: 0.9,
    });
    question.updated_at = now;
  });
  const goal = updated.nodes.find((node) => node.type === 'GOAL' && node.status !== 'DEPRECATED');
  if (goal) writeSemanticEdge(updated, { source: decision.id, target: goal.id, type: 'affects', confidence: 0.8 });

  updated.clarity_score = calculateClarityScore(updated);
  updated.active_question = selectTopGap(updated, profile ?? {
    answer_density: 'balanced',
    question_frequency: 'moderate',
    challenge_level: 'moderate',
    evidence_preference: 'intuition_allowed',
    brainstorm_style: 'direct_to_solution',
    uncertainty_style: 'explicit',
  });
  updated.updated_at = now;
  return updated;
}
