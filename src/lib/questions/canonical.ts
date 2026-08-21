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

function questionMeaningOverlap(left: string, right: string): number {
  const leftTokens = new Set(questionIdentityKey(left).split(' ').filter(Boolean));
  const rightTokens = new Set(questionIdentityKey(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / Math.max(1, union);
}

/**
 * A small deterministic semantic layer complements the Context Agent. It is
 * deliberately about stable decision subjects, not arbitrary word overlap,
 * so the local/demo path can reconcile common paraphrases without making a
 * network call.
 */
function questionFamily(text: string): string | undefined {
  const value = text.toLowerCase();
  if (/(?:psu|power\s+supply|\b(?:650|750)\s*w\b)/i.test(value)
    && /safe|safely|safety|stabil|run|reuse|capacity|watt|power|reliab/i.test(value)) return 'power-supply-safety';
  if (/(?:fit|clearance|case|cooler|noise|quiet|temperature|thermal|acoustic|\bhot\b|\bloud\b|airflow|ventilation|chassis|desk\s+opening)/i.test(value)
    && /(?:case|cooler|desk|component|hardware|noise|temperature|thermal|acoustic|\bhot\b|\bloud\b|airflow|ventilation|chassis|opening|clearance)/i.test(value)) return 'physical-fit-noise';
  if (/(?:gpu|graphics\s+card|graphics\s+processing)/i.test(value)
    && /better\s+fit|which\s+gpu|choose|workload|gaming|blender|local\s+ai|mix/i.test(value)) return 'gpu-selection';
  if (/(?:\b32\s*gb\b|\b64\s*gb\b|memory|ram)/i.test(value)
    && /enough|required|capacity|scene|render|model|sufficient|upgrade/i.test(value)) return 'memory-capacity';
  if (/(?:budget|tax|shipping|all[- ]in|total|quote|\$\s*1[,.]?600)/i.test(value)) return 'build-budget';
  if (/(?:bios|motherboard|boot)/i.test(value) && /support|compatible|version|boot|ship/i.test(value)) return 'bios-compatibility';
  if (/(?:wi[- ]?fi|ethernet|cable|wireless)/i.test(value)) return 'network-connectivity';
  if (/(?:windows|operating\s+system|os\s+license|hyper[- ]?v|remote\s+desktop)/i.test(value)
    && /(?:home|pro|license|feature|sufficient|required|need|remote|virtual)/i.test(value)) return 'operating-system';

  // Existing high-value project families. These are intentionally narrow so
  // generic questions are not accidentally collapsed together.
  if (/(?:clinical|medical).*(?:accountab|owner|authority)|(?:accountab|owner|authority).*(?:medication|allergy|correction)/i.test(value)) return 'clinical-correction-authority';
  if (/(?:offline|queued?|retry|idempot|duplicate).*(?:ehr|record)|(?:ehr|record).*(?:offline|queued?|retry|duplicate)/i.test(value)) return 'ehr-retry-integrity';
  if (/(?:sms|text\s+message).*consent|consent.*(?:sms|text\s+message|phi)/i.test(value)) return 'sms-consent';
  if (/(?:coordinator|exception\s+review).*(?:peak|safe|capacity)|(?:peak|capacity).*(?:coordinator|exception)/i.test(value)) return 'exception-review-capacity';
  if (/(?:audit\s+log|audit\s+trail).*(?:distinguish|separate|edit)|(?:distinguish|separate|edit).*(?:audit\s+log|audit\s+trail)/i.test(value)) return 'audit-log-provenance';
  return undefined;
}

export function questionFamilyKey(text: string): string | undefined {
  return questionFamily(text);
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
  const candidateValue = candidate.toLowerCase();
  const existingValue = existing.toLowerCase();
  const candidateSpecific = /\b(?:rtx|rx|5070|9070|5060|balanced|performance|quiet|value|largest|normal|quote|selected|hot|loud|airflow|ventilation|chassis|thermal|acoustic)\b|desk\s+opening/i.test(candidateValue);
  const existingGeneric = /\b(?:selected|chosen|actual mix|final configuration|normal|existing|the build)\b/i.test(existingValue);
  return candidateSpecific && existingGeneric && candidateValue !== existingValue;
}

/**
 * Offline reconciliation used by demo mode and as a safe fallback when the
 * Context Agent is unavailable. It is intentionally conservative: unrelated
 * subjects never merge, while well-known project subjects receive stable
 * family matching.
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

  const canonicalQuestions = canonicalQuestionGroups(project).map((group) => group.canonical);
  const equivalent = canonicalQuestions.find((question) => semanticallyEquivalentQuestion(question.text, candidate.text));
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
  if (questionIdentityKey(left) === questionIdentityKey(right)) return true;
  const leftFamily = questionFamily(left);
  const rightFamily = questionFamily(right);
  if (leftFamily && leftFamily === rightFamily) return true;
  if (questionMeaningOverlap(left, right) >= 0.78) return true;

  const sharedCriticalTerms = [
    ['clinical', 'accountab'],
    ['medication', 'allergy'],
    ['offline', 'retry'],
    ['duplicate', 'ehr'],
    ['sms', 'consent'],
    ['coordinator', 'exception'],
    ['audit', 'log'],
  ].some(([first, second]) => {
    const combined = `${left} ${right}`.toLowerCase();
    return combined.includes(first)
      && combined.includes(second)
      && left.toLowerCase().includes(first)
      && right.toLowerCase().includes(first);
  });
  return sharedCriticalTerms;
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
      // A model-approved RELATED_BUT_DISTINCT result is an explicit boundary:
      // keep it separate even when the wording shares a broad subject family.
      const group = node.question_role === 'related'
        ? undefined
        : groups.find((candidate) => !candidate.some((item) => item.question_role === 'related')
          && semanticallyEquivalentQuestion(candidate[0].text, node.text));
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
