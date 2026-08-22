import { ClarityNode, ContextSource, EdgeType, Project, QuestionReconciliationSummary, UserMemoryProfile } from '@/types/clarity';
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

/**
 * Converts an explicit negative or pending statement into a confirmation
 * question without guessing the domain, answer, owner, or next decision.
 * Passive status statements use the subject as the thing to verify; active
 * statements preserve the named source and action ("The responsible source
 * has not confirmed X" -> "Has the responsible source confirmed X?").
 */
function negativeStatementQuestion(line: string): string | undefined {
  const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!/(?:has|have|had)\s+not\b|\b(?:is|are|was|were)\s+(?:still\s+)?(?:being\s+)?(?:reviewed|considered|pending|uncertain|unresolved|missing|unknown|unconfirmed)\b|\b(?:pending|under review|unapproved|unconfirmed|unresolved|missing)\b/.test(normalized)) {
    return undefined;
  }

  const active = line.match(/^(.+?)\s+(has|have|had)\s+not\s+(?:yet\s+)?(approved|confirmed|accepted|agreed|provided|reviewed|verified|demonstrated|selected|recorded)\s+(.+?)[.!?]?$/i);
  if (active?.[1] && active[3] && active[4]) {
    const actor = (active[1].split(/,|\band\b/i).at(-1)?.trim() ?? active[1].trim())
      .replace(/^(The|A|An)\b/, (article) => article.toLowerCase());
    const object = active[4].replace(/[.!?]+$/, '').trim();
    return `Has ${actor} ${active[3].toLowerCase()} ${object}?`;
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
 * candidates only; successful model analysis does not call this extractor.
 */
export function extractInferredStatusQuestionNodes(content: string): PrecomputedSourceNode[] {
  const inferredQuestions: string[] = [];
  sentenceLines(content).forEach((line) => {
    const cleaned = cleanQuestionLine(line);
    if (cleaned.endsWith('?')) return;

    const inferred = negativeStatementQuestion(cleaned);
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
 * Compatibility entry point for demo and model-unavailable ingestion. It
 * combines literal and inferred candidates only when no model finalizer is
 * available to choose between them.
 */
export function extractDeterministicQuestionNodes(content: string): PrecomputedSourceNode[] {
  return questionNodesFromTexts([
    ...extractLiteralQuestionNodes(content).map((node) => node.text),
    ...extractInferredStatusQuestionNodes(content).map((node) => node.text),
  ]);
}

function extractDeterministicEvidenceNodes(content: string): PrecomputedSourceNode[] {
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

function extractDeterministicDecisionNode(content: string): PrecomputedSourceNode | undefined {
  const line = sentenceLines(content).find((candidate) =>
    /\b(?:pending|open|unresolved|not yet approved|still open)\b.{0,80}\b(?:decision|go\s*\/\s*no[- ]go|choice)\b/i.test(candidate)
    || /\b(?:decision|go\s*\/\s*no[- ]go)\b.{0,80}\b(?:pending|open|unresolved|still open|not made)\b/i.test(candidate)
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
  const evidenceNodes = extractDeterministicEvidenceNodes(content);
  const decisionNode = extractDeterministicDecisionNode(content);
  if (questionNodes.length || evidenceNodes.length || decisionNode) {
    return [ ...(decisionNode ? [decisionNode] : []), ...questionNodes, ...evidenceNodes ];
  }
  const type = inferNodeType(content);
  return [{
    type,
    text: `From supplied context: ${content.slice(0, 180)}${content.length > 180 ? '...' : ''}`,
    confidence: type === 'UNKNOWN' || type === 'CONSTRAINT' ? 0.86 : 0.68,
    impact: type === 'CONSTRAINT' || type === 'UNKNOWN' ? 0.78 : 0.62,
  }];
}

function inferFallbackResolutionTargets(project: Project, content: string): ClarityNode[] {
  const lower = content.toLowerCase();
  if (!/\b(?:test|trial|experiment|demonstrated|confirmed|approved|completed|produced|passed|verified|shows?|recorded)\b/i.test(lower)) return [];

  const contentTokens = new Set(questionIdentityKey(content).split(' ').filter(Boolean));
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
        if (node.questionClassification && existingNode.reconciliation_status === 'fallback') {
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
      const targetNode = updated.nodes.find((candidate) => candidate.id === targetNodeId);
      if (sourceNodeId === targetNodeId) {
        if (targetNode && relationship.type === 'resolves') {
          applyRelationshipState(targetNode, relationship.type, sourceId, input.filename, now);
        }
        return;
      }
      if (!updated.nodes.some((candidate) => candidate.id === targetNodeId)) return;
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
