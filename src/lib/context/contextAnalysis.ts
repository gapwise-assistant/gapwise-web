import { Type } from '@google/genai';
import { z } from 'zod';
import { ClarityNode, ContextSource, EdgeType, Project, QuestionReconciliationSummary, UserMemoryProfile } from '@/types/clarity';
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
  extractMissingContingencyQuestionNodes,
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
} from '@/lib/questions/canonical';

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
): Promise<{ analysis: ContextAnalysis; modelUsed: string }> {
  assertExternalServicesAllowed('Vertex AI / Gemini context analysis');
  const model = input.model ?? getAgentModelConfig('context').model;
  const genAI = input.genAI ?? getVertexGenAIClient();
  const reasoningProject = projectForReasoning(project);
  const parts: Array<Record<string, unknown>> = [];
  if (input.storageUrl?.startsWith('gs://')) {
    parts.push({
      fileData: {
        fileUri: input.storageUrl,
        mimeType: input.mimeType || 'application/pdf',
      },
    });
  }
  parts.push({ text: analysisPrompt(input, reasoningProject) });

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

  return {
    analysis: validateStructuredOutput(contextAnalysisSchema, parseModelJson(response.text)),
    modelUsed: response.modelVersion || model,
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
  if (!sourceUsesFirstPerson(sourceContent)) return text;
  return text
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
    .trim();
}

function questionCandidateMatches(left: string, right: string): boolean {
  const leftKey = questionIdentityKey(left);
  const rightKey = questionIdentityKey(right);
  return left.trim().toLowerCase() === right.trim().toLowerCase()
    || (leftKey.length > 0 && leftKey === rightKey);
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

  // Literal source questions are protected when the structured response is full.
  const selectedIndices = Array.from(new Set([
    ...Array.from(protectedIndices),
    ...nodes
      .map((node, index) => ({ node, index }))
      .filter(({ index }) => !protectedIndices.has(index))
      .sort((left, right) =>
        Number(fallbackIndices.has(left.index)) - Number(fallbackIndices.has(right.index))
        || (right.node.impact * right.node.confidence) - (left.node.impact * left.node.confidence))
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
function finalizeQuestionCandidates(analysis: ContextAnalysis, input: AnalyzeContextInput): ContextAnalysis {
  type Candidate = {
    node: ContextAnalysis['nodes'][number];
    originalIndices: number[];
    literal: boolean;
    fallback: boolean;
  };

  const inferredQuestions = extractInferredStatusQuestionNodes(input.content);
  const deterministicEvidence = extractDeterministicEvidenceNodes(input.content);
  const deterministicActions = extractDeterministicActionNodes(input.content);
  const deterministicDecision = extractDeterministicDecisionNode(input.content);
  const explicitQuestions = [
    ...extractLiteralQuestionNodes(input.content),
    ...analysis.nodes.filter((node) => (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && /\?\s*$/.test(node.text)),
  ];
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
  const candidateTextMatch = (left: string, right: string) => exactTextMatch(left, right)
    || fallbackMatchesQuestion(left, right)
    || fallbackMatchesQuestion(right, left);
  const actionForModel = () => deterministicActions.length === 1 ? deterministicActions[0] : undefined;
  const explicitCandidateMerge = (left: Candidate, right: Candidate) => {
    const leftIndexes = new Set(left.originalIndices);
    const rightIndexes = new Set(right.originalIndices);
    return analysis.reconciliation.some((item) => {
      if (!['PARAPHRASE', 'SUBQUESTION'].includes(item.classification) || item.canonical_candidate_index === undefined) return false;
      return (leftIndexes.has(item.candidate_index) && rightIndexes.has(item.canonical_candidate_index))
        || (rightIndexes.has(item.candidate_index) && leftIndexes.has(item.canonical_candidate_index));
    });
  };

  const normalizeModelNode = (node: ContextAnalysis['nodes'][number]): ContextAnalysis['nodes'][number] => {
    if (node.type !== 'UNKNOWN' && node.type !== 'ASSUMPTION') return node;
    const normalized = normalizePersonalQuestion(node.text, input.content);
    const normalizedAliases = node.question_aliases?.map((alias) => normalizePersonalQuestion(alias, input.content));
    const inferredQuestion = inferredQuestions.find((question) => fallbackMatchesQuestion(question.text, normalized));
    const action = actionForModel();
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
  }));

  const addCandidate = (
    node: ContextAnalysis['nodes'][number],
    literal = false,
    deduplicate = true,
    fallback = false,
  ) => {
    const alreadyPresent = candidates.some((candidate) =>
      candidate.node.type === node.type && exactTextMatch(candidate.node.text, node.text)
    );
    // Literal questions are user-authored answer targets. Similarity is only
    // a guard for inferred/model candidates and must never discard the exact
    // wording the user supplied.
    if (alreadyPresent && !literal && deduplicate) return;
    candidates.push({ node, originalIndices: [], literal, fallback });
  };

  extractLiteralQuestionNodes(input.content).forEach((question) => {
    const existingIndex = candidates.findIndex((candidate) =>
      !candidate.literal
      && (candidate.node.type === 'UNKNOWN' || candidate.node.type === 'ASSUMPTION')
      && questionCandidateMatches(candidate.node.text, question.text)
    );
    if (existingIndex >= 0) {
      const existing = candidates[existingIndex];
      candidates[existingIndex] = {
        ...existing,
        literal: true,
        node: {
          ...existing.node,
          text: question.text,
          status: 'OPEN',
          confidence: Math.max(existing.node.confidence, question.confidence),
          impact: Math.max(existing.node.impact, question.impact ?? 0.82),
          why_it_matters: Array.from(new Set([
            ...existing.node.why_it_matters,
            ...(question.whyItMatters ?? []),
          ])),
        },
      };
      return;
    }
    addCandidate({
      type: question.type,
      text: question.text,
      confidence: question.confidence,
      impact: question.impact ?? 0.82,
      status: 'OPEN',
      why_it_matters: question.whyItMatters ?? [],
      question_aliases: [],
      related_node_ids: [],
      relationship: null,
    }, true);
  });

  extractMissingContingencyQuestionNodes(input.content).forEach((question) => addCandidate({
    type: question.type,
    text: question.text,
    confidence: question.confidence,
    impact: question.impact ?? 0.82,
    status: 'OPEN',
    why_it_matters: question.whyItMatters ?? [],
    question_aliases: [],
    related_node_ids: [],
    relationship: null,
  }, false, true, true));

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
  }, false, false, true));

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
  }, false, true, true));

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
  }));

  const merged: Candidate[] = [];
  const consumed = new Set<number>();
  // Literal questions are the user's intended answer shape. Process them
  // first so every generated subquestion they cover joins that one canonical
  // candidate, regardless of the model's output order.
  const candidateOrder = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => Number(right.candidate.literal) - Number(left.candidate.literal));
  candidateOrder.forEach(({ candidate, index }) => {
    if (consumed.has(index)) return;
    const memberIndices = candidates
      .map((other, otherIndex) => ({ other, otherIndex }))
      .filter(({ other, otherIndex }) => {
        if (otherIndex === index || consumed.has(otherIndex)) return false;
        if (candidate.literal && other.literal) return false;
        if (!((candidate.node.type === 'UNKNOWN' || candidate.node.type === 'ASSUMPTION')
          && (other.node.type === 'UNKNOWN' || other.node.type === 'ASSUMPTION'))) return false;
        return candidateTextMatch(candidate.node.text, other.node.text)
          || explicitCandidateMerge(candidate, other);
      })
      .map(({ otherIndex }) => otherIndex);
    const indices = [index, ...memberIndices];
    indices.forEach((memberIndex) => consumed.add(memberIndex));
    const members = indices.map((memberIndex) => candidates[memberIndex]);
    const selected = [...members].sort((left, right) =>
      Number(right.literal) - Number(left.literal)
      || Number(left.fallback) - Number(right.fallback)
      || right.node.confidence - left.node.confidence
      || right.node.impact - left.node.impact
    )[0];
    const aliases = Array.from(new Set([
      ...members.flatMap((member) => member.node.question_aliases ?? []),
      ...members.map((member) => member.node.text),
    ].filter((text) => text && text !== selected.node.text)));
    merged.push({
      node: {
        ...selected.node,
        confidence: Math.max(...members.map((member) => member.node.confidence)),
        impact: Math.max(...members.map((member) => member.node.impact)),
        why_it_matters: Array.from(new Set(members.flatMap((member) => member.node.why_it_matters))),
        question_aliases: aliases,
      },
      originalIndices: [
        ...selected.originalIndices,
        ...members.flatMap((member) => member.originalIndices)
          .filter((originalIndex) => !selected.originalIndices.includes(originalIndex)),
      ],
      literal: members.some((member) => member.literal),
      fallback: selected.fallback,
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
  return remapFinalizedAnalysis(remapped, remapped.nodes, protectedIndices, new Set());
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

export async function processContextSource(
  project: Project,
  input: IngestSourceInput,
  profile: UserMemoryProfile,
  options: {
    forceReprocess?: boolean;
    model?: string;
    genAI?: ReturnType<typeof getVertexGenAIClient>;
  } = {}
): Promise<ProcessContextSourceResult> {
  const hash = input.hash ?? await hashText(`${input.filename}:${input.content}:${input.storageUrl ?? ''}`);
  const existing = project.sources.find((source) => successfulSource(source, hash));
  if (existing && !options.forceReprocess) {
    return { project, skipped: true, modelUsed: existing.model_used };
  }

  if (isDemoMode()) {
    const updated = await ingestContextSource(project, {
      ...input,
      hash,
      extractionHash: hash,
      processingStatus: input.processingStatus ?? 'completed',
      relevance: input.relevance ?? 'relevant',
    }, profile);
    return { project: updated, skipped: false, modelUsed: input.modelUsed };
  }

  try {
    const { analysis: rawAnalysis, modelUsed } = await analyzeContextItem({
      sourceId: input.sourceId ?? 'new-source',
      filename: input.filename,
      content: input.content,
      type: input.type,
      storageUrl: input.storageUrl,
      mimeType: input.mimeType,
      model: options.model,
      genAI: options.genAI,
    }, project);
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
    const analysis = filterGoalRelevantUnknowns(finalizeQuestionCandidates(rawAnalysis, analysisInput), analysisInput, project);
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
    }, profile);
    return { project: updated, skipped: false, analysis, modelUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini context analysis failed.';
    const failed = await ingestContextSource(project, {
      ...input,
      hash,
      processingStatus: 'failed',
      errorMessage: message,
      extractionHash: undefined,
      derivedNodes: extractDeterministicFallbackNodes(input.content),
    }, profile);
    return { project: failed, skipped: false, error: message };
  }
}
