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
  extractDeterministicQuestionNodes,
  ingestContextSource,
  IngestSourceInput,
  PrecomputedRelationship,
  PrecomputedSourceNode,
} from '@/lib/context/ingestion';
import { projectForReasoning } from '@/lib/context/sourceState';
import { canonicalOpenQuestions, canonicalQuestionGroups, reconcileQuestionCandidates, semanticallyEquivalentQuestion } from '@/lib/questions/canonical';

const reconciliationClassificationSchema = z.enum([
  'NEW_UNCERTAINTY',
  'PARAPHRASE',
  'SUBQUESTION',
  'SUPPORTING_EVIDENCE',
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
    'Create an UNKNOWN node for every explicit unresolved question in the source, including bullets under headings such as "unresolved", "pending", "open questions", or "blocking inputs". Do not drop an explicit question just because nearby facts are more detailed. Also turn a negative blocker such as "legal has not approved the SMS consent" or "the vendor has not demonstrated idempotent retries" into an UNKNOWN question and retain the negative statement as evidence. Only add a small number of additional inferred questions when answering them could materially improve a decision or advance the project goal. For example, separate "I do not know what pink things are" from "I need to know if green things are better than pink things" into two useful unknowns.',
    'Do not generate generic checklists, trivia, or every possible missing detail. Merge semantically repeated questions with existing graph questions and preserve every source reference. Do not duplicate an existing node with the same meaning. Preserve useful new evidence even when it challenges an existing assumption; do not rewrite or delete existing nodes.',
    'For every returned UNKNOWN or ASSUMPTION node, classify its relationship to the canonical_questions in the current project and to other question-like nodes returned in this same response. Use PARAPHRASE for the same underlying uncertainty, SUBQUESTION for a narrower option-specific check, ASSUMPTION for an unverified belief, SUPPORTING_EVIDENCE for a claim that helps answer an existing question, NEW_UNCERTAINTY for a new uncertainty, and RELATED_BUT_DISTINCT only when the answer and downstream action are independently different. Set canonical_question_id only to an id from canonical_questions. When the same response contains a paraphrase or subquestion of another newly returned question, set canonical_candidate_index to the earlier zero-based node index instead. Do not point forward to a later candidate. Do not merge questions merely because they share nouns; compare the answer needed and the decision/action that would change. Return one reconciliation object per returned question-like node.',
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
      && !(modelReconciliation?.classification === 'NEW_UNCERTAINTY' && deterministic?.canonicalQuestionId)
      && !(modelReconciliation?.classification === 'NEW_UNCERTAINTY' && deterministic?.canonicalCandidateIndex !== undefined);
    const reconciliation = useModelReconciliation ? modelReconciliation : deterministic;
    const canonicalQuestionId = reconciliation === modelReconciliation
      ? validModelExistingTarget
      : reconciliation?.canonicalQuestionId;
    const canonicalCandidateIndex = reconciliation === modelReconciliation
      ? validModelCandidateTarget
      : reconciliation?.canonicalCandidateIndex;
    const effectiveType = reconciliation?.classification === 'SUPPORTING_EVIDENCE'
      && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
      ? 'EVIDENCE'
      : node.type;
    return {
      type: effectiveType,
      text: node.text,
      confidence: node.confidence,
      impact: node.impact,
      status: node.status,
      whyItMatters: node.why_it_matters,
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

function comparableQuestionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(?:what|where|when|which|who|how|why|does|could|would|should|are|the|and|for|from|with|this|that|about|into|your|you|can|will|have|need|know|still|whether|confirm|clarify|determine|find|out)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function questionSimilarity(left: string, right: string): number {
  const leftTokens = new Set(comparableQuestionText(left).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(comparableQuestionText(right).split(/\s+/).filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return overlap / Math.max(1, union);
}

/**
 * The model may summarize an explicit question as a risk or omit it while
 * focusing on surrounding facts. Add the source's explicit questions back
 * before goal-relevance filtering, while retaining the model's evidence and
 * relationships. This keeps extraction complete without changing ranking.
 */
function preserveExplicitQuestions(analysis: ContextAnalysis, input: AnalyzeContextInput): ContextAnalysis {
  const explicit = extractDeterministicQuestionNodes(input.content);
  if (!explicit.length) return analysis;
  const nodes = [...analysis.nodes];
  const explicitIndices = new Set<number>();
  explicit.forEach((question) => {
    const existingIndex = nodes.findIndex((node) =>
      node.type === 'UNKNOWN'
      && (questionSimilarity(node.text, question.text) >= 0.72
        || semanticallyEquivalentQuestion(node.text, question.text))
    );
    // Keep the first explicit source wording as the canonical text. If the
    // source contains another equivalent question, retain it as a separate
    // candidate so the reconciliation pass can record it as an alias or
    // subquestion instead of allowing the model to overwrite source meaning.
    if (existingIndex >= 0 && !explicitIndices.has(existingIndex)) {
      explicitIndices.add(existingIndex);
      nodes[existingIndex] = {
        ...nodes[existingIndex],
        text: question.text,
        status: 'OPEN',
        confidence: Math.max(nodes[existingIndex].confidence, question.confidence),
        impact: Math.max(nodes[existingIndex].impact, question.impact ?? 0.82),
        why_it_matters: Array.from(new Set([
          ...nodes[existingIndex].why_it_matters,
          ...(question.whyItMatters ?? []),
        ])),
      };
      return;
    }
    nodes.push({
      type: question.type,
      text: question.text,
      confidence: question.confidence,
      impact: question.impact ?? 0.82,
      status: 'OPEN',
      why_it_matters: question.whyItMatters ?? [],
      related_node_ids: [],
      relationship: null,
    });
    explicitIndices.add(nodes.length - 1);
  });

  if (nodes.length <= 12) return { ...analysis, nodes };

  // Keep every explicit question and fill the remaining schema budget with
  // the model's highest-impact nodes. Re-map relationship indexes safely.
  const selectedIndices = Array.from(new Set([
    ...Array.from(explicitIndices),
    ...nodes
      .map((node, index) => ({ node, index }))
      .filter(({ index }) => !explicitIndices.has(index))
      .sort((left, right) => (right.node.impact * right.node.confidence) - (left.node.impact * left.node.confidence))
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
  return {
    ...analysis,
    nodes: selectedIndices.map((index) => nodes[index]),
    relationships,
  };
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
    return candidateIndex === undefined ? [] : [{ ...candidate, candidate_index: candidateIndex }];
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
    const analysis = filterGoalRelevantUnknowns(preserveExplicitQuestions(rawAnalysis, {
      sourceId: input.sourceId ?? 'new-source',
      filename: input.filename,
      content: input.content,
      type: input.type,
      storageUrl: input.storageUrl,
      mimeType: input.mimeType,
      model: options.model,
      genAI: options.genAI,
    }), {
      sourceId: input.sourceId ?? 'new-source',
      filename: input.filename,
      content: input.content,
      type: input.type,
      storageUrl: input.storageUrl,
      mimeType: input.mimeType,
      model: options.model,
      genAI: options.genAI,
    }, project);
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
      derivedNodes: [],
    }, profile);
    return { project: failed, skipped: false, error: message };
  }
}
