import type { ClarityEdge, ClarityNode, Project } from '@/types/clarity';

export const QUESTION_NODE_TYPES = new Set<ClarityNode['type']>(['UNKNOWN', 'ASSUMPTION']);

export type QuestionReconciliationClassification =
  | 'NEW_UNCERTAINTY'
  | 'PARAPHRASE'
  | 'SUBQUESTION'
  | 'SUPPORTING_EVIDENCE'
  | 'ASSUMPTION'
  | 'RELATED_BUT_DISTINCT';

const QUESTION_KEY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'can', 'could', 'does', 'do', 'for', 'from',
  'has', 'have', 'how', 'is', 'it', 'may', 'must', 'of', 'or', 'should',
  'that', 'the', 'this', 'to', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'would', 'confirm', 'clarify', 'determine', 'find', 'out',
]);

function stemQuestionToken(token: string): string {
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

export function questionIdentityKey(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(stemQuestionToken)
    .filter((token) => token.length >= 3 && !QUESTION_KEY_STOP_WORDS.has(token));
  return Array.from(new Set(tokens)).sort().join(' ');
}

const QUESTION_SUBJECT_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'can', 'could', 'does', 'do', 'for', 'from',
  'has', 'have', 'how', 'i', 'is', 'it', 'me', 'may', 'must', 'my', 'of', 'or',
  'our', 'should', 'that', 'the', 'this', 'to', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'would', 'we', 'with', 'you', 'your',
  'approv', 'approve', 'approval', 'approved', 'authority', 'authoritative', 'check',
  'clarif', 'clarify', 'confirm', 'confirmed', 'confirmation', 'current', 'determin',
  'determine', 'expected', 'find', 'inform', 'informed', 'out', 'outcome', 'pending',
  'record', 'recorded', 'require', 'required', 'requirement', 'need', 'needed', 'needs',
  'must',
  'review', 'reviewed', 'reviewing', 'source', 'statu', 'status', 'uncertain',
  'unconfirm', 'unknown', 'unresolved', 'missing', 'still', 'being', 'tell', 'told',
  'said', 'say', 'advis', 'reported', 'notif', 'emailed', 'messaged', 'owner',
  'team', 'office', 'manager', 'department', 'organization', 'provider',
]);

function questionSubjectTokens(text: string): Set<string> {
  return new Set(questionIdentityKey(text)
    .split(' ')
    .filter((token) => token && !QUESTION_SUBJECT_STOP_WORDS.has(token)));
}

/**
 * Generic subject matching shared by candidate finalization and graph
 * canonicalization. It compares substantive tokens only; no domain vocabulary
 * is used, and a single shared token is never enough to merge questions.
 */
