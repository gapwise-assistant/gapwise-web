import { Type } from '@google/genai';
import { z } from 'zod';
import { ClarityNode, ContextProcessingLog, ContextProcessingLogStage, ContextSource, EdgeType, Project, QuestionReconciliationSummary, UserMemoryProfile } from '@/types/clarity';
import { nodeTypeSchema, validateStructuredOutput } from '@/lib/agents/schemas';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed, isDemoMode } from '@/lib/runtime/demoMode';
import {
  hashText,
  extractDeterministicActionNodes,
  extractDeterministicDecisionNode,
  extractDeterministicFallbackNodes,
  extractDeterministicEvidenceNodes,
  extractDeterministicFailureOutcomeQuestionNodes,
  extractInferredStatusQuestionNodes,
  extractLiteralQuestionNodes,
  ingestContextSource,
  IngestSourceInput,
  PrecomputedRelationship,
  PrecomputedSourceNode,
} from '@/lib/context/ingestion';
import { projectForReasoning } from '@/lib/context/sourceState';
import {
  canonicalOpenQuestions,
  canonicalQuestionGroups,
  questionIdentityKey,
  reconcileQuestionCandidates,
  semanticallyEquivalentQuestion,
  questionsShareSubject,
} from '@/lib/questions/canonical';
import { normalizeQuestionGrammar, resolveQuestionReferences } from '@/lib/questions/presentation';

const reconciliationClassificationSchema = z.enum([
  'NEW_UNCERTAINTY',
  'PARAPHRASE',
  'SUBQUESTION',
  'SUPPORTING_EVIDENCE',
  'NEXT_ACTION',
  'ALREADY_ANSWERED',
  'ASSUMPTION',
  'RELATED_BUT_DISTINCT',
]);

const reconciliationResultSchema = z.object({
  candidate_index: z.number().int().min(0).max(11),
  classification: reconciliationClassificationSchema,
  canonical_question_id: z.string().optional(),
  canonical_candidate_index: z.number().int().min(0).max(11).optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(280),
});

const normalizedNodeTypeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.toUpperCase() : value),
  nodeTypeSchema
);

const relationshipSchema = z.enum([
  'supports',
  'contradicts',
  'depends_on',
  'blocks',
  'informs',
  'resolves',
  'derived_from',
  'supersedes',
  'affects',
] satisfies [EdgeType, ...EdgeType[]]);

const relationshipOutputSchema = z.object({
  source_node_index: z.number().int().min(0).max(11),
  target_node_id: z.string().min(1),
  type: relationshipSchema,
  confidence: z.number().min(0).max(1).default(0.8),
});

export const contextAnalysisSchema = z.object({
  summary: z.string().min(1),
  relevance: z.enum(['relevant', 'possibly_not_relevant']).default('relevant'),
  nodes: z.array(z.object({
    type: normalizedNodeTypeSchema,
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1).default(0.7),
    status: z.enum(['OPEN', 'RESOLVED']).optional(),
    why_it_matters: z.array(z.string()).default([]),
    question_aliases: z.array(z.string()).default([]),
    related_node_ids: z.array(z.string()).default([]),
    relationship: relationshipSchema.nullable().default(null),
  })).max(12).default([]),
  relationships: z.array(relationshipOutputSchema).max(24).default([]),
  reconciliation: z.array(reconciliationResultSchema).max(12).default([]),
});

export type ContextAnalysis = z.infer<typeof contextAnalysisSchema>;

export interface AnalyzeContextInput {
  sourceId: string;
  filename: string;
  content: string;
  type: ContextSource['type'];
  storageUrl?: string;
  mimeType?: string;
  model?: string;
  genAI?: ReturnType<typeof getVertexGenAIClient>;
}

export interface ProcessContextSourceResult {
  project: Project;
  skipped: boolean;
  analysis?: ContextAnalysis;
  modelUsed?: string;
  error?: string;
}

interface ContextModelTrace {
  prompt: string;
  model: string;
  request: {
    temperature: number;
    response_mime_type: string;
    response_schema: string;
  };
  raw_response: string;
  parsed_response: unknown;
}

function parseModelJson(text: string | undefined): unknown {
  if (!text) throw new StorageError('Gemini returned an empty context analysis response.', 'UNAVAILABLE');
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new StorageError('Gemini returned invalid structured context analysis.', 'UNAVAILABLE');
  }
}

function compactNode(node: ClarityNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    text: node.text,
    status: node.status,
    confidence: node.confidence,
    impact: node.impact,
    why_it_matters: node.why_it_matters?.slice(0, 2) ?? [],
  };
}

function projectSnapshot(project: Project): string {
  const importantTypes = new Set<ClarityNode['type']>([
    'GOAL',
    'UNKNOWN',
    'ASSUMPTION',
    'DECISION',
    'CONSTRAINT',
    'RISK',
    'NEXT_ACTION',
  ]);
  const importantGraphNodes = project.nodes
    .filter((node) => importantTypes.has(node.type))
    .sort((a, b) => (b.impact * b.confidence) - (a.impact * a.confidence))
    .slice(0, 12);
  const importantNodes = importantGraphNodes.map(compactNode);
  const importantNodeIds = new Set(importantGraphNodes.map((node) => node.id));
  const edges = project.edges
    .filter((edge) => importantNodeIds.has(edge.source) || importantNodeIds.has(edge.target))
    .slice(0, 20)
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      confidence: edge.confidence ?? null,
    }));
  const unresolvedGaps = project.nodes
    .filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN')
    .slice(0, 8)
    .map(compactNode);
  const canonicalQuestions = canonicalOpenQuestions(project)
    .slice(0, 12)
    .map((node) => ({ id: node.id, text: node.text, status: node.status, type: node.type }));

  return JSON.stringify({
    project_id: project.id,
    project_goal: project.goal,
    deadline: project.deadline ?? null,
    important_nodes: importantNodes,
    unresolved_gaps: unresolvedGaps,
    canonical_questions: canonicalQuestions,
    important_edges: edges,
  });
}

