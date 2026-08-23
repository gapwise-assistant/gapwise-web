import { ClarityNode, ContextProcessingLog, ContextSource, EdgeType, Project, QuestionReconciliationSummary, UserMemoryProfile } from '@/types/clarity';
import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { projectForReasoning } from '@/lib/context/sourceState';
import { linkOpenDecisionQuestions, matchesExplicitDecisionTitle } from '@/lib/decisions/anchoring';
import {
  questionIdentityKey,
  questionsShareSubject,
  reconcileQuestionCandidate,
  semanticallyEquivalentQuestion,
  type QuestionReconciliationClassification,
} from '@/lib/questions/canonical';
import { resolveQuestionReferences } from '@/lib/questions/presentation';

export { semanticallyEquivalentQuestion } from '@/lib/questions/canonical';

export interface PrecomputedSourceNode {
  id?: string;
  type: ClarityNode['type'];
  text: string;
  confidence: number;
  impact?: number;
  whyItMatters?: string[];
  relatedNodeIds?: string[];
  relationship?: EdgeType;
  status?: ClarityNode['status'];
  questionClassification?: QuestionReconciliationClassification;
  canonicalQuestionId?: string;
  canonicalCandidateIndex?: number;
  reconciliationConfidence?: number;
  reconciliationReason?: string;
  questionAliases?: string[];
}

export interface PrecomputedRelationship {
  sourceNodeIndex: number;
  targetNodeId: string;
  type: EdgeType;
  confidence?: number;
}