export function questionsShareSubject(left: string, right: string): boolean {
  const leftTokens = questionSubjectTokens(left);
  const rightTokens = questionSubjectTokens(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (shared < 2) return false;
  const leftCoverage = shared / leftTokens.size;
  const rightCoverage = shared / rightTokens.size;
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  return (leftCoverage >= 0.75 && rightCoverage >= 0.75) || shared === smallerSize;
}

function isStatusFallbackQuestion(text: string): boolean {
  return /^what (?:current )?status\b/i.test(text.trim())
    || /^what .+ is currently confirmed\??$/i.test(text.trim());
}

function questionTextsShouldMerge(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
    || semanticallyEquivalentQuestion(left, right)
    || questionsShareSubject(left, right);
}

/**
 * Compatibility export for callers that used the old family API. Families are
 * no longer inferred from product or domain vocabulary; only the normalized
 * identity is exposed as a deterministic key.
 */
export function questionFamilyKey(text: string): string | undefined {
  const key = questionIdentityKey(text);
  return key || undefined;
}

export interface QuestionReconciliationResult {
  classification: QuestionReconciliationClassification;
  canonicalQuestionId?: string;
  canonicalCandidateIndex?: number;
  confidence: number;
  reason: string;
}

/**
 * Deterministically reconciles question-like candidates within one source.
 * Temporary candidate IDs let later candidates point at an earlier candidate
 * before ingestion has assigned durable graph IDs.
 */
export function reconcileQuestionCandidates(
  candidates: Array<Pick<ClarityNode, 'type' | 'text'>>,
  project: Pick<Project, 'nodes'>,
): QuestionReconciliationResult[] {
  const workingNodes: ClarityNode[] = [...project.nodes];
  return candidates.map((candidate, index) => {
    const result = reconcileQuestionCandidate(candidate, { nodes: workingNodes });
    const temporaryId = result.canonicalQuestionId?.match(/^__candidate_(\d+)$/);
    const normalized: QuestionReconciliationResult = temporaryId
      ? {
        ...result,
        canonicalQuestionId: undefined,
        canonicalCandidateIndex: Number(temporaryId[1]),
      }
      : result;
    workingNodes.push({
      id: `__candidate_${index}`,
      type: candidate.type,
      text: candidate.text,
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.8,
      source_refs: [],
      created_by: 'agent',
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      question_role: normalized.classification === 'SUBQUESTION'
        ? 'subquestion'
        : normalized.classification === 'ASSUMPTION'
          ? 'assumption'
          : 'canonical',
      canonical_question_id: normalized.canonicalQuestionId,
    });
    return normalized;
  });
}

function appearsNarrowerThan(candidate: string, existing: string): boolean {
  if (candidate === existing) return false;
  const candidateTokens = new Set(questionIdentityKey(candidate).split(' ').filter(Boolean));
  const existingTokens = new Set(questionIdentityKey(existing).split(' ').filter(Boolean));
  if (candidateTokens.size <= existingTokens.size || existingTokens.size < 3) return false;
  if (![...existingTokens].every((token) => candidateTokens.has(token))) return false;

  // Added descriptive nouns can be ordinary paraphrase ("appointment time").
  // Require a generic, explicit narrowing marker before calling it a
  // subquestion; no domain vocabulary belongs in this fallback.
  return /\b(?:specific|selected|chosen|option|variant|version|instance|scenario|case)\b/i.test(candidate);
}

/**
 * Offline reconciliation used by demo mode and as a safe fallback when the
 * Context Agent is unavailable. It is intentionally conservative and does not
 * assume any product or domain vocabulary.
 */
export function reconcileQuestionCandidate(
  candidate: Pick<ClarityNode, 'type' | 'text'>,
  project: Pick<Project, 'nodes'>,
): QuestionReconciliationResult {
  if (!QUESTION_NODE_TYPES.has(candidate.type)) {
    return {
      classification: 'SUPPORTING_EVIDENCE',
      confidence: 0.98,
      reason: 'The extracted node is not an unresolved question type.',
    };
  }

  const canonicalQuestions = canonicalQuestionGroups(project)
    .map((group) => group.canonical);
  const equivalent = canonicalQuestions.find((question) => [question.text, ...(question.question_aliases ?? [])]
    .some((text) => questionTextsShouldMerge(text, candidate.text)));
  if (!equivalent) {
    return {
      classification: candidate.type === 'ASSUMPTION' ? 'ASSUMPTION' : 'NEW_UNCERTAINTY',
      confidence: 0.76,
      reason: 'No existing canonical question matches the extracted subject and answer shape.',
    };
  }

  if (candidate.type === 'ASSUMPTION') {
    return {
      classification: 'ASSUMPTION',
      canonicalQuestionId: equivalent.id,
      confidence: 0.9,
      reason: 'The extracted text is an unverified belief attached to an existing uncertainty.',
    };
  }
  if (appearsNarrowerThan(candidate.text, equivalent.text)) {
    return {
      classification: 'SUBQUESTION',
      canonicalQuestionId: equivalent.id,
      confidence: 0.83,
      reason: 'The extracted wording narrows the existing uncertainty to a specific option or verification case.',
    };
  }
  return {
    classification: 'PARAPHRASE',
    canonicalQuestionId: equivalent.id,
    confidence: 0.9,
    reason: 'The extracted wording asks the same underlying uncertainty as an existing canonical question.',
  };
}

/**
 * Deterministic equivalence for graph questions. Presentation titles are not
 * involved, so changing copy cannot change graph identity or ranking.
 */
export function semanticallyEquivalentQuestion(left: string, right: string): boolean {
  const leftKey = questionIdentityKey(left);
  const rightKey = questionIdentityKey(right);
  if (!leftKey || !rightKey) return false;
  return leftKey === rightKey || questionsShareSubject(left, right);
}

export interface CanonicalQuestionGroup {
  canonical: ClarityNode;
  aliases: ClarityNode[];
  nodeIds: string[];
  subquestions: ClarityNode[];
  assumptions: ClarityNode[];
}

function statusRank(status: ClarityNode['status']): number {
  if (status === 'RESOLVED') return 3;
  if (status === 'OPEN') return 2;
  if (status === 'DEFERRED') return 1;
  return 0;
}

function canonicalNode(nodes: ClarityNode[]): ClarityNode {
  const ordered = [...nodes].sort((left, right) =>
    statusRank(right.status) - statusRank(left.status)
    || Number((right.question_role ?? 'canonical') === 'canonical') - Number((left.question_role ?? 'canonical') === 'canonical')
    || (Number(isStatusFallbackQuestion(left.text)) - Number(isStatusFallbackQuestion(right.text)))
    || (Number(right.reconciliation_status === 'reconciled') - Number(left.reconciliation_status === 'reconciled'))
    || (right.confidence - left.confidence)
    || (right.source_refs.length - left.source_refs.length)
    || ((right.priority ?? right.impact) - (left.priority ?? left.impact))
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id)
  );
  const selected = { ...ordered[0] };
  selected.source_refs = Array.from(new Set(nodes.flatMap((node) => node.source_refs).filter(Boolean)));
  selected.why_it_matters = Array.from(new Set(nodes.flatMap((node) => node.why_it_matters ?? []).filter(Boolean)));
  selected.confidence = Math.max(...nodes.map((node) => node.confidence));
  selected.impact = Math.max(...nodes.map((node) => node.impact));
  selected.question_role = 'canonical';
  selected.canonical_question_id = undefined;
  selected.question_aliases = Array.from(new Set([
    ...nodes.flatMap((node) => node.question_aliases ?? []),
    ...nodes.map((node) => node.text),
  ].filter((text) => text && text !== selected.text)));
  selected.reconciliation_confidence = Math.max(...nodes.map((node) => node.reconciliation_confidence ?? 0));
  selected.reconciliation_status = nodes.some((node) => node.reconciliation_status === 'reconciled')
    ? 'reconciled'
    : nodes.some((node) => node.reconciliation_status === 'fallback') ? 'fallback' : selected.reconciliation_status;
  const priorities = nodes.map((node) => node.priority).filter((value): value is number => typeof value === 'number');
  if (priorities.length) selected.priority = Math.max(...priorities);
  selected.updated_at = nodes.map((node) => node.updated_at).sort().at(-1) ?? selected.updated_at;
  return selected;
}