function analysisPrompt(input: AnalyzeContextInput, project: Project): string {
  return [
    'Analyze one newly supplied Gapwise context item against the current project state.',
    `Project goal: ${project.goal}`,
    `New source filename: ${input.filename}`,
    `New context text or user-provided description: ${input.content.trim() || '(The source is provided as a file; inspect it.)'}`,
    `Current compact project state: ${projectSnapshot(project)}`,
    'Return only structured JSON. Extract explicit facts, goals, constraints, decisions, preferences, evidence, risks, experiments, and next actions when materially useful.',
    'For DECISION nodes, return status OPEN only when the source explicitly describes a pending, unresolved, conditional, or not-yet-chosen decision. Return RESOLVED only when a choice is already recorded. Never infer an open decision from a generic task or plan.',
    'Create an UNKNOWN node for every explicit unresolved question in the source, including bullets under headings such as "unresolved", "pending", "open questions", or "blocking inputs". Do not drop an explicit question just because nearby facts are more detailed. A negative statement about a user-controlled action (for example, "I have not tested it" or "I have not replaced the data") already has a known answer: classify it as EVIDENCE or KNOWN and, when materially useful, add a NEXT_ACTION. Do not create an UNKNOWN that merely asks whether the user performed that already-known action. If the result of that action is unknown and material, ask about the result or resolution instead. A missing external confirmation can remain an evidence-seeking UNKNOWN. Only add a small number of additional inferred questions when answering them could materially improve a decision or advance the project goal.',
    'Before returning the batch, check every UNKNOWN for a complete grammatical subject and object grounded in the source. Do not combine two unfinished actions into one question, use vague placeholders such as "one" when the source names the object, or turn an unfinished user action into a question. An unfinished action belongs as evidence plus a NEXT_ACTION; create a question only when a missing result, external confirmation, or user decision remains.',
    'Phrase factual, status, and requirement UNKNOWNs as evidence-seeking questions: ask what is confirmed, approved, required, current, or recorded by the source or authority named in the context. Do not turn an authority-dependent uncertainty into advice-seeking wording such as "Do I need to change X?" when the missing input is the authority\'s confirmation. Preserve genuine preference and choice questions when the user is the decision-maker. Keep wording concise, first-person-compatible, and grounded; never invent an answer, owner, deadline, or decision.',
    'Treat explicit pending prose (for example, "a prerequisite is still being reviewed", "approval is pending", or "the final schedule has not been confirmed") as unresolved UNKNOWNs when it is relevant to the project goal or deadline, even without a question mark. Retain the original sentence as evidence.',
    'When the source says a capability has no fallback, backup, contingency, failover, or recovery path under a stated condition, create an UNKNOWN question asking what is available under that condition. Retain the risk or limitation as evidence; do not invent a solution.',
    'Do not generate generic checklists, trivia, or every possible missing detail. Merge semantically repeated questions with existing graph questions and preserve every source reference. Do not duplicate an existing node with the same meaning. Preserve useful new evidence even when it challenges an existing assumption; do not rewrite or delete existing nodes.',
    'For every returned UNKNOWN or ASSUMPTION node, classify its relationship to the canonical_questions in the current project and to other question-like nodes returned in this same response. Use PARAPHRASE for the same underlying uncertainty, SUBQUESTION for a narrower option-specific check, ASSUMPTION for an unverified belief, SUPPORTING_EVIDENCE for a claim that helps answer an existing question, NEXT_ACTION for required work that is not itself an unknown, ALREADY_ANSWERED when the supplied source already answers the candidate, NEW_UNCERTAINTY for a new uncertainty, and RELATED_BUT_DISTINCT only when the answer and downstream action are independently different. Set canonical_question_id only to an id from canonical_questions. When the same response contains a paraphrase or subquestion of another newly returned question, set canonical_candidate_index to the earlier zero-based node index instead. Do not point forward to a later candidate. Do not merge questions merely because they share nouns; compare the answer needed, the action/evidence that would resolve it, and the downstream change. Return one reconciliation object per returned question-like node.',
    'Classify whether this source appears relevant to the current project as relevant or possibly_not_relevant. This flag is advisory only. Never discard, delete, or suppress the source because of this classification.',
    'When a new node clearly relates to an existing node, include a relationship object. Its source_node_index is the zero-based index of a returned node, and target_node_id is an existing node id from the compact project state or new:<index> for another returned node.',
    'Allowed relationship types are supports, contradicts, supersedes, resolves, depends_on, blocks, affects, informs, and derived_from. Use supports for evidence that strengthens an existing understanding; contradicts when it challenges an assumption or known; supersedes when newer information replaces an old understanding; resolves when it answers an UNKNOWN; blocks when an unresolved question prevents a decision or next action; depends_on when one decision/action requires another; and affects when information materially changes a goal or decision. Only emit high-confidence, useful relationships; do not densify the graph speculatively.',
    'Preserve history: relationships may make an older assumption or known questionable, stale, or resolved, but never delete it.',
    'Every returned node must be concise, grounded in this source or its direct project implication, and useful for the project goal. Return at most 12 nodes. Return reconciliation as structured objects with candidate_index, classification, optional canonical_question_id, confidence, and a concise reason. Never include private reasoning.',
  ].join('\n');
}

export async function analyzeContextItem(
  input: AnalyzeContextInput,
  project: Project
): Promise<{ analysis: ContextAnalysis; modelUsed: string; trace: ContextModelTrace }> {
  assertExternalServicesAllowed('Vertex AI / Gemini context analysis');
  const model = input.model ?? getAgentModelConfig('context').model;
  const genAI = input.genAI ?? getVertexGenAIClient();
  const reasoningProject = projectForReasoning(project);
  const prompt = analysisPrompt(input, reasoningProject);
  const parts: Array<Record<string, unknown>> = [];
  if (input.storageUrl?.startsWith('gs://')) {
    parts.push({
      fileData: {
        fileUri: input.storageUrl,
        mimeType: input.mimeType || 'application/pdf',
      },
    });
  }
  parts.push({ text: prompt });

  const response = await genAI.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: ['summary', 'relevance', 'nodes', 'relationships', 'reconciliation'],
        properties: {
          summary: { type: Type.STRING },
          relevance: { type: Type.STRING, enum: ['relevant', 'possibly_not_relevant'] },
          nodes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['type', 'text', 'confidence', 'impact'],
              properties: {
                type: { type: Type.STRING, enum: nodeTypeSchema.options },
                text: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                impact: { type: Type.NUMBER },
                status: { type: Type.STRING, enum: ['OPEN', 'RESOLVED'] },
                why_it_matters: { type: Type.ARRAY, items: { type: Type.STRING } },
                related_node_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
                relationship: { type: Type.STRING, enum: relationshipSchema.options },
              },
            },
          },
          relationships: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['source_node_index', 'target_node_id', 'type', 'confidence'],
              properties: {
                source_node_index: { type: Type.NUMBER },
                target_node_id: { type: Type.STRING },
                type: { type: Type.STRING, enum: relationshipSchema.options },
                confidence: { type: Type.NUMBER },
              },
            },
          },
          reconciliation: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['candidate_index', 'classification', 'confidence', 'reason'],
              properties: {
                candidate_index: { type: Type.NUMBER },
                classification: { type: Type.STRING, enum: reconciliationClassificationSchema.options },
                canonical_question_id: { type: Type.STRING },
                canonical_candidate_index: { type: Type.NUMBER },
                confidence: { type: Type.NUMBER },
                reason: { type: Type.STRING },
              },
            },
          },
        },
      },
    },
  });

  const rawResponse = response.text ?? '';
  let parsedResponse: unknown;
  try {
    parsedResponse = parseModelJson(rawResponse);
  } catch (error) {
    if (error instanceof Error) {
      (error as Error & { contextTrace?: ContextModelTrace }).contextTrace = {
        prompt,
        model: response.modelVersion || model,
        request: {
          temperature: 0,
          response_mime_type: 'application/json',
          response_schema: 'contextAnalysisSchema',
        },
        raw_response: rawResponse,
        parsed_response: null,
      };
    }
    throw error;
  }
  let analysis: ContextAnalysis;
  try {
    analysis = validateStructuredOutput(contextAnalysisSchema, parsedResponse);
  } catch (error) {
    if (error instanceof Error) {
      (error as Error & { contextTrace?: ContextModelTrace }).contextTrace = {
        prompt,
        model: response.modelVersion || model,
        request: {
          temperature: 0,
          response_mime_type: 'application/json',
          response_schema: 'contextAnalysisSchema',
        },
        raw_response: rawResponse,
        parsed_response: parsedResponse,
      };
    }
    throw error;
  }
  return {
    analysis,
    modelUsed: response.modelVersion || model,
    trace: {
      prompt,
      model: response.modelVersion || model,
      request: {
        temperature: 0,
        response_mime_type: 'application/json',
        response_schema: 'contextAnalysisSchema',
      },
      raw_response: rawResponse,
      parsed_response: parsedResponse,
    },
  };
}