export interface IngestSourceInput {
  sourceId?: string;
  filename: string;
  content: string;
  type: ContextSource['type'];
  mimeType?: string;
  sizeBytes?: number;
  storageUrl?: string;
  hash?: string;
  origin?: ContextSource['origin'];
  processingStatus?: ContextSource['processing_status'];
  errorMessage?: string;
  extractionSummary?: string;
  processedAt?: string;
  modelUsed?: string;
  extractionHash?: string;
  relevance?: ContextSource['relevance'];
  discardedAt?: string;
  reconciliationSummary?: QuestionReconciliationSummary;
  processingLog?: ContextProcessingLog;
  derivedNodes?: PrecomputedSourceNode[];
  relationships?: PrecomputedRelationship[];
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function hashText(value: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `fallback_${Math.abs(hash)}`;
}

export function inferNodeType(content: string): ClarityNode['type'] {
  const lower = content.toLowerCase();
  if (/[?]|\bunknown\b|\bunclear\b|\bnot sure\b|\bmissing\b/.test(lower)) return 'UNKNOWN';
  if (/\bmust\b|\brequire\b|\bdeadline\b|\bconstraint\b|\bcannot\b|\bcan't\b|\bbudget\b/.test(lower)) return 'CONSTRAINT';
  if (/\bprefer\b|\bpriority\b|\bimportant to me\b|\bwork style\b/.test(lower)) return 'PREFERENCE';
  if (/\brisk\b|\bdownside\b|\bconcern\b|\bworried\b/.test(lower)) return 'RISK';
  return 'KNOWN';
}

/**
 * Context documents often state an unresolved question in a bullet list, or
 * state the missing answer indirectly ("the required approval has not been recorded"). Keep a
 * small deterministic extractor beside ingestion so demo mode and an
 * unavailable model still produce the same useful graph shape.  This is not a
 * second ranking system: it only preserves explicit uncertainty from the
 * supplied source.
 */
function cleanQuestionLine(value: string): string {
  return value
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^\s*["“]|["”]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => cleanQuestionLine(line))
    .filter(Boolean);
}

const STATUS_PREDICATE = /\b(?:is|are|was|were)\s+(?:still\s+)?(?:being\s+)?(?:reviewed|considered|pending|uncertain|unresolved|missing|unknown|unconfirmed)\b/gi;
const REPORTING_CLAUSE = /\b(?:told|said|informed|advised|reported|notified|emailed|messaged)\s+(?:me|us|him|her|them)\s+/i;
const CONTINGENCY_TERM = /\b(?:fallback|backup|contingency|failover|recovery)\b/i;
const ABSENCE_TERM = /\b(?:no|not|without|missing|lack(?:s|ing)?|doesn['’]?t|does not|don['’]?t|do not|isn['’]?t|is not|aren['’]?t|are not)\b/i;
const FAILURE_TERM = /\b(?:fail(?:ed|ing|ure)?|error|invalid|mismatch(?:ed)?|inconsistent|blocked|broken|unavailable|unauthorized|denied|unable|cannot|can['’]?t|not working)\b/i;

function cleanStatusSubject(value: string): string | undefined {
  const subject = value
    .replace(/^[\s"“'(]+|[\s"”').!?]+$/g, '')
    .replace(/^\s*(?:the|this|my|our|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return subject.length >= 2 ? subject : undefined;
}

/**
 * Extracts the noun phrase immediately before a generic pending-status
 * predicate. Reporting clauses are grammar boundaries, so an actor such as
 * an authority's reporting clause cannot become part of the status subject.
 */
function statusSubjects(line: string): string[] {
  return Array.from(line.matchAll(STATUS_PREDICATE))
    .map((match) => {
      const predicateStart = match.index ?? 0;
      let prefix = line.slice(0, predicateStart);
      prefix = prefix.split(/[,;:]|\b(?:and|but|while|although)\b/i).at(-1) ?? prefix;
      const reporting = prefix.match(REPORTING_CLAUSE);
      if (reporting?.index !== undefined) prefix = prefix.slice(reporting.index + reporting[0].length);
      return cleanStatusSubject(prefix);
    })
    .filter((value): value is string => Boolean(value));
}

function subjectForStatusLine(line: string): string | undefined {
  return statusSubjects(line)[0];
}

interface NegativeActionParts {
  actor: string;
  action: string;
}

function unfinishedNeedActionParts(line: string): NegativeActionParts | undefined {
  const match = line.match(/(?:^|[,;:]|\band\b)\s*((?:i|we)\b)\s+(?:still\s+)?need\s+to\s+(.+?)[.!?]?$/i);
  if (!match?.[1] || !match[2] || /^(?:decide|choose|select|pick|determine|know|understand|find\s+out)\b/i.test(match[2].trim())) return undefined;
  return { actor: match[1].trim(), action: match[2].replace(/[.!?]+$/, '').trim() };
}

function negativeActionParts(line: string): NegativeActionParts | undefined {
  // A source sentence may introduce a fact before the user's unfinished
  // action: "The building requires ..., and I have not booked one yet."
  // Prefer that first-person clause so the action is not attributed to the
  // preceding subject.
  const firstPersonMatch = line.match(/(?:^|[,;:]|\band\b)\s*((?:i|we|my|our)\b)\s+(?:(?:has|have|had)\s+not|(?:hasn't|haven't|hadn't)|(?:did)\s+not|didn't)\s+(?:yet\s+)?(.+?)[.!?]?$/i);
  if (firstPersonMatch?.[1] && firstPersonMatch[2]) {
    return {
      actor: firstPersonMatch[1].trim(),
      action: firstPersonMatch[2].replace(/[.!?]+$/, '').trim(),
    };
  }
  const match = line.match(/^(.+?)\s+(?:(has|have|had)\s+not|(hasn't|haven't|hadn't)|(?:did)\s+not|didn't)\s+(?:yet\s+)?(.+?)[.!?]?$/i);
  if (!match?.[1]) return undefined;
  const action = match[4] ?? match[3];
  if (!action) return undefined;
  return {
    actor: match[1].trim(),
    action: action.replace(/[.!?]+$/, '').trim(),
  };
}

function isFirstPersonActor(actor: string): boolean {
  return /^(?:i|we|my|our)\b/i.test(actor.trim());
}

function reportedActor(line: string, actor: string): string | undefined {
  if (!/^(?:he|she|they|it)\b/i.test(actor.trim())) return undefined;
  const match = line.match(/^\s*((?:the|a|an)\s+[a-z][a-z0-9'/-]*(?:\s+[a-z][a-z0-9'/-]*){0,4}?)\s+(?:said|told|informed|advised|reported|notified|emailed|messaged)\s+(?:he|she|they|it)\b/i);
  const subject = match?.[1]?.trim();
  if (!subject) return undefined;
  return `the ${subject.replace(/^(?:the|a|an)\s+/i, '')}`;
}

function baseActionVerb(value: string): string {
  const verb = value.toLowerCase();
  if (verb.endsWith('ies') && verb.length > 4) return `${verb.slice(0, -3)}y`;
  if (verb.endsWith('ied') && verb.length > 4) return `${verb.slice(0, -3)}y`;
  if (verb.endsWith('ed') && verb.length > 4) {
    const stem = verb.slice(0, -2);
    if (stem.endsWith('c') || stem.endsWith('v')) return `${stem}e`;
    return stem;
  }
  return verb;
}

function antecedentFromPreviousLines(previousLines: string[]): string | undefined {
  for (const line of [...previousLines].reverse()) {
    const match = line.match(/\b(?:contains?|includes?|stores?|holds?|uses?|mentions?|references?|lists?|tracks?|records?|captures?|has)\s+(.+?)[.!?]?$/i);
    const antecedent = match?.[1]?.trim();
    if (!antecedent || /^(?:not|no|never|still)\b/i.test(antecedent)) continue;
    if (antecedent.split(/\s+/).length > 12) continue;
    return antecedent;
  }
  return undefined;
}

function resolveActionPronouns(action: string, previousLines: string[]): string | undefined {
  if (!/\b(?:it|them|this|that)\b/i.test(action)) return action;
  const antecedent = antecedentFromPreviousLines(previousLines);
  if (!antecedent) return undefined;
  return action
    .replace(/\bit\b/gi, antecedent)
    .replace(/\bthem\b/gi, antecedent)
    .replace(/\b(this|that)\b/gi, antecedent);
}

function actionText(action: string, previousLines: string[] = []): string | undefined {
  const cleanedAction = action.replace(/\s+(?:yet|still)$/i, '').trim();
  const words = cleanedAction.split(/\s+/).filter(Boolean);
  if (!words.length || /^been\b/i.test(action)) return undefined;
  const [verb, ...rest] = words;
  const phrase = resolveActionPronouns([baseActionVerb(verb), ...rest].join(' '), previousLines);
  if (!phrase) return undefined;
  const groundedQuestion = resolveQuestionReferences(`Should I ${phrase}?`, previousLines.join(' '));
  return groundedQuestion
    .replace(/^Should I\s+/i, '')
    .replace(/[?]+$/, '.')
    .replace(/^./, (value) => value.toUpperCase());
}

/**
 * Converts an explicit negative or pending statement into a confirmation
 * question without guessing the domain, answer, owner, or next decision.
 * Passive status statements use the subject as the thing to verify; active
 * statements preserve the named source and action ("The responsible source
 * has not confirmed X" -> "Has the responsible source confirmed X?").
 */
function negativeStatementQuestion(line: string, previousLines: string[] = []): string | undefined {
  const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!/(?:has|have|had)\s+not\b|\b(?:hasn't|haven't|hadn't|did\s+not|didn't)\b|\b(?:is|are|was|were)\s+(?:still\s+)?(?:being\s+)?(?:reviewed|considered|pending|uncertain|unresolved|missing|unknown|unconfirmed)\b|\b(?:pending|under review|unapproved|unconfirmed|unresolved|missing)\b/.test(normalized)) {
    return undefined;
  }

  // Keep the grammar generic: the unresolved action may be any verb phrase,
  // not only one of the common approval/status verbs. This is what lets
  // first-person source prose such as "I have not tested both values..."
  // become a usable question without domain-specific vocabulary.
  const active = negativeActionParts(line);
  if (active) {
    // The source already answers user-controlled action questions such as
    // "I have not tested it." Keep that status as evidence and derive work
    // from it instead of asking whether the known action happened.
    if (isFirstPersonActor(active.actor)) return undefined;
    const actor = (active.actor.split(/,|\b(?:and|but|while|although)\b/i).at(-1)?.trim() ?? active.actor.trim())
      .replace(/^(The|A|An)\b/, (article) => article.toLowerCase());
    const action = resolveActionPronouns(active.action, previousLines);
    if (!action) return undefined;
    const subject = reportedActor(line, actor) ?? actor;
    return resolveQuestionReferences(`Has ${subject} ${action}?`, [...previousLines, line].join(' '));
  }

  const passive = line.match(/^(.+?)\s+has\s+not\s+(?:yet\s+)?(?:been\s+)?(approved|confirmed|reviewed|verified|recorded)[.!?]?$/i);
  if (passive?.[1]) {
    const subject = passive[1].replace(/^\s*(?:the|a|an)\s+/i, '').trim();
    return `What ${subject} is currently confirmed?`;
  }

  const subject = subjectForStatusLine(line);
  if (!subject) return undefined;
  return `What current status is recorded for ${subject}?`;
}

function missingContingencyQuestion(line: string): string | undefined {
  const contingency = line.match(CONTINGENCY_TERM)?.[0].toLowerCase();
  const condition = line.match(/^\s*if\s+(.+?),\s*/i)?.[1]
    ?.replace(/[.!?]+$/, '')
    .trim();
  if (!contingency || !condition || !ABSENCE_TERM.test(line)) return undefined;
  return `What ${contingency} is available if ${condition}?`;
}

function questionNodesFromTexts(texts: string[]): PrecomputedSourceNode[] {
  return Array.from(new Map(texts.map((text) => [questionIdentityKey(text), text])).values()).map((text) => ({
    type: 'UNKNOWN',
    text,
    confidence: 0.86,
    impact: 0.82,
    whyItMatters: ['Explicitly unresolved in the supplied project context.'],
    status: 'OPEN',
  }));
}

/** Questions written literally by the user, kept with their original wording. */
export function extractLiteralQuestionNodes(content: string): PrecomputedSourceNode[] {
  const questions = sentenceLines(content)
    .map((line) => cleanQuestionLine(line))
    .filter((line) => line.endsWith('?') && line.length >= 12);
  return questionNodesFromTexts(questions);
}

/**
 * Questions inferred from pending or negative prose. These are fallback
 * candidates only; model-backed finalization selects the narrow first-person
 * subset when the model omits an unresolved action question.
 */
export function extractInferredStatusQuestionNodes(content: string): PrecomputedSourceNode[] {
  const inferredQuestions: string[] = [];
  const lines = sentenceLines(content);
  lines.forEach((line, index) => {
    const cleaned = cleanQuestionLine(line);
    if (cleaned.endsWith('?')) return;

    const contingency = missingContingencyQuestion(cleaned);
    if (contingency) inferredQuestions.push(contingency);

    const inferred = negativeStatementQuestion(cleaned, lines.slice(0, index));
    if (inferred) inferredQuestions.push(inferred);

    // A prose sentence can contain more than one explicit status clause
    // ("Transport is uncertain, and the team has not confirmed ..."). Keep
    // both uncertainties without interpreting either domain.
    statusSubjects(cleaned).forEach((subject) => {
      if (inferred?.toLowerCase().includes(subject.toLowerCase())) return;
      inferredQuestions.push(`What current status is recorded for ${subject}?`);
    });
  });
  return questionNodesFromTexts(inferredQuestions);
}

/**
 * First-person negative action statements are known status, not unknowns.
 * Preserve the exact sentence as evidence and expose the unfinished action
 * without turning it into a yes/no question.
 */
export function extractDeterministicActionNodes(content: string): PrecomputedSourceNode[] {
  const actions: PrecomputedSourceNode[] = [];
  const lines = sentenceLines(content);
  lines.forEach((line, index) => {
    const parts = negativeActionParts(line) ?? unfinishedNeedActionParts(line);
    if (!parts || !isFirstPersonActor(parts.actor)) return;
    const action = actionText(parts.action, [...lines.slice(0, index), line]);
    if (!action) return;
    actions.push({
      type: 'NEXT_ACTION',
      text: action.endsWith('.') ? action : `${action}.`,
      confidence: 0.84,
      impact: 0.78,
      whyItMatters: ['This action is explicitly unfinished in the supplied project context.'],
      status: 'OPEN',
    });
  });
  return Array.from(new Map(actions.map((node) => [node.text.toLowerCase(), node])).values());
}

function actionAsGerund(action: string): string {
  const words = action.replace(/[.!?]+$/, '').trim().split(/\s+/).filter(Boolean);
  const verb = words.shift()?.toLowerCase() ?? '';
  const gerund = verb.endsWith('ie')
    ? `${verb.slice(0, -2)}ying`
    : verb.endsWith('e') && !verb.endsWith('ee')
      ? `${verb.slice(0, -1)}ing`
      : /[^aeiou][aeiou][^aeiouwxy]$/.test(verb)
        ? `${verb}${verb.at(-1) ?? ''}ing`
        : `${verb}ing`;
  return [gerund, ...words].join(' ');
}

function failureOutcomeSubject(line: string): string | undefined {
  const cleaned = line.replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  const state = cleaned.match(/\b(?:is|are|was|were)\s+(?:currently\s+)?(?:failing|broken|blocked|unavailable|not working)\b/i);
  if (state?.index === undefined) return undefined;
  const subject = cleaned.slice(0, state.index)
    .replace(/^\s*(?:the|a|an|this|that|my|our)\s+/i, '')
    .trim();
  if (!subject) return undefined;
  const detail = cleaned.slice(state.index + state[0].length).replace(/^\s+with\s+/i, '').trim();
  return `${subject} failure${detail ? ` (${detail})` : ''}`;
}

/**
 * Derive one outcome question only when the source contains both an
 * unfinished user action and a concrete failure state. Ordinary unfinished
 * actions remain evidence plus NEXT_ACTION; they are not automatically
 * treated as knowledge gaps.
 */
export function extractDeterministicFailureOutcomeQuestionNodes(
  content: string,
  selectedActionText?: string,
): PrecomputedSourceNode[] {
  const failureLines = sentenceLines(content).filter((line) => FAILURE_TERM.test(line));
  const actions = extractDeterministicActionNodes(content);
  if (failureLines.length !== 1 || actions.length === 0 || (!selectedActionText && actions.length !== 1)) return [];
  const action = selectedActionText
    ? actions.find((candidate) => candidate.text === selectedActionText)
    : actions[0];
  if (!action) return [];
  const failureLine = failureLines[0];
  const subject = failureOutcomeSubject(failureLine);
  if (!subject) return [];
  return questionNodesFromTexts([
    `Does ${actionAsGerund(action.text)} resolve the ${subject}?`,
  ]);
}

/**
 * Extracts only missing-contingency questions for model-backed finalization.
 * This lets a successful analysis retain a useful gap when the model records
 * the risk but omits the corresponding unresolved question.
 */
export function extractMissingContingencyQuestionNodes(content: string): PrecomputedSourceNode[] {
  return questionNodesFromTexts(
    sentenceLines(content)
      .map((line) => missingContingencyQuestion(line))
      .filter((question): question is string => Boolean(question))
  );
}

/**
 * Compatibility entry point for demo and model-unavailable ingestion. It
 * combines literal and inferred candidates only when no model finalizer is
 * available to choose between them.
 */
export function extractDeterministicQuestionNodes(content: string): PrecomputedSourceNode[] {
  const literalQuestions = extractLiteralQuestionNodes(content);
  return questionNodesFromTexts([
    ...literalQuestions.map((node) => node.text),
    ...extractInferredStatusQuestionNodes(content).map((node) => node.text),
    ...(literalQuestions.length === 0
      ? extractDeterministicFailureOutcomeQuestionNodes(content).map((node) => node.text)
      : []),
  ]);
}

export function extractDeterministicEvidenceNodes(content: string): PrecomputedSourceNode[] {
  const seen = new Set<string>();
  return sentenceLines(content)
    .filter((line) => {
      const explicitNegative = /(?:has|have|had|is|are|was|were|did|does|do)\s+(?:not|n't)\b/i.test(line);
      const pendingStatus = /\b(?:pending|under review|unapproved|unconfirmed|missing)\b/i.test(line);
      // A pending decision/deadline is already represented by the decision
      // extractor; retain evidence for unresolved prerequisites instead.
      return explicitNegative || (pendingStatus && !/\b(?:decision|deadline)\b/i.test(line));
    })
    .filter((line) => {
      const key = line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((text) => ({
      type: 'EVIDENCE',
      text,
      confidence: 0.82,
      impact: 0.56,
      whyItMatters: ['Negative or pending status retained as source evidence.'],
    }));
}

export function extractDeterministicDecisionNode(content: string): PrecomputedSourceNode | undefined {
  const line = sentenceLines(content).find((candidate) =>
    /\b(?:pending|open|unresolved|not yet approved|still open)\b.{0,80}\b(?:decision|go\s*\/\s*no[- ]go|choice)\b/i.test(candidate)
    || /\b(?:decision|go\s*\/\s*no[- ]go)\b.{0,80}\b(?:pending|open|unresolved|still open|not made)\b/i.test(candidate)
    || /\b(?:i|we)\s+(?:still\s+)?need\s+to\s+decide\b/i.test(candidate)
    || /\b(?:i|we)\s+(?:still\s+)?haven['’]?t\s+decided\b/i.test(candidate)
  );
  if (!line) return undefined;
  const text = line.replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  return {
    type: 'DECISION',
    text: text.length > 220 ? `${text.slice(0, 217)}...` : text,
    confidence: 0.9,
    impact: 0.92,
    whyItMatters: ['The source explicitly describes a pending project choice.'],
    status: 'OPEN',
  };
}

function fallbackNodesForSource(content: string): PrecomputedSourceNode[] {
  const questionNodes = extractDeterministicQuestionNodes(content);
  const actionNodes = extractDeterministicActionNodes(content);
  const evidenceNodes = extractDeterministicEvidenceNodes(content);
  const decisionNode = extractDeterministicDecisionNode(content);
  if (questionNodes.length || actionNodes.length || evidenceNodes.length || decisionNode) {
    return [ ...(decisionNode ? [decisionNode] : []), ...questionNodes, ...actionNodes, ...evidenceNodes ];
  }
  const type = inferNodeType(content);
  return [{
    type,
    text: `From supplied context: ${content.slice(0, 180)}${content.length > 180 ? '...' : ''}`,
    confidence: type === 'UNKNOWN' || type === 'CONSTRAINT' ? 0.86 : 0.68,
    impact: type === 'CONSTRAINT' || type === 'UNKNOWN' ? 0.78 : 0.62,
  }];
}

/** Deterministic graph fallback used when model analysis is unavailable. */
export function extractDeterministicFallbackNodes(content: string): PrecomputedSourceNode[] {
  return fallbackNodesForSource(content);
}

function inferFallbackResolutionTargets(project: Project, content: string): ClarityNode[] {
  const lower = content.toLowerCase();
  if (!/\b(?:test|trial|experiment|demonstrated|confirmed|approved|completed|produced|passed|verified|shows?|recorded)\b/i.test(lower)) return [];

  const positiveContent = sentenceLines(content)
    .filter((line) => !/(?:has|have|had|is|are|was|were|did|does|do)\s+(?:not|n't)\b/i.test(line))
    .join(' ');
  if (!positiveContent.trim()) return [];
  const contentTokens = new Set(questionIdentityKey(positiveContent).split(' ').filter(Boolean));
  const genericTokens = new Set(['current', 'status', 'record', 'recorded', 'confirm', 'confirmed', 'approval', 'approved', 'review', 'reviewed']);
  return project.nodes.filter((node) => {
    if (!['UNKNOWN', 'ASSUMPTION'].includes(node.type) || node.status !== 'OPEN') return false;
    const questionTokens = questionIdentityKey(node.text).split(' ').filter((token) => !genericTokens.has(token));
    const overlap = questionTokens.filter((token) => contentTokens.has(token)).length;
    return overlap >= 3;
  });
}

export function summarizeExtraction(source: Pick<ContextSource, 'type' | 'content'>): string {
  if (source.type === 'image') return 'Image/screenshot added with user-visible text or description for provenance.';
  if (source.type === 'voice') return 'Voice note transcript or summary captured as personal context.';
  if (source.type === 'pdf') return 'PDF text/excerpt captured for graph extraction and retrieval.';
  return 'Text context captured for graph extraction and retrieval.';
}

function statusForNodeType(
  type: ClarityNode['type'],
  requestedStatus?: ClarityNode['status'],
  sourceContent = '',
  nodeText = '',
): ClarityNode['status'] {
  if (type === 'DECISION') {
    if (requestedStatus === 'OPEN' || requestedStatus === 'RESOLVED') return requestedStatus;
    if (matchesExplicitDecisionTitle(nodeText, sourceContent)) return 'OPEN';
  }
  return type === 'UNKNOWN' || type === 'ASSUMPTION' || type === 'RISK' || type === 'NEXT_ACTION' || type === 'GOAL' || type === 'EXPERIMENT'
    ? 'OPEN'
    : 'RESOLVED';
}

function nodeKey(type: ClarityNode['type'], text: string): string {
  if (type === 'UNKNOWN' || type === 'ASSUMPTION') {
    const key = questionIdentityKey(text);
    if (key) return `${type}:question:${key}`;
  }
  return `${type}:${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

function fallbackStatusEquivalent(left: string, right: string): boolean {
  return questionsShareSubject(left, right);
}

function mergeUnique(values: string[] | undefined, additions: string[] | undefined): string[] | undefined {
  const merged = Array.from(new Set([...(values ?? []), ...(additions ?? [])].filter(Boolean)));
  return merged.length ? merged : undefined;
}

function reconciliationSummaryForNodes(nodes: PrecomputedSourceNode[]): QuestionReconciliationSummary {
  const questions = nodes.filter((node) => node.type === 'UNKNOWN' || node.type === 'ASSUMPTION');
  const classifications = questions.map((node) => node.questionClassification);
  return {
    candidate_count: questions.length,
    canonical_merge_count: classifications.filter((value) => value === 'PARAPHRASE').length,
    subquestion_count: classifications.filter((value) => value === 'SUBQUESTION').length,
    assumption_count: classifications.filter((value) => value === 'ASSUMPTION').length,
    new_question_count: classifications.filter((value) => value === 'NEW_UNCERTAINTY' || value === 'RELATED_BUT_DISTINCT' || value === undefined).length,
    fallback_count: classifications.filter((value) => value === undefined).length,
    validation_status: classifications.some((value) => value === undefined) ? 'fallback' : 'passed',
  };
}

function reconciliationNote(
  relationship: EdgeType,
  sourceFilename: string,
  targetText: string
): string | undefined {
  if (relationship === 'contradicts') {
    return `Questioned by newer evidence from ${sourceFilename}: ${targetText}`;
  }
  if (relationship === 'supersedes') {
    return `Superseded by newer evidence from ${sourceFilename}: ${targetText}`;
  }
  if (relationship === 'resolves') {
    return `Resolved by newer evidence from ${sourceFilename}: ${targetText}`;
  }
  return undefined;
}

function applyRelationshipState(
  target: ClarityNode,
  relationship: EdgeType,
  sourceId: string,
  sourceFilename: string,
  now: string
): void {
  // A relationship is not automatically direct provenance. Only evidence
  // relationships that can substantively update the target's understanding
  // should add this source to its Evidence list. Structural links such as
  // depends_on/blocks/affects must remain graph context without making the
  // source appear to state the target question itself.
  if (['supports', 'contradicts', 'resolves', 'supersedes'].includes(relationship)) {
    target.source_refs = Array.from(new Set([...target.source_refs, sourceId]));
  }
  const note = reconciliationNote(relationship, sourceFilename, target.text);
  if (note) target.why_it_matters = mergeUnique(target.why_it_matters, [note]);
  target.updated_at = now;

  if (relationship === 'contradicts' && ['KNOWN', 'ASSUMPTION', 'DECISION', 'EVIDENCE'].includes(target.type)) {
    target.status = 'DEFERRED';
  }
  if (relationship === 'supersedes') target.status = 'DEPRECATED';
  if (relationship === 'resolves' && ['UNKNOWN', 'ASSUMPTION'].includes(target.type)) {
    target.status = 'RESOLVED';
  }
}

/**
 * A stored EVIDENCE node is complete as a record, but that lifecycle state
 * does not mean the evidence answers another node. Resolution requires a
 * result-bearing statement and must reject language that explicitly leaves
 * the result pending or unverified.
 */
function hasConclusiveResultEvidence(node: ClarityNode): boolean {
  if (!['KNOWN', 'EVIDENCE', 'EXPERIMENT'].includes(node.type)) return false;
  const text = node.text.trim();
  if (!text || /\b(?:(?:has|have|did|does)\s+not\s+(?:yet\s+)?(?:test(?:ed)?|verif(?:y|ied)|confirm(?:ed)?|record(?:ed)?|receiv(?:e|ed)|complet(?:e|ed)|resolv(?:e|ed))|not tested|still pending|under review|no response|result unknown|unresolved|unconfirmed|not verified|not recorded)\b/i.test(text)) {
    return false;
  }
  return /\b(?:returned|created|produced|passed|failed|rejected|approved|confirmed|verified|recorded|completed|received|shows?|demonstrated|succeeded|successfully|matched|resolved)\b/i.test(text);
}

/**
 * Keep model-supplied graph edges role-compatible. A valid node id and a high
 * confidence score are not enough: for example, a question should not
 * support an unrelated fact, and evidence should not block a decision. This
 * is deliberately type-based so it stays generic across projects.
 */
function relationshipRoleCompatible(
  source: ClarityNode,
  target: ClarityNode,
  relationship: EdgeType,
): boolean {
  const question = (node: ClarityNode) => node.type === 'UNKNOWN' || node.type === 'ASSUMPTION';
  const evidence = (node: ClarityNode) => ['KNOWN', 'EVIDENCE', 'EXPERIMENT'].includes(node.type);
  const structuralTarget = (node: ClarityNode) => question(node)
    || ['GOAL', 'DECISION', 'NEXT_ACTION', 'RISK', 'CONSTRAINT'].includes(node.type);

  switch (relationship) {
    case 'supports':
      return evidence(source) || source.type === 'PREFERENCE';
    case 'contradicts':
      return evidence(source) && (evidence(target) || question(target) || target.type === 'DECISION');
    case 'resolves':
      return hasConclusiveResultEvidence(source)
        && (question(target) || target.type === 'DECISION');
    case 'supersedes':
      return evidence(source) && (evidence(target) || question(target) || target.type === 'DECISION');
    case 'blocks':
      return (question(source) || ['RISK', 'CONSTRAINT', 'NEXT_ACTION', 'DECISION'].includes(source.type))
        && structuralTarget(target);
    case 'depends_on':
      return (question(source) || ['RISK', 'CONSTRAINT', 'NEXT_ACTION', 'DECISION'].includes(source.type))
        && structuralTarget(target);
    case 'informs':
      return (evidence(source) || question(source) || ['RISK', 'CONSTRAINT', 'NEXT_ACTION', 'DECISION', 'PREFERENCE'].includes(source.type))
        && structuralTarget(target);
    case 'affects':
      return (evidence(source) || question(source) || ['RISK', 'CONSTRAINT', 'NEXT_ACTION', 'DECISION', 'PREFERENCE'].includes(source.type))
        && structuralTarget(target);
    case 'derived_from':
      return source.id !== target.id;
    default:
      return false;
  }
}

function relationshipTokens(text: string): Set<string> {
  return new Set(questionIdentityKey(text)
    .split(' ')
    .filter((token) => token.length >= 4)
    .filter((token) => !['current', 'result', 'status', 'question', 'decision', 'action', 'information'].includes(token)));
}

/**
 * Structural edges are allowed to express dependency without lexical overlap.
 * Evidence-to-decision edges are different: without either an explicit node
 * link or a shared subject, a same-source edge can make unrelated facts look
 * like decision evidence.
 */
function relationshipHasSemanticSupport(
  source: ClarityNode,
  target: ClarityNode,
  relationship: EdgeType,
  explicitlyLinked: boolean,
): boolean {
  if (explicitlyLinked || !((relationship === 'informs' || relationship === 'affects') && ['KNOWN', 'EVIDENCE', 'EXPERIMENT'].includes(source.type) && target.type === 'DECISION')) {
    return true;
  }
  const sourceTokens = relationshipTokens(source.text);
  const targetTokens = relationshipTokens(target.text);
  const shared = [...sourceTokens].filter((token) => targetTokens.has(token)).length;
  return shared >= 2;
}

export async function ingestContextSource(
  project: Project,
  input: IngestSourceInput,
  profile: UserMemoryProfile
): Promise<Project> {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const now = new Date().toISOString();
  const sourceId = input.sourceId ?? makeId('src');
  const content = input.content.trim();
  const previousSource = updated.sources.find((source) => source.id === sourceId);
  const previousDerivedNodeIds = new Set(previousSource?.derived_node_ids ?? []);
  const shouldCreateNode = Boolean(content)
    && ((input.processingStatus ?? (content ? 'completed' : 'failed')) !== 'failed' || Boolean(input.derivedNodes?.length));
  if (previousSource) {
    if (shouldCreateNode) {
      previousDerivedNodeIds.forEach((nodeId) => {
        const previousNode = updated.nodes.find((node) => node.id === nodeId);
        if (!previousNode) return;
        const hasOtherActiveSource = previousNode.source_refs.some((ref) =>
          ref !== sourceId && updated.sources.some((source) => source.id === ref && !source.discarded_at)
        );
        if (hasOtherActiveSource) return;
        previousNode.status = 'DEPRECATED';
        previousNode.why_it_matters = mergeUnique(previousNode.why_it_matters, [
          `Retained as historical context after ${input.filename} was re-analyzed.`,
        ]);
        previousNode.updated_at = now;
      });
    }
    updated.sources = updated.sources.filter((source) => source.id !== sourceId);
  }
  const processingStatus = input.processingStatus ?? (content ? 'completed' : 'failed');
  // A completed/failed processing attempt must always have an observable end
  // time. Older callers often supplied only a status, which made Context show
  // both "Processed" and "Not processed yet" for the same source.
  const processedAt = input.processedAt
    ?? (processingStatus === 'completed' || processingStatus === 'failed' ? now : undefined);
  const derivedNodes = input.derivedNodes ?? [];

  const newSource: ContextSource = {
    id: sourceId,
    filename: input.filename,
    type: input.type,
    content,
    extracted_at: now,
    derived_node_ids: [],
    processing_status: processingStatus,
    storage_url: input.storageUrl,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    hash: input.hash ?? (await hashText(`${input.filename}:${content}`)),
    origin: input.origin ?? 'user',
    extraction_summary: input.extractionSummary ?? summarizeExtraction({ type: input.type, content }),
    error_message: input.errorMessage ?? (content ? undefined : 'No extractable text or user description was provided.'),
    processed_at: processedAt,
    model_used: input.modelUsed,
    extraction_hash: input.extractionHash,
    relevance: input.relevance ?? 'relevant',
    discarded_at: input.discardedAt ?? previousSource?.discarded_at,
    reconciliation_summary: input.reconciliationSummary,
    processing_log: input.processingLog,
  };

  updated.sources.push(newSource);

  if (shouldCreateNode) {
    // An explicitly supplied empty list is a successful model result with no
    // derived nodes. Only callers that omit derivedNodes use deterministic
    // demo/model-unavailable extraction.
    const nodesToProcess = input.derivedNodes !== undefined
      ? derivedNodes
      : fallbackNodesForSource(content);
    const nodeIds: string[] = [];

    nodesToProcess.forEach((node) => {
      const deterministicReconciliation = (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
        ? reconcileQuestionCandidate(node, updated)
        : undefined;
      const questionClassification = node.questionClassification ?? deterministicReconciliation?.classification;
      const siblingTargetId = node.canonicalCandidateIndex !== undefined
        ? nodeIds[node.canonicalCandidateIndex]
        : undefined;
      const siblingTarget = siblingTargetId
        ? updated.nodes.find((candidate) => candidate.id === siblingTargetId)
        : undefined;
      const validSiblingTarget = siblingTarget && (siblingTarget.type === 'UNKNOWN' || siblingTarget.type === 'ASSUMPTION')
        ? siblingTarget
        : undefined;
      const canonicalQuestionId = node.canonicalQuestionId
        ?? validSiblingTarget?.canonical_question_id
        ?? validSiblingTarget?.id
        ?? deterministicReconciliation?.canonicalQuestionId;
      const reconciliationTarget = canonicalQuestionId
        ? updated.nodes.find((candidate) => candidate.id === canonicalQuestionId)
        : undefined;
      const key = nodeKey(node.type, node.text);
      const exactExistingNode = updated.nodes.find((candidate) => nodeKey(candidate.type, candidate.text) === key);
      const deterministicParaphraseTarget = deterministicReconciliation?.classification === 'PARAPHRASE'
        && questionClassification !== 'SUBQUESTION'
        && questionClassification !== 'ASSUMPTION';
      let existingNode = ((questionClassification === 'PARAPHRASE' || deterministicParaphraseTarget) && reconciliationTarget)
        ? reconciliationTarget
        : exactExistingNode;
      if (!existingNode && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && !canonicalQuestionId && !node.questionClassification) {
        existingNode = updated.nodes.find((candidate) =>
          (candidate.type === 'UNKNOWN' || candidate.type === 'ASSUMPTION')
          && semanticallyEquivalentQuestion(candidate.text, node.text)
        );
      }
      if (!existingNode && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && !canonicalQuestionId && !node.questionClassification) {
        existingNode = updated.nodes.find((candidate) =>
          (candidate.type === 'UNKNOWN' || candidate.type === 'ASSUMPTION')
          && fallbackStatusEquivalent(node.text, candidate.text)
        );
      }
      if (existingNode) {
        const previousText = existingNode.text;
        if (node.questionClassification && !node.canonicalQuestionId && existingNode.reconciliation_status === 'fallback') {
          existingNode.text = node.text;
        }
        existingNode.source_refs = Array.from(new Set([...existingNode.source_refs, sourceId]));
        existingNode.confidence = Math.max(existingNode.confidence, node.confidence);
        existingNode.impact = Math.max(existingNode.impact, node.impact ?? node.confidence);
        existingNode.why_it_matters = mergeUnique(existingNode.why_it_matters, node.whyItMatters);
        if (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') {
          existingNode.question_aliases = Array.from(new Set([
            ...(existingNode.question_aliases ?? []),
            ...(node.questionAliases ?? []),
            ...(previousText === existingNode.text ? [] : [previousText]),
            ...(node.text === existingNode.text ? [] : [node.text]),
          ].filter((text) => text && text !== existingNode.text)));
          if (questionClassification === 'PARAPHRASE') existingNode.question_role = 'canonical';
        }
        existingNode.reconciliation_confidence = Math.max(
          existingNode.reconciliation_confidence ?? 0,
          node.reconciliationConfidence ?? deterministicReconciliation?.confidence ?? 0,
        );
        existingNode.reconciliation_reason = node.reconciliationReason ?? deterministicReconciliation?.reason ?? existingNode.reconciliation_reason;
        existingNode.reconciliation_status = node.questionClassification ? 'reconciled' : 'fallback';
        existingNode.updated_at = now;
        if (previousDerivedNodeIds.has(existingNode.id)) {
          existingNode.status = statusForNodeType(existingNode.type, node.status, content, node.text);
        } else if (existingNode.type === 'DECISION' && node.status === 'OPEN') {
          existingNode.status = 'OPEN';
        }
        nodeIds.push(existingNode.id);
        return;
      }

      const createdNode: ClarityNode = {
        id: node.id ?? makeId('node_ext'),
        type: node.type,
        text: node.text,
        status: statusForNodeType(node.type, node.status, content, node.text),
        confidence: node.confidence,
        impact: node.impact ?? node.confidence,
        source_refs: [sourceId],
        why_it_matters: node.whyItMatters,
        created_by: 'agent',
        created_at: now,
        updated_at: now,
        x: 180 + Math.random() * 360,
        y: 220 + Math.random() * 280,
        question_role: (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
          ? (questionClassification === 'SUBQUESTION'
            ? 'subquestion'
            : questionClassification === 'ASSUMPTION'
              ? 'assumption'
              : questionClassification === 'RELATED_BUT_DISTINCT'
                ? 'related'
                : 'canonical')
          : undefined,
        canonical_question_id: canonicalQuestionId,
        question_aliases: node.type === 'UNKNOWN' || node.type === 'ASSUMPTION'
          ? Array.from(new Set((node.questionAliases ?? []).filter((text) => text && text !== node.text)))
          : undefined,
        reconciliation_confidence: node.reconciliationConfidence ?? deterministicReconciliation?.confidence,
        reconciliation_reason: node.reconciliationReason ?? deterministicReconciliation?.reason,
        reconciliation_status: node.questionClassification ? 'reconciled' : ((node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') ? 'fallback' : undefined),
      };
      updated.nodes.push(createdNode);
      nodeIds.push(createdNode.id);
    });

    newSource.derived_node_ids = nodeIds;
    newSource.reconciliation_summary = input.reconciliationSummary ?? reconciliationSummaryForNodes(nodesToProcess);

    const relationships: PrecomputedRelationship[] = [
      ...(input.relationships ?? []),
      ...nodesToProcess.flatMap((node, sourceNodeIndex) =>
        node.relationship && node.relatedNodeIds?.length
          ? node.relatedNodeIds.map((targetNodeId) => ({
              sourceNodeIndex,
              targetNodeId,
              type: node.relationship as EdgeType,
              confidence: node.confidence,
            }))
          : []
      ),
    ];

    relationships.forEach((relationship) => {
      const sourceNodeId = nodeIds[relationship.sourceNodeIndex];
      const targetNodeId = relationship.targetNodeId.startsWith('new:')
        ? nodeIds[Number(relationship.targetNodeId.slice(4))]
        : relationship.targetNodeId;
      if (!sourceNodeId || !targetNodeId) return;
      const sourceNode = updated.nodes.find((candidate) => candidate.id === sourceNodeId);
      const targetNode = updated.nodes.find((candidate) => candidate.id === targetNodeId);
      if (!sourceNode || !targetNode) return;
      if (sourceNodeId === targetNodeId) {
        return;
      }
      if (!relationshipRoleCompatible(sourceNode, targetNode, relationship.type)) return;
      const sourceSpec = nodesToProcess[relationship.sourceNodeIndex];
      const explicitlyLinked = Boolean(sourceSpec?.relatedNodeIds?.some((id) => id === relationship.targetNodeId || id === targetNodeId));
      if (!relationshipHasSemanticSupport(sourceNode, targetNode, relationship.type, explicitlyLinked)) return;
      const confidence = relationship.confidence ?? nodesToProcess[relationship.sourceNodeIndex]?.confidence ?? 0;
      if (confidence < 0.6) return;
      const exists = updated.edges.some((edge) =>
        edge.source === sourceNodeId && edge.target === targetNodeId && edge.type === relationship.type
      );
      if (!exists) {
        updated.edges.push({
          id: makeId('edge_context'),
          source: sourceNodeId,
          target: targetNodeId,
          type: relationship.type,
          confidence,
        });
      }
      if (targetNode) applyRelationshipState(targetNode, relationship.type, sourceId, input.filename, now);
    });

    // In the zero-cost/local path, a conclusive test or approval statement can
    // answer an existing UNKNOWN even when no structured relationship was
    // supplied by a model. Negative blocker statements intentionally do not
    // resolve anything; they remain evidence on the open question.
    const fallbackResolutionTargets = input.derivedNodes?.length
      ? []
      : inferFallbackResolutionTargets(updated, content);
    const resolutionSourceId = nodeIds.find((nodeId) =>
      fallbackResolutionTargets.every((target) => target.id !== nodeId)
      && updated.nodes.some((node) => node.id === nodeId && ['KNOWN', 'EVIDENCE', 'EXPERIMENT'].includes(node.type))
    );
    if (resolutionSourceId) {
      fallbackResolutionTargets.forEach((targetNode) => {
        const exists = updated.edges.some((edge) =>
          edge.source === resolutionSourceId && edge.target === targetNode.id && edge.type === 'resolves'
        );
        if (!exists) {
          updated.edges.push({
            id: makeId('edge_context'),
            source: resolutionSourceId,
            target: targetNode.id,
            type: 'resolves',
            confidence: 0.88,
          });
        }
        applyRelationshipState(targetNode, 'resolves', sourceId, input.filename, now);
      });
    }

    linkOpenDecisionQuestions(updated, sourceId, content, nodeIds, now);
  }

  const reasoningProject = projectForReasoning(updated);
  updated.clarity_score = calculateClarityScore(reasoningProject);
  updated.active_question = selectTopGap(reasoningProject, profile);
  updated.updated_at = now;
  return updated;
}

export function discardContextSource(project: Project, sourceId: string, profile: UserMemoryProfile): Project {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const source = updated.sources.find((candidate) => candidate.id === sourceId);
  if (!source) return project;
  source.discarded_at = source.discarded_at ?? new Date().toISOString();
  const reasoningProject = projectForReasoning(updated);
  updated.clarity_score = calculateClarityScore(reasoningProject);
  updated.active_question = selectTopGap(reasoningProject, profile);
  updated.updated_at = new Date().toISOString();
  return updated;
}

export function restoreContextSource(project: Project, sourceId: string, profile: UserMemoryProfile): Project {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const source = updated.sources.find((candidate) => candidate.id === sourceId);
  if (!source) return project;
  delete source.discarded_at;
  const reasoningProject = projectForReasoning(updated);
  updated.clarity_score = calculateClarityScore(reasoningProject);
  updated.active_question = selectTopGap(reasoningProject, profile);
  updated.updated_at = new Date().toISOString();
  return updated;
}

// Compatibility for older callers: removal now means reversible discard.
export function removeContextSource(project: Project, sourceId: string, profile: UserMemoryProfile): Project {
  return discardContextSource(project, sourceId, profile);
}