/**
 * Groups active UNKNOWN/ASSUMPTION nodes without mutating the stored project.
 * A resolved equivalent wins over an open alias so a stale duplicate cannot
 * reappear in Today after a conclusive answer or source update.
 */
export function canonicalQuestionGroups(project: Pick<Project, 'nodes'>): CanonicalQuestionGroup[] {
  const groups: ClarityNode[][] = [];
  const candidates = project.nodes.filter((node) => QUESTION_NODE_TYPES.has(node.type) && node.status !== 'DEPRECATED');
  const byId = new Map(candidates.map((node) => [node.id, node]));
  const assigned = new Set<string>();

  // Explicit relationships from the reconciliation pass are authoritative.
  candidates.forEach((node) => {
    const canonicalId = node.canonical_question_id;
    if (!canonicalId || canonicalId === node.id || !byId.has(canonicalId)) return;
    let group = groups.find((candidate) => candidate.some((item) => item.id === canonicalId));
    if (!group) {
      const root = byId.get(canonicalId);
      if (!root) return;
      group = [root];
      groups.push(group);
      assigned.add(root.id);
    }
    if (!group.some((item) => item.id === node.id)) group.push(node);
    assigned.add(node.id);
  });

  candidates
    .filter((node) => !assigned.has(node.id))
    .forEach((node) => {
      // NEW_UNCERTAINTY and RELATED_BUT_DISTINCT are advisory classifications.
      // A genuinely different subject remains separate; matching substantive
      // subjects still resolve to one canonical question.
      const group = groups.find((candidate) => candidate.some((item) =>
        [item.text, ...(item.question_aliases ?? [])].some((text) =>
          [node.text, ...(node.question_aliases ?? [])].some((candidateText) => questionTextsShouldMerge(text, candidateText))
        )
      ));
      if (group) group.push(node);
      else groups.push([node]);
      assigned.add(node.id);
    });

  return groups.map((nodes) => ({
    canonical: canonicalNode(nodes),
    aliases: nodes.map((node) => ({ ...node })),
    nodeIds: nodes.map((node) => node.id),
    subquestions: nodes.filter((node) => node.question_role === 'subquestion'),
    assumptions: nodes.filter((node) => node.question_role === 'assumption' || node.type === 'ASSUMPTION'),
  }));
}

function dedupeEdges(edges: ClarityEdge[]): ClarityEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.source}:${edge.target}:${edge.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Returns a reasoning-safe graph with one representative per semantic
 * question. Alias IDs are rewired in edges and source provenance, while the
 * persisted project remains unchanged for audit/history purposes.
 */
export function canonicalizeQuestionGraph(project: Project): Project {
  const groups = canonicalQuestionGroups(project);
  const aliases = new Map<string, string>();
  const canonicalIds = new Set<string>();
  const replacements = new Map<string, ClarityNode>();

  groups.forEach((group) => {
    canonicalIds.add(group.canonical.id);
    replacements.set(group.canonical.id, group.canonical);
    group.nodeIds.forEach((nodeId) => aliases.set(nodeId, group.canonical.id));
  });

  const nodes = project.nodes
    .filter((node) => !QUESTION_NODE_TYPES.has(node.type) || canonicalIds.has(node.id))
    .map((node) => replacements.get(node.id) ?? { ...node });
  const edges = dedupeEdges(
    project.edges
      .map((edge) => ({
        ...edge,
        source: aliases.get(edge.source) ?? edge.source,
        target: aliases.get(edge.target) ?? edge.target,
      }))
      .filter((edge) => edge.source !== edge.target),
  );
  const sources = project.sources.map((source) => ({
    ...source,
    derived_node_ids: Array.from(new Set(source.derived_node_ids.map((nodeId) => aliases.get(nodeId) ?? nodeId))),
  }));

  return { ...project, nodes, edges, sources };
}

export function canonicalOpenQuestions(project: Project): ClarityNode[] {
  return canonicalQuestionGroups(project)
    .map((group) => group.canonical)
    .filter((node) => node.status === 'OPEN')
    .sort((left, right) => (right.priority ?? right.impact) - (left.priority ?? left.impact));
}

export function canonicalResolvedQuestions(project: Project): ClarityNode[] {
  return canonicalQuestionGroups(project)
    .map((group) => group.canonical)
    .filter((node) => node.status === 'RESOLVED')
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}