function successfulSource(source: ContextSource, hash: string): boolean {
  return source.hash === hash && source.extraction_hash === hash && source.processing_status === 'completed';
}

function analysisNodesToPrecomputedNodes(analysis: ContextAnalysis, project: Project): PrecomputedSourceNode[] {
  const validQuestionIds = new Set(canonicalQuestionGroups(project).map((group) => group.canonical.id));
  const questionIndexes = analysis.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === 'UNKNOWN' || node.type === 'ASSUMPTION');
  const deterministicBatch = reconcileQuestionCandidates(
    questionIndexes.map(({ node }) => ({ type: node.type, text: node.text })),
    project,
  );
  const deterministicByIndex = new Map(questionIndexes.map(({ index }, questionIndex) => [index, deterministicBatch[questionIndex]]));
  return analysis.nodes.map((node, index) => {
    const modelReconciliationRaw = analysis.reconciliation.find((candidate) => candidate.candidate_index === index);
    const modelReconciliation = modelReconciliationRaw
      ? {
        classification: modelReconciliationRaw.classification,
        canonicalQuestionId: modelReconciliationRaw.canonical_question_id,
        canonicalCandidateIndex: modelReconciliationRaw.canonical_candidate_index,
        confidence: modelReconciliationRaw.confidence,
        reason: modelReconciliationRaw.reason,
      }
      : undefined;
    const deterministic = deterministicByIndex.get(index);
    const modelCandidateTarget = modelReconciliation?.canonicalCandidateIndex;
    const validModelCandidateTarget = modelCandidateTarget !== undefined
      && modelCandidateTarget < index
      && modelCandidateTarget >= 0
      && (analysis.nodes[modelCandidateTarget]?.type === 'UNKNOWN' || analysis.nodes[modelCandidateTarget]?.type === 'ASSUMPTION')
      ? modelCandidateTarget
      : undefined;
    const validModelExistingTarget = modelReconciliation?.canonicalQuestionId
      && validQuestionIds.has(modelReconciliation.canonicalQuestionId)
      ? modelReconciliation.canonicalQuestionId
      : undefined;
    const modelNeedsTarget = modelReconciliation?.classification === 'PARAPHRASE'
      || modelReconciliation?.classification === 'SUBQUESTION'
      || modelReconciliation?.classification === 'ASSUMPTION';
    const modelHasValidTarget = Boolean(validModelExistingTarget || validModelCandidateTarget !== undefined);
    const useModelReconciliation = Boolean(modelReconciliation)
      && (!modelNeedsTarget || modelHasValidTarget)
      // A valid model classification is authoritative even when deterministic
      // wording happens to resemble an existing question. In particular,
      // NEW_UNCERTAINTY and RELATED_BUT_DISTINCT are explicit boundaries.
    const reconciliation = useModelReconciliation ? modelReconciliation : deterministic;
    const canonicalQuestionId = reconciliation === modelReconciliation
      ? validModelExistingTarget
      : reconciliation?.canonicalQuestionId;
    const canonicalCandidateIndex = reconciliation === modelReconciliation
      ? validModelCandidateTarget
      : reconciliation?.canonicalCandidateIndex;
    const effectiveType = reconciliation && ['SUPPORTING_EVIDENCE', 'ALREADY_ANSWERED'].includes(reconciliation.classification)
      && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
      ? 'EVIDENCE'
      : reconciliation?.classification === 'NEXT_ACTION'
        && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
        ? 'NEXT_ACTION'
      : node.type;
    return {
      type: effectiveType,
      text: node.text,
      confidence: node.confidence,
      impact: node.impact,
      status: node.status,
      whyItMatters: node.why_it_matters,
      questionAliases: node.question_aliases,
      relatedNodeIds: node.related_node_ids,
      relationship: node.relationship ?? undefined,
      questionClassification: reconciliation?.classification,
      canonicalQuestionId,
      canonicalCandidateIndex,
      reconciliationConfidence: reconciliation?.confidence,
      reconciliationReason: reconciliation?.reason,
    };
  });
}

function reconciliationSummary(analysis: ContextAnalysis, project: Project): QuestionReconciliationSummary {
  const questionIndexes = analysis.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
    .map(({ index }) => index);
  const resolved = analysisNodesToPrecomputedNodes(analysis, project);
  const results = questionIndexes.map((index) => resolved[index]?.questionClassification);
  return {
    candidate_count: results.length,
    canonical_merge_count: results.filter((item) => item === 'PARAPHRASE').length,
    subquestion_count: results.filter((item) => item === 'SUBQUESTION').length,
    assumption_count: results.filter((item) => item === 'ASSUMPTION').length,
    new_question_count: results.filter((item) => item === 'NEW_UNCERTAINTY' || item === 'RELATED_BUT_DISTINCT' || !item).length,
    fallback_count: results.filter((item) => !item).length,
    validation_status: results.every(Boolean) ? 'passed' : 'fallback',
  };
}

function sourceUsesFirstPerson(content: string): boolean {
  return /\b(?:i|me|my|mine|we|us|our|ours)\b/i.test(content);
}

/** Keep generated personal questions addressed to the person who supplied the source. */
function normalizePersonalQuestion(text: string, sourceContent: string): string {
  const groundedText = resolveQuestionReferences(text, sourceContent);
  if (!sourceUsesFirstPerson(sourceContent)) return normalizeQuestionGrammar(groundedText);
  const normalized = normalizeQuestionGrammar(groundedText
    .replace(/\bdoes the user\b/gi, 'do I')
    .replace(/\bhas the user\b/gi, 'have I')
    .replace(/\bis the user\b/gi, 'am I')
    .replace(/\b(can|could|should|will|would) the user\b/gi, '$1 I')
    .replace(/\bthe user(?:'s|’s)\b/gi, 'my')
    .replace(/\bthe user is\b/gi, 'I am')
    .replace(/\bthe user has\b/gi, 'I have')
    .replace(/\bthe user does\b/gi, 'I do')
    .replace(/\bthe user\b/gi, 'I')
    .replace(/\bfor I\b/gi, 'for me')
    .replace(/\bto I\b/gi, 'to me')
    .replace(/\bwith I\b/gi, 'with me')
    .replace(/\bof I\b/gi, 'of me')
    .replace(/\s+/g, ' ')
    .trim());
  return normalized.replace(/^([a-z])/, (character) => character.toUpperCase());
}

function questionCandidateMatches(left: string, right: string): boolean {
  const leftKey = questionIdentityKey(left);
  const rightKey = questionIdentityKey(right);
  return left.trim().toLowerCase() === right.trim().toLowerCase()
    || (leftKey.length > 0 && leftKey === rightKey);
}

function normalizedSemanticText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nodeIsQuestionLike(node: ContextAnalysis['nodes'][number]): boolean {
  return node.type === 'UNKNOWN' || node.type === 'ASSUMPTION';
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function semanticNodeFamily(type: ClarityNode['type']): string {
  if (type === 'UNKNOWN' || type === 'ASSUMPTION') return 'QUESTION';
  if (type === 'KNOWN' || type === 'EVIDENCE') return 'FACT';
  return type;
}

/** Compare concepts without treating every shared noun as a duplicate. */
function semanticallyEquivalentNode(
  left: ContextAnalysis['nodes'][number],
  right: ContextAnalysis['nodes'][number],
): boolean {
  if (semanticNodeFamily(left.type) !== semanticNodeFamily(right.type)) return false;
  if (normalizedSemanticText(left.text) === normalizedSemanticText(right.text)) return true;

  if (nodeIsQuestionLike(left) && nodeIsQuestionLike(right)) {
    return questionCandidateMatches(left.text, right.text)
      || semanticallyEquivalentQuestion(left.text, right.text);
  }

  const leftKey = questionIdentityKey(left.text);
  const rightKey = questionIdentityKey(right.text);
  if (leftKey && rightKey && leftKey === rightKey) return true;

  const similarity = tokenSimilarity(left.text, right.text);
  switch (left.type) {
    case 'DECISION': return similarity >= 0.62;
    case 'NEXT_ACTION': return similarity >= 0.7;
    case 'RISK':
    case 'CONSTRAINT':
    case 'PREFERENCE': return similarity >= 0.72;
    case 'KNOWN':
    case 'EVIDENCE': return similarity >= 0.78;
    default: return similarity >= 0.8;
  }
}

function questionSpecificityScore(text: string): number {
  const normalized = normalizedSemanticText(text);
  const tokens = meaningfulTokens(text);
  let score = tokens.size;
  if (tokens.size >= 4) score += 2;
  if (tokens.size >= 6) score += 1;
  if (/\bconfirmed yet\b/i.test(text)) score -= 5;
  if (/\bcurrent status\b/i.test(text)) score -= 2;
  if (/\bstatus is recorded\b/i.test(text)) score -= 2;
  if (/\b(?:it|that|this|one)\b/i.test(normalized)) score -= 1;
  return score;
}

function usefulAlias(text: string): boolean {
  if (!text.trim()) return false;
  if (/^has .+ confirmed yet\?$/i.test(text.trim())) return false;
  if (/^what is the current status\??$/i.test(text.trim())) return false;
  return true;
}

function nodeBudgetPriority(node: ContextAnalysis['nodes'][number]): number {
  const typePriority: Partial<Record<ClarityNode['type'], number>> = {
    GOAL: 100,
    DECISION: 95,
    UNKNOWN: 92,
    ASSUMPTION: 88,
    RISK: 86,
    CONSTRAINT: 84,
    PREFERENCE: 82,
    NEXT_ACTION: 80,
    KNOWN: 65,
    EVIDENCE: 55,
  };
  return (typePriority[node.type] ?? 50) + (node.impact * 10) + (node.confidence * 5);
}

function remapAnalysisIndexes(
  analysis: ContextAnalysis,
  nodes: ContextAnalysis['nodes'],
  indexMap: Map<number, number>,
): ContextAnalysis {
  const relationships = analysis.relationships.flatMap((relationship) => {
    const sourceNodeIndex = indexMap.get(relationship.source_node_index);
    if (sourceNodeIndex === undefined) return [];
    let targetNodeId = relationship.target_node_id;
    if (targetNodeId.startsWith('new:')) {
      const targetIndex = indexMap.get(Number(targetNodeId.slice(4)));
      if (targetIndex === undefined) return [];
      targetNodeId = `new:${targetIndex}`;
    }
    return [{ ...relationship, source_node_index: sourceNodeIndex, target_node_id: targetNodeId }];
  });
  const reconciliation = analysis.reconciliation.flatMap((candidate) => {
    const candidateIndex = indexMap.get(candidate.candidate_index);
    if (candidateIndex === undefined) return [];
    const canonicalCandidateIndex = candidate.canonical_candidate_index === undefined
      ? undefined
      : indexMap.get(candidate.canonical_candidate_index);
    return [{
      ...candidate,
      candidate_index: candidateIndex,
      canonical_candidate_index: canonicalCandidateIndex,
    }];
  });
  return { ...analysis, nodes, relationships, reconciliation };
}

function remapFinalizedAnalysis(
  analysis: ContextAnalysis,
  nodes: ContextAnalysis['nodes'],
  protectedIndices: Set<number>,
  fallbackIndices: Set<number>,
): ContextAnalysis {
  if (nodes.length <= 12) return { ...analysis, nodes };

  const selectedIndices = Array.from(new Set([
    // Exact user questions remain protected.
    ...Array.from(protectedIndices),
    ...nodes
      .map((node, index) => ({ node, index, fallback: fallbackIndices.has(index) }))
      .filter(({ index }) => !protectedIndices.has(index))
      .sort((left, right) => {
        const fallbackDifference = Number(left.fallback) - Number(right.fallback);
        if (fallbackDifference !== 0) return fallbackDifference;
        const priorityDifference = nodeBudgetPriority(right.node) - nodeBudgetPriority(left.node);
        if (priorityDifference !== 0) return priorityDifference;
        return (right.node.impact * right.node.confidence) - (left.node.impact * left.node.confidence);
      })
      .map(({ index }) => index),
  ])).slice(0, 12);
  const indexMap = new Map(selectedIndices.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const relationships = analysis.relationships.flatMap((relationship) => {
    const sourceNodeIndex = indexMap.get(relationship.source_node_index);
    if (sourceNodeIndex === undefined) return [];
    let targetNodeId = relationship.target_node_id;
    if (targetNodeId.startsWith('new:')) {
      const targetIndex = indexMap.get(Number(targetNodeId.slice(4)));
      if (targetIndex === undefined) return [];
      targetNodeId = `new:${targetIndex}`;
    }
    return [{ ...relationship, source_node_index: sourceNodeIndex, target_node_id: targetNodeId }];
  });
  const reconciliation = analysis.reconciliation.flatMap((candidate) => {
    const candidateIndex = indexMap.get(candidate.candidate_index);
    if (candidateIndex === undefined) return [];
    const canonicalCandidateIndex = candidate.canonical_candidate_index === undefined
      ? undefined
      : indexMap.get(candidate.canonical_candidate_index);
    return [{
      ...candidate,
      candidate_index: candidateIndex,
      canonical_candidate_index: canonicalCandidateIndex,
    }];
  });
  return {
    ...analysis,
    nodes: selectedIndices.map((index) => nodes[index]),
    relationships,
    reconciliation,
  };
}

/**
 * Finalizes all candidates once before ingestion. Literal questions and
 * valid model questions are retained, while deterministic extraction only
 * contributes explicit external-status questions plus evidence/actions for
 * user-controlled unfinished work.
 */
function finalizeQuestionCandidates(
  analysis: ContextAnalysis,
  input: AnalyzeContextInput,
  trace?: Record<string, unknown>,
): ContextAnalysis {
  type CandidateOrigin = 'model' | 'literal' | 'deterministic' | 'fallback';
  type Candidate = {
    node: ContextAnalysis['nodes'][number];
    originalIndices: number[];
    literal: boolean;
    fallback: boolean;
    origin: CandidateOrigin;
  };

  const inferredQuestions = extractInferredStatusQuestionNodes(input.content);
  const deterministicEvidence = extractDeterministicEvidenceNodes(input.content);
  const deterministicActions = extractDeterministicActionNodes(input.content);
  const deterministicDecision = extractDeterministicDecisionNode(input.content);
  const literalQuestions = extractLiteralQuestionNodes(input.content);
  const explicitQuestions = [
    ...literalQuestions,
    ...analysis.nodes.filter((node) => (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && /\?\s*$/.test(node.text)),
  ];
  if (trace) {
    trace.model_candidates = analysis.nodes;
    trace.literal_questions = explicitQuestions;
    trace.inferred_status_questions = inferredQuestions;
    trace.deterministic_actions = deterministicActions;
    trace.deterministic_evidence = deterministicEvidence;
    trace.deterministic_decision = deterministicDecision;
  }
  const directActionQuestion = (text: string) => /^(?:have|has|had|do|does|did|am|is|are|can|will|should)\s+(?:i|we)\b/i.test(text.trim());
  const normalizedText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const exactTextMatch = (left: string, right: string) => {
    const leftKey = questionIdentityKey(left);
    const rightKey = questionIdentityKey(right);
    return normalizedText(left) === normalizedText(right)
      || (leftKey.length > 0 && leftKey === rightKey);
  };
  const failureSignal = /\b(?:fail(?:ed|ing|ure)?|error|invalid|mismatch(?:ed)?|inconsistent|blocked|broken|unavailable|unauthorized|denied|unable|cannot|can['’]?t|not working)\b/i;
  const unresolvedOutcomeStatement = (text: string) =>
    !/\?\s*$/.test(text)
    && failureSignal.test(text)
    && /\b(?:not|n't|unverified|missing|untested|unconfirmed|unresolved|pending|under review|not recorded|not confirmed)\b/i.test(text);
  const actionConnectionTokens = (text: string) => new Set(
    questionIdentityKey(text)
      .split(' ')
      .filter(Boolean)
      .map((token) => token.endsWith('ing') && token.length > 6
        ? token.slice(0, -3)
        : token.endsWith('ed') && token.length > 5
          ? token.slice(0, -2)
          : token)
  );
  const modelLinkedActions = deterministicActions.filter((action) => {
    const actionTokens = actionConnectionTokens(action.text);
    if (actionTokens.size < 2) return false;
    return analysis.nodes
      .filter((node) => (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && unresolvedOutcomeStatement(node.text))
      .some((node) => {
        const statementTokens = actionConnectionTokens(node.text);
        const shared = [...actionTokens].filter((token) => statementTokens.has(token)).length;
        // Two shared, inflected-normalized subject/action tokens are enough
        // to recognize an explicit model link, while unrelated actions with
        // no shared subject remain unpaired.
        return shared >= 2 && shared / actionTokens.size >= 0.4;
      });
  });
  // If more than one action could explain the model's statement, leave the
  // fallback out rather than making the source order decide causality.
  const modelLinkedActionText = modelLinkedActions.length === 1
    ? modelLinkedActions[0]?.text
    : undefined;
  const deterministicOutcomes = extractDeterministicFailureOutcomeQuestionNodes(input.content, modelLinkedActionText)
    .filter((outcome) => !explicitQuestions.some((question) =>
      exactTextMatch(outcome.text, question.text) || semanticallyEquivalentQuestion(outcome.text, question.text)
    ));
  if (trace) {
    trace.model_linked_actions = modelLinkedActions;
    trace.deterministic_outcome_questions = deterministicOutcomes;
  }
  const fallbackSubject = (text: string): string | undefined =>
    text.match(/^what current status is recorded for (.+)\?$/i)?.[1]?.trim()
    ?? text.match(/^what (.+) is currently confirmed\?$/i)?.[1]?.trim();
  const fallbackMatchesQuestion = (fallback: string, candidate: string): boolean => {
    const subject = fallbackSubject(fallback);
    if (!subject) return exactTextMatch(fallback, candidate);
    const subjectKey = questionIdentityKey(subject);
    const candidateKey = questionIdentityKey(candidate);
    if (!subjectKey || subjectKey.split(' ').length < 2) return false;
    const subjectTokens = subjectKey.split(' ');
    return subjectTokens.every((token) => candidateKey.split(' ').includes(token))
      && /\b(?:status|record(?:ed)?|confirm(?:ed|ation)?|approv(?:ed|al)?|review(?:ed|ing)?|outcome|pending|unresolved|unconfirm(?:ed)?|verified?)\b/i.test(candidate);
  };
  const actionForModel = () => deterministicActions.length === 1 ? deterministicActions[0] : undefined;

  const normalizeModelNode = (node: ContextAnalysis['nodes'][number]): ContextAnalysis['nodes'][number] => {
    if (node.type !== 'UNKNOWN' && node.type !== 'ASSUMPTION') return node;
    const normalized = normalizePersonalQuestion(node.text, input.content);
    const normalizedAliases = node.question_aliases?.map((alias) => normalizePersonalQuestion(alias, input.content));
    const inferredQuestion = inferredQuestions.find((question) => fallbackMatchesQuestion(question.text, normalized));
    const action = actionForModel();
    const malformedActionQuestion = /\b[a-z][a-z-]*ed\s+(?:the|a|an)\s+to\b/i.test(normalized);
    const describesUnfinishedWork = /\b(?:not|n't|mismatch|inconsistent|failing|failure|error|invalid|unverified|missing|untested|unconfirmed|unresolved|pending|under review|not recorded|not confirmed)\b/i.test(normalized);
    const evidence = deterministicEvidence.find((candidate) => exactTextMatch(normalized, candidate.text));

    // A direct question asking whether the user performed a known action is
    // itself a misclassified action. Keep the action, not a duplicate UNKNOWN.
    if (normalized.trim().endsWith('?') && directActionQuestion(normalized) && action) {
      return {
        ...node,
        type: 'NEXT_ACTION',
        text: action.text,
        question_aliases: normalizedAliases,
        status: 'OPEN',
      };
    }
    // A model can accidentally combine two unfinished actions into one
    // first-person question. There is no safe canonical answer target then:
    // keep source evidence and let the separate deterministic NEXT_ACTION
    // candidates represent the work.
    if (normalized.trim().endsWith('?') && directActionQuestion(normalized) && deterministicActions.length > 1) {
      return {
        ...node,
        type: 'EVIDENCE',
        text: deterministicEvidence[0]?.text ?? normalized,
        question_aliases: normalizedAliases,
        status: 'RESOLVED',
      };
    }
    if (normalized.trim().endsWith('?') && directActionQuestion(normalized) && malformedActionQuestion) {
      return {
        ...node,
        type: 'EVIDENCE',
        text: deterministicEvidence[0]?.text ?? normalized.replace(/[?]+$/, '.'),
        question_aliases: normalizedAliases,
        status: 'RESOLVED',
      };
    }
    // A non-question UNKNOWN is either a pending external status or supplied
    // evidence. Use the generic status question when one is available;
    // otherwise retain the supplied statement as evidence rather than asking
    // the user for a fact the source already gives us.
    if (!normalized.trim().endsWith('?')) {
      if (inferredQuestion) return { ...node, text: inferredQuestion.text, question_aliases: normalizedAliases, status: 'OPEN' };
      if (evidence || (action && describesUnfinishedWork) || describesUnfinishedWork) {
        return { ...node, type: 'EVIDENCE', text: evidence?.text ?? normalized, question_aliases: normalizedAliases, status: 'RESOLVED' };
      }
    }
    return { ...node, text: normalized, question_aliases: normalizedAliases };
  };

  const candidates: Candidate[] = analysis.nodes.map((node, index) => ({
    node: normalizeModelNode(node),
    originalIndices: [index],
    literal: false,
    fallback: false,
    origin: 'model',
  }));

  const fallbackEquivalentToQuestion = (
    fallback: ContextAnalysis['nodes'][number],
    existing: ContextAnalysis['nodes'][number],
  ): boolean => {
    if (!nodeIsQuestionLike(fallback) || !nodeIsQuestionLike(existing)) return false;
    if (semanticallyEquivalentNode(fallback, existing)) return true;
    const isGenericConfirmation = /\b(?:confirmed|confirmation|status|pending|approved|approval|reviewed)\b/i.test(fallback.text);
    return isGenericConfirmation && questionsShareSubject(fallback.text, existing.text);
  };

  const findEquivalentCandidate = (
    node: ContextAnalysis['nodes'][number],
    origin: CandidateOrigin,
  ): number => candidates.findIndex((candidate) =>
    semanticallyEquivalentNode(candidate.node, node)
      || (origin === 'fallback' && fallbackEquivalentToQuestion(node, candidate.node))
  );

  const addCandidate = (
    node: ContextAnalysis['nodes'][number],
    origin: CandidateOrigin,
    options: { literal?: boolean; fallback?: boolean } = {},
  ) => {
    const literal = options.literal ?? false;
    const fallback = options.fallback ?? false;
    const existingIndex = findEquivalentCandidate(node, origin);
    if (existingIndex < 0) {
      candidates.push({ node, originalIndices: [], literal, fallback, origin });
      return;
    }

    const existing = candidates[existingIndex];
    if (literal) {
      candidates[existingIndex] = {
        ...existing,
        literal: true,
        origin: 'literal',
        node: {
          ...existing.node,
          text: node.text,
          status: 'OPEN',
          confidence: Math.max(existing.node.confidence, node.confidence),
          impact: Math.max(existing.node.impact, node.impact),
          why_it_matters: Array.from(new Set([...existing.node.why_it_matters, ...node.why_it_matters])),
          question_aliases: Array.from(new Set([
            ...(existing.node.question_aliases ?? []),
            ...(node.question_aliases ?? []),
            existing.node.text,
          ])).filter((alias) => alias !== node.text && usefulAlias(alias)),
        },
      };
      return;
    }

    // Model output wins over deterministic recovery for the same concept.
    if (existing.origin === 'model' && (origin === 'deterministic' || origin === 'fallback')) {
      const alias = usefulAlias(node.text) && nodeIsQuestionLike(existing.node) ? node.text : undefined;
      if (alias) {
        candidates[existingIndex] = {
          ...existing,
          node: {
            ...existing.node,
            question_aliases: Array.from(new Set([...(existing.node.question_aliases ?? []), alias]))
              .filter((value) => value !== existing.node.text && usefulAlias(value)),
          },
        };
      }
      return;
    }

    const existingSpecificity = questionSpecificityScore(existing.node.text);
    const newSpecificity = questionSpecificityScore(node.text);
    const shouldReplace = !fallback && (existing.fallback || newSpecificity > existingSpecificity);
    if (!shouldReplace) return;
    candidates[existingIndex] = {
      ...existing,
      node: {
        ...node,
        confidence: Math.max(existing.node.confidence, node.confidence),
        impact: Math.max(existing.node.impact, node.impact),
        why_it_matters: Array.from(new Set([...existing.node.why_it_matters, ...node.why_it_matters])),
        question_aliases: Array.from(new Set([
          ...(existing.node.question_aliases ?? []),
          ...(node.question_aliases ?? []),
          existing.node.text,
        ])).filter((alias) => alias !== node.text && usefulAlias(alias)),
      },
      fallback,
      origin,
    };
  };

  literalQuestions.forEach((question) => addCandidate({
    type: question.type,
    text: question.text,
    confidence: question.confidence,
    impact: question.impact ?? 0.82,
    status: 'OPEN',
    why_it_matters: question.whyItMatters ?? [],
    question_aliases: [],
    related_node_ids: [],
    relationship: null,
  }, 'literal', { literal: true }));

  // Inferred status questions are fallback candidates. They are added to the
  // same candidate set so a model question can supply the canonical wording,
  // while a model omission still leaves a usable generic question behind.
  inferredQuestions.forEach((question) => addCandidate({
    type: question.type,
    text: question.text,
    confidence: question.confidence,
    impact: question.impact ?? question.confidence,
    status: question.status === 'OPEN' || question.status === 'RESOLVED' ? question.status : undefined,
    why_it_matters: question.whyItMatters ?? [],
    question_aliases: [],
    related_node_ids: [],
    relationship: null,
  }, 'fallback', { fallback: true }));

  // A material failure can justify one grounded outcome question. Ordinary
  // user-controlled actions remain evidence and work only.
  deterministicOutcomes.forEach((question) => addCandidate({
    type: question.type,
    text: question.text,
    confidence: question.confidence,
    impact: question.impact ?? question.confidence,
    status: question.status === 'OPEN' || question.status === 'RESOLVED' ? question.status : undefined,
    why_it_matters: ['The source records a failure whose resolution is not yet confirmed.'],
    question_aliases: [],
    related_node_ids: [],
    relationship: null,
  }, 'fallback', { fallback: true }));

  // These are known source facts and unfinished work, never additional open
  // questions. Model output remains authoritative when it already supplied
  // equivalent evidence or action nodes.
  [...(deterministicDecision ? [deterministicDecision] : []), ...deterministicActions, ...deterministicEvidence].forEach((node) => addCandidate({
    type: node.type,
    text: node.text,
    confidence: node.confidence,
    impact: node.impact ?? node.confidence,
    status: node.status === 'OPEN' || node.status === 'RESOLVED' ? node.status : undefined,
    why_it_matters: node.whyItMatters ?? [],
    question_aliases: [],
    related_node_ids: [],
    relationship: null,
  }, 'deterministic'));

  const merged: Candidate[] = [];
  const consumed = new Set<number>();
  const originPriority: Record<CandidateOrigin, number> = {
    literal: 4,
    model: 3,
    deterministic: 2,
    fallback: 1,
  };
  const orderedCandidates = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) =>
      Number(right.candidate.literal) - Number(left.candidate.literal)
      || originPriority[right.candidate.origin] - originPriority[left.candidate.origin]
    );

  orderedCandidates.forEach(({ candidate, index }) => {
    if (consumed.has(index)) return;
    const memberIndices = candidates
      .map((other, otherIndex) => ({ other, otherIndex }))
      .filter(({ other, otherIndex }) => {
        if (otherIndex === index || consumed.has(otherIndex)) return false;
        if (candidate.literal && other.literal) return false;
        return semanticallyEquivalentNode(candidate.node, other.node);
      })
      .map(({ otherIndex }) => otherIndex);
    const indices = [index, ...memberIndices];
    indices.forEach((memberIndex) => consumed.add(memberIndex));
    const members = indices.map((memberIndex) => candidates[memberIndex]);
    const selected = [...members].sort((left, right) =>
      Number(right.literal) - Number(left.literal)
      || originPriority[right.origin] - originPriority[left.origin]
      || questionSpecificityScore(right.node.text) - questionSpecificityScore(left.node.text)
      || right.node.confidence - left.node.confidence
      || right.node.impact - left.node.impact
    )[0];
    const aliases = Array.from(new Set([
      ...members.flatMap((member) => member.node.question_aliases ?? []),
      ...members.map((member) => member.node.text),
    ])).filter((text) => text && text !== selected.node.text && usefulAlias(text));
    merged.push({
      node: {
        ...selected.node,
        confidence: Math.max(...members.map((member) => member.node.confidence)),
        impact: Math.max(...members.map((member) => member.node.impact)),
        why_it_matters: Array.from(new Set(members.flatMap((member) => member.node.why_it_matters))),
        question_aliases: nodeIsQuestionLike(selected.node) ? aliases : selected.node.question_aliases,
      },
      originalIndices: [
        ...selected.originalIndices,
        ...members.flatMap((member) => member.originalIndices)
          .filter((originalIndex) => !selected.originalIndices.includes(originalIndex)),
      ],
      literal: members.some((member) => member.literal),
      fallback: selected.fallback,
      origin: selected.origin,
    });
  });

  const indexMap = new Map<number, number>();
  const canonicalOriginalIndices = new Set<number>();
  merged.forEach((candidate, newIndex) => {
    candidate.originalIndices.forEach((originalIndex, memberIndex) => {
      indexMap.set(originalIndex, newIndex);
      if (memberIndex === 0) canonicalOriginalIndices.add(originalIndex);
    });
  });
  const remapped = remapAnalysisIndexes(
    {
      ...analysis,
      reconciliation: analysis.reconciliation.filter((candidate) => canonicalOriginalIndices.has(candidate.candidate_index)),
    },
    merged.map((candidate) => candidate.node),
    indexMap,
  );
  const protectedIndices = new Set(merged.flatMap((candidate, index) => candidate.literal ? [index] : []));
  const fallbackIndices = new Set(merged.flatMap((candidate, index) => candidate.fallback ? [index] : []));
  const finalized = remapFinalizedAnalysis(remapped, remapped.nodes, protectedIndices, fallbackIndices);
  if (trace) {
    trace.merged_candidates = merged;
    trace.finalized_analysis = finalized;
  }
  return finalized;
}

function analysisRelationshipsToPrecomputedRelationships(analysis: ContextAnalysis): PrecomputedRelationship[] {
  return analysis.relationships.map((relationship) => ({
    sourceNodeIndex: relationship.source_node_index,
    targetNodeId: relationship.target_node_id,
    type: relationship.type,
    confidence: relationship.confidence,
  }));
}

function meaningfulTokens(value: string): Set<string> {
  const ignored = new Set(['what', 'where', 'when', 'which', 'who', 'how', 'why', 'does', 'could', 'would', 'should', 'are', 'the', 'and', 'for', 'from', 'with', 'this', 'that', 'about', 'into', 'your', 'you', 'can', 'will', 'have', 'need', 'know']);
  return new Set(
    value.toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length >= 4 && !ignored.has(token))
  );
}

function filterGoalRelevantUnknowns(analysis: ContextAnalysis, input: AnalyzeContextInput, project: Project): ContextAnalysis {
  const reasoningProject = projectForReasoning(project);
  const contextTokens = meaningfulTokens([
    input.filename,
    input.content,
    reasoningProject.title,
    reasoningProject.goal,
    ...reasoningProject.nodes.slice(0, 12).map((node) => `${node.text} ${node.why_it_matters?.join(' ') ?? ''}`),
  ].join(' '));
  const seen = new Set<string>();
  let unknownCount = 0;
  // The structured response already caps the total node count at 12. Keep
  // that full budget for explicit questions; completeness is more important
  // here than an arbitrary per-source question quota.
  const maxUnknowns = 12;
  const keptIndices: number[] = [];
  const nodes: ContextAnalysis['nodes'] = [];
  analysis.nodes.forEach((node, index) => {
    if (node.type !== 'UNKNOWN') {
      nodes.push(node);
      keptIndices.push(index);
      return;
    }
    if (unknownCount >= maxUnknowns) return;
    const key = node.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) return;
    seen.add(key);
    const questionTokens = meaningfulTokens(`${node.text} ${node.why_it_matters.join(' ')}`);
    const grounded = Array.from(questionTokens).some((token) => contextTokens.has(token));
    if (!grounded) return;
    unknownCount += 1;
    nodes.push(node);
    keptIndices.push(index);
  });
  const indexMap = new Map(keptIndices.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const relationships = analysis.relationships.flatMap((relationship) => {
    const sourceNodeIndex = indexMap.get(relationship.source_node_index);
    if (sourceNodeIndex === undefined) return [];
    let targetNodeId = relationship.target_node_id;
    if (targetNodeId.startsWith('new:')) {
      const oldTargetIndex = Number(targetNodeId.slice(4));
      const newTargetIndex = indexMap.get(oldTargetIndex);
      if (newTargetIndex === undefined) return [];
      targetNodeId = `new:${newTargetIndex}`;
    }
    return [{ ...relationship, source_node_index: sourceNodeIndex, target_node_id: targetNodeId }];
  });
  const reconciliation = analysis.reconciliation.flatMap((candidate) => {
    const candidateIndex = indexMap.get(candidate.candidate_index);
    if (candidateIndex === undefined) return [];
    const canonicalCandidateIndex = candidate.canonical_candidate_index === undefined
      ? undefined
      : indexMap.get(candidate.canonical_candidate_index);
    return [{ ...candidate, candidate_index: candidateIndex, canonical_candidate_index: canonicalCandidateIndex }];
  });
  return { ...analysis, nodes, relationships, reconciliation };
}

function appendProcessingStage(
  log: ContextProcessingLog | undefined,
  stage: Omit<ContextProcessingLogStage, 'started_at' | 'duration_ms'> & { started_at?: string; duration_ms?: number },
): void {
  if (!log) return;
  log.stages.push({
    ...stage,
    started_at: stage.started_at ?? new Date().toISOString(),
    duration_ms: stage.duration_ms ?? 0,
  });
}

function completeProcessingLog(
  log: ContextProcessingLog | undefined,
  status: ContextProcessingLog['status'],
  error?: string,
): void {
  if (!log) return;
  log.status = status;
  log.completed_at = new Date().toISOString();
  log.duration_ms = Math.max(0, Date.now() - Date.parse(log.started_at));
  if (error) log.error = error;
}

function createProcessingLog(project: Project, input: IngestSourceInput, hash: string): ContextProcessingLog {
  return {
    version: 1,
    status: 'completed',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: 0,
    input: {
      source_id: input.sourceId ?? 'new-source',
      filename: input.filename,
      type: input.type,
      mime_type: input.mimeType,
      content: input.content,
      storage_url: input.storageUrl,
      hash,
      project_snapshot: projectSnapshot(project),
    },
    stages: [],
  };
}

export async function processContextSource(
  project: Project,
  input: IngestSourceInput,
  profile: UserMemoryProfile,
  options: {
    forceReprocess?: boolean;
    model?: string;
    genAI?: ReturnType<typeof getVertexGenAIClient>;
    /** Enables complete prompt/response/candidate logging for localhost development only. */
    captureProcessingLog?: boolean;
  } = {}
): Promise<ProcessContextSourceResult> {
  const processStarted = Date.now();
  const hash = input.hash ?? await hashText(`${input.filename}:${input.content}:${input.storageUrl ?? ''}`);
  const processingLog = options.captureProcessingLog
    ? createProcessingLog(project, input, hash)
    : undefined;
  if (processingLog) processingLog.started_at = new Date(processStarted).toISOString();
  const existing = project.sources.find((source) => successfulSource(source, hash));
  if (existing && !options.forceReprocess) {
    return { project, skipped: true, modelUsed: existing.model_used };
  }

  if (isDemoMode()) {
    appendProcessingStage(processingLog, {
      name: 'Deterministic demo extraction',
      status: 'completed',
      input: {
        demo_mode: true,
        source_type: input.type,
      },
      output: {
        model_used: input.modelUsed ?? 'deterministic-demo',
        supplied_nodes: input.derivedNodes ?? 'fallbackNodesForSource(content)',
      },
      duration_ms: Date.now() - processStarted,
    });
    completeProcessingLog(processingLog, 'completed');
    const updated = await ingestContextSource(project, {
      ...input,
      hash,
      extractionHash: hash,
      processingStatus: input.processingStatus ?? 'completed',
      relevance: input.relevance ?? 'relevant',
      processingLog,
    }, profile);
    return { project: updated, skipped: false, modelUsed: input.modelUsed };
  }

  try {
    const modelStageStarted = Date.now();
    const analyzed = await analyzeContextItem({
      sourceId: input.sourceId ?? 'new-source',
      filename: input.filename,
      content: input.content,
      type: input.type,
      storageUrl: input.storageUrl,
      mimeType: input.mimeType,
      model: options.model,
      genAI: options.genAI,
    }, project);
    const { analysis: rawAnalysis, modelUsed } = analyzed;
    appendProcessingStage(processingLog, {
      name: 'Context Agent model analysis',
      status: 'completed',
      input: {
        model: analyzed.trace.model,
        request: analyzed.trace.request,
        prompt: analyzed.trace.prompt,
      },
      output: {
        raw_response: analyzed.trace.raw_response,
        parsed_response: analyzed.trace.parsed_response,
        validated_analysis: rawAnalysis,
      },
      started_at: new Date(modelStageStarted).toISOString(),
      duration_ms: Date.now() - modelStageStarted,
    });
    const analysisInput = {
      sourceId: input.sourceId ?? 'new-source',
      filename: input.filename,
      content: input.content,
      type: input.type,
      storageUrl: input.storageUrl,
      mimeType: input.mimeType,
      model: options.model,
      genAI: options.genAI,
    } satisfies AnalyzeContextInput;
    const finalizationTrace: Record<string, unknown> = {};
    const finalizedAnalysis = finalizeQuestionCandidates(rawAnalysis, analysisInput, finalizationTrace);
    appendProcessingStage(processingLog, {
      name: 'Candidate finalization and canonical question selection',
      status: 'completed',
      input: { raw_analysis: rawAnalysis },
      output: finalizationTrace,
    });
    const analysis = filterGoalRelevantUnknowns(finalizedAnalysis, analysisInput, project);
    appendProcessingStage(processingLog, {
      name: 'Goal relevance filtering',
      status: 'completed',
      input: { finalized_analysis: finalizedAnalysis },
      output: { filtered_analysis: analysis },
    });
    appendProcessingStage(processingLog, {
      name: 'Graph persistence',
      status: 'completed',
      input: {
        extraction_summary: analysis.summary,
        relevance: analysis.relevance,
        nodes: analysisNodesToPrecomputedNodes(analysis, project),
        relationships: analysisRelationshipsToPrecomputedRelationships(analysis),
      },
      output: {
        node_count: analysis.nodes.length,
        relationship_count: analysis.relationships.length,
      },
    });
    completeProcessingLog(processingLog, 'completed');
    const updated = await ingestContextSource(project, {
      ...input,
      hash,
      extractionHash: hash,
      processingStatus: 'completed',
      extractionSummary: analysis.summary,
      modelUsed,
      reconciliationSummary: reconciliationSummary(analysis, project),
      relevance: analysis.relevance,
      derivedNodes: analysisNodesToPrecomputedNodes(analysis, project),
      relationships: analysisRelationshipsToPrecomputedRelationships(analysis),
      processingLog,
    }, profile);
    if (processingLog) {
      const persistedSource = updated.sources.find((source) => source.id === input.sourceId);
      processingLog.stages.push({
        name: 'Graph persistence result',
        status: 'completed',
        started_at: new Date().toISOString(),
        duration_ms: 0,
        output: {
          source_id: persistedSource?.id,
          derived_node_ids: persistedSource?.derived_node_ids ?? [],
          project_node_count: updated.nodes.length,
          project_edge_count: updated.edges.length,
          reconciliation_summary: persistedSource?.reconciliation_summary,
        },
      });
      completeProcessingLog(processingLog, 'completed');
    }
    return { project: updated, skipped: false, analysis, modelUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini context analysis failed.';
    const contextTrace = error instanceof Error
      ? (error as Error & { contextTrace?: ContextModelTrace }).contextTrace
      : undefined;
    const failedAnalysisInput = {
      sourceId: input.sourceId ?? 'new-source',
      filename: input.filename,
      content: input.content,
      type: input.type,
      storageUrl: input.storageUrl,
      mimeType: input.mimeType,
      model: options.model,
      genAI: options.genAI,
    } satisfies AnalyzeContextInput;
    appendProcessingStage(processingLog, {
      name: 'Context Agent model analysis',
      status: 'failed',
      input: contextTrace ? {
        model: contextTrace.model,
        request: contextTrace.request,
        prompt: contextTrace.prompt,
      } : {
        model: options.model ?? getAgentModelConfig('context').model,
        request: {
          temperature: 0,
          response_mime_type: 'application/json',
          response_schema: 'contextAnalysisSchema',
        },
        prompt: analysisPrompt(failedAnalysisInput, projectForReasoning(project)),
      },
      output: contextTrace ? {
        raw_response: contextTrace.raw_response,
        parsed_response: contextTrace.parsed_response,
      } : undefined,
      error: message,
    });
    const fallbackNodes = extractDeterministicFallbackNodes(input.content);
    appendProcessingStage(processingLog, {
      name: 'Deterministic fallback extraction',
      status: 'completed',
      input: { content: input.content },
      output: { nodes: fallbackNodes },
    });
    completeProcessingLog(processingLog, 'failed', message);
    const failed = await ingestContextSource(project, {
      ...input,
      hash,
      processingStatus: 'failed',
      errorMessage: message,
      extractionHash: undefined,
      derivedNodes: fallbackNodes,
      processingLog,
    }, profile);
    return { project: failed, skipped: false, error: message };
  }
}
