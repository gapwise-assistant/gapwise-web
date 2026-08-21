import { Type } from '@google/genai';
import { z } from 'zod';
import { ClarityNode, ContextSource, Project, QuestionReconciliationSummary } from '@/types/clarity';
import { nodeTypeSchema, validateStructuredOutput } from '@/lib/agents/schemas';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';
import { canonicalQuestionGroups, reconcileQuestionCandidates, semanticallyEquivalentQuestion, type QuestionReconciliationClassification } from '@/lib/questions/canonical';

const pdfNodeTypeSchema = z.enum([
  'KNOWN',
  'GOAL',
  'CONSTRAINT',
  'ASSUMPTION',
  'DECISION',
  'UNKNOWN',
  'EVIDENCE',
  'RISK',
  'NEXT_ACTION',
] satisfies [z.infer<typeof nodeTypeSchema>, ...Array<z.infer<typeof nodeTypeSchema>>]);

const PDF_NODE_TYPES = pdfNodeTypeSchema.options;
const normalizedPdfNodeTypeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.toUpperCase() : value),
  pdfNodeTypeSchema
);

export const pdfExtractionSchema = z.object({
  summary: z.string().min(1),
  nodes: z.array(
    z.object({
      type: normalizedPdfNodeTypeSchema,
      text: z.string().min(1),
      confidence: z.number().min(0).max(1),
    })
  ).default([]),
  reconciliation: z.array(z.object({
    candidate_index: z.number().int().min(0).max(11),
    classification: z.enum([
      'NEW_UNCERTAINTY',
      'PARAPHRASE',
      'SUBQUESTION',
      'SUPPORTING_EVIDENCE',
      'ASSUMPTION',
      'RELATED_BUT_DISTINCT',
    ]),
    canonical_question_id: z.string().optional(),
    canonical_candidate_index: z.number().int().min(0).max(11).optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(280),
  })).max(12).default([]),
});

export type PdfExtraction = z.infer<typeof pdfExtractionSchema>;

export interface AnalyzePdfInput {
  sourceId: string;
  storageUrl: string;
  mimeType?: string;
  model?: string;
  genAI?: ReturnType<typeof getVertexGenAIClient>;
  project?: Project;
}

export interface ProcessPdfSourceResult {
  project: Project;
  skipped: boolean;
  extraction?: PdfExtraction;
  modelUsed?: string;
  error?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeNodeId(sourceId: string, index: number): string {
  return `node_pdf_${sourceId}_${index + 1}`;
}

function canonicalQuestionSnapshot(project?: Project): string {
  if (!project) return '[]';
  return JSON.stringify(canonicalQuestionGroups(project)
    .map((group) => ({ id: group.canonical.id, text: group.canonical.text, status: group.canonical.status }))
    .slice(0, 12));
}

function statusForType(type: ClarityNode['type']): ClarityNode['status'] {
  return type === 'UNKNOWN' || type === 'ASSUMPTION' || type === 'RISK' || type === 'NEXT_ACTION' || type === 'GOAL' ? 'OPEN' : 'RESOLVED';
}

function pdfReconciliationSummary(extraction: PdfExtraction, resolvedClassifications?: Array<QuestionReconciliationClassification | undefined>): QuestionReconciliationSummary {
  const questionIndexes = extraction.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
    .map(({ index }) => index);
  const byIndex = new Map(extraction.reconciliation.map((item) => [item.candidate_index, item.classification as QuestionReconciliationClassification]));
  const results = questionIndexes.map((index) => resolvedClassifications?.[index] ?? byIndex.get(index));
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

function parseModelJson(text: string | undefined): unknown {
  if (!text) {
    throw new StorageError('Gemini returned an empty PDF extraction response.', 'UNAVAILABLE');
  }
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(trimmed);
}

export function hasSuccessfulPdfExtraction(source: ContextSource): boolean {
  return Boolean(
    source.hash &&
      source.extraction_hash === source.hash &&
      source.processing_status === 'completed' &&
      source.extraction_summary &&
      source.model_used
  );
}

export async function analyzePdfFromGcs(input: AnalyzePdfInput): Promise<{
  extraction: PdfExtraction;
  modelUsed: string;
}> {
  assertExternalServicesAllowed('Vertex AI / Gemini PDF analysis');
  const model = input.model ?? getAgentModelConfig('context').model;
  const genAI = input.genAI ?? getVertexGenAIClient();
  const response = await genAI.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            fileData: {
              fileUri: input.storageUrl,
              mimeType: input.mimeType || 'application/pdf',
            },
          },
          {
            text:
              'Extract Gapwise graph context from this PDF. Return only JSON with this shape: ' +
              '{"summary":"short summary","nodes":[{"type":"KNOWN | GOAL | CONSTRAINT | ASSUMPTION | DECISION | UNKNOWN | EVIDENCE | RISK | NEXT_ACTION","text":"node text","confidence":0.0}],"reconciliation":[{"candidate_index":0,"classification":"NEW_UNCERTAINTY | PARAPHRASE | SUBQUESTION | SUPPORTING_EVIDENCE | ASSUMPTION | RELATED_BUT_DISTINCT","canonical_question_id":"existing id when applicable","canonical_candidate_index":0,"confidence":0.0,"reason":"short reason"}]}. ' +
              'Keep nodes concise, source-grounded, and useful for goals, gaps, decisions, risks, evidence, constraints, and next actions. Preserve every explicit unresolved question in the PDF as an UNKNOWN node, including questions in lists or sections titled unresolved, pending, open questions, or blocking inputs. If the PDF says that legal approval, ownership, a vendor demonstration, or another prerequisite is missing, retain that statement as evidence and also create the natural UNKNOWN question it leaves open. Merge repeated questions by meaning instead of creating duplicates. ' +
              `Canonical questions already in this project: ${canonicalQuestionSnapshot(input.project)}. Compare answer shape and downstream action, including among candidates returned from this PDF; use canonical_candidate_index for an earlier candidate in this response when appropriate. Do not merge questions merely because they share nouns. Never include private reasoning.`,
          },
        ],
      },
    ],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: ['summary', 'nodes', 'reconciliation'],
        properties: {
          summary: { type: Type.STRING },
          nodes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['type', 'text', 'confidence'],
              properties: {
                type: { type: Type.STRING, enum: PDF_NODE_TYPES },
                text: { type: Type.STRING },
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
                classification: { type: Type.STRING, enum: ['NEW_UNCERTAINTY', 'PARAPHRASE', 'SUBQUESTION', 'SUPPORTING_EVIDENCE', 'ASSUMPTION', 'RELATED_BUT_DISTINCT'] },
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
    extraction: validateStructuredOutput(pdfExtractionSchema, parseModelJson(response.text)),
    modelUsed: response.modelVersion || model,
  };
}

export async function processPdfSource(
  project: Project,
  sourceId: string,
  options: {
    forceReprocess?: boolean;
    model?: string;
    genAI?: ReturnType<typeof getVertexGenAIClient>;
  } = {}
): Promise<ProcessPdfSourceResult> {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const source = updated.sources.find((item) => item.id === sourceId);

  if (!source) {
    throw new StorageError('PDF source was not found for processing.', 'VALIDATION_ERROR');
  }
  if (source.type !== 'pdf') {
    throw new StorageError('Only PDF sources can be processed by Gemini PDF extraction.', 'VALIDATION_ERROR');
  }
  if (!source.storage_url?.startsWith('gs://')) {
    throw new StorageError('PDF source processing requires a gs:// Cloud Storage URL.', 'VALIDATION_ERROR');
  }

  if (!options.forceReprocess && hasSuccessfulPdfExtraction(source)) {
    return { project: updated, skipped: true, modelUsed: source.model_used };
  }

  source.processing_status = 'processing';
  source.error_message = undefined;
  updated.updated_at = nowIso();

  try {
    const { extraction, modelUsed } = await analyzePdfFromGcs({
      sourceId,
      storageUrl: source.storage_url,
      mimeType: source.mime_type || 'application/pdf',
      model: options.model,
      genAI: options.genAI,
      project: updated,
    });

    const nodeIds = extraction.nodes.map((_node, index) => makeNodeId(sourceId, index));
    const createdAt = nowIso();
    const previousPdfNodeIds = new Set(source.derived_node_ids);
    updated.nodes = updated.nodes.flatMap((node) => {
      if (!previousPdfNodeIds.has(node.id)) return [node];
      const remainingRefs = node.source_refs.filter((ref) => ref !== sourceId);
      return remainingRefs.length ? [{ ...node, source_refs: remainingRefs, updated_at: createdAt }] : [];
    });
    const validQuestionIds = new Set(canonicalQuestionGroups(updated).map((group) => group.canonical.id));
    const questionIndexes = extraction.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.type === 'UNKNOWN' || node.type === 'ASSUMPTION');
    const deterministicBatch = reconcileQuestionCandidates(
      questionIndexes.map(({ node }) => ({ type: node.type, text: node.text })),
      updated,
    );
    const deterministicByIndex = new Map(questionIndexes.map(({ index }, questionIndex) => [index, deterministicBatch[questionIndex]]));
    const resolvedClassifications: Array<QuestionReconciliationClassification | undefined> = [];
    extraction.nodes.forEach((node, index) => {
      const modelReconciliationRaw = extraction.reconciliation.find((candidate) => candidate.candidate_index === index);
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
        && (extraction.nodes[modelCandidateTarget]?.type === 'UNKNOWN' || extraction.nodes[modelCandidateTarget]?.type === 'ASSUMPTION')
        ? modelCandidateTarget
        : undefined;
      const validModelExistingTarget = modelReconciliation?.canonicalQuestionId
        && validQuestionIds.has(modelReconciliation.canonicalQuestionId)
        ? modelReconciliation.canonicalQuestionId
        : undefined;
      const modelNeedsTarget = modelReconciliation?.classification === 'PARAPHRASE'
        || modelReconciliation?.classification === 'SUBQUESTION'
        || modelReconciliation?.classification === 'ASSUMPTION';
      const useModelReconciliation = Boolean(modelReconciliation)
        && (!modelNeedsTarget || Boolean(validModelExistingTarget || validModelCandidateTarget !== undefined))
        && !(modelReconciliation?.classification === 'NEW_UNCERTAINTY' && deterministic?.canonicalQuestionId)
        && !(modelReconciliation?.classification === 'NEW_UNCERTAINTY' && deterministic?.canonicalCandidateIndex !== undefined);
      const reconciliation = useModelReconciliation ? modelReconciliation : deterministic;
      const canonicalQuestionId = reconciliation === modelReconciliation
        ? validModelExistingTarget
        : reconciliation?.canonicalQuestionId;
      const canonicalCandidateIndex = reconciliation === modelReconciliation
        ? validModelCandidateTarget
        : reconciliation?.canonicalCandidateIndex;
      const siblingTargetId = canonicalCandidateIndex !== undefined ? nodeIds[canonicalCandidateIndex] : undefined;
      const siblingTarget = siblingTargetId ? updated.nodes.find((candidate) => candidate.id === siblingTargetId) : undefined;
      const resolvedCanonicalQuestionId = canonicalQuestionId
        ?? ((siblingTarget?.type === 'UNKNOWN' || siblingTarget?.type === 'ASSUMPTION')
          ? siblingTarget.canonical_question_id ?? siblingTarget.id
          : undefined);
      const classification = reconciliation?.classification as QuestionReconciliationClassification | undefined;
      resolvedClassifications[index] = classification;
      const effectiveType: ClarityNode['type'] = classification === 'SUPPORTING_EVIDENCE'
        && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
        ? 'EVIDENCE'
        : node.type;
      const target = resolvedCanonicalQuestionId ? updated.nodes.find((candidate) => candidate.id === resolvedCanonicalQuestionId) : undefined;
      const existing = (reconciliation?.classification === 'PARAPHRASE' && target)
        ? target
        : updated.nodes.find((candidate) => candidate.type === effectiveType && candidate.text.toLowerCase() === node.text.toLowerCase())
        ?? ((effectiveType === 'UNKNOWN' || effectiveType === 'ASSUMPTION') && !resolvedCanonicalQuestionId && reconciliation === deterministic
          ? updated.nodes.find((candidate) =>
              (candidate.type === 'UNKNOWN' || candidate.type === 'ASSUMPTION')
              && semanticallyEquivalentQuestion(candidate.text, node.text)
            )
          : undefined);
      if (existing) {
        existing.source_refs = Array.from(new Set([...existing.source_refs, sourceId]));
        existing.confidence = Math.max(existing.confidence, node.confidence);
        existing.impact = Math.max(existing.impact, node.confidence);
        existing.status = statusForType(effectiveType);
        existing.question_aliases = Array.from(new Set([
          ...(existing.question_aliases ?? []),
          ...(existing.text === node.text ? [] : [node.text]),
        ]));
        existing.reconciliation_confidence = Math.max(existing.reconciliation_confidence ?? 0, reconciliation?.confidence ?? 0);
        existing.reconciliation_reason = reconciliation?.reason ?? existing.reconciliation_reason;
        existing.reconciliation_status = modelReconciliation && useModelReconciliation ? 'reconciled' : 'fallback';
        existing.updated_at = createdAt;
        nodeIds[index] = existing.id;
        return;
      }
      const createdNode: ClarityNode = {
        id: nodeIds[index],
        type: effectiveType,
        text: node.text,
        status: statusForType(effectiveType),
        confidence: node.confidence,
        impact: node.confidence,
        source_refs: [sourceId],
        created_by: 'agent',
        created_at: createdAt,
        updated_at: createdAt,
        x: 180 + Math.random() * 360,
        y: 220 + Math.random() * 280,
        question_role: (effectiveType === 'UNKNOWN' || effectiveType === 'ASSUMPTION')
          ? (classification === 'SUBQUESTION'
            ? 'subquestion'
            : classification === 'ASSUMPTION'
              ? 'assumption'
              : classification === 'RELATED_BUT_DISTINCT'
                ? 'related'
                : 'canonical')
          : undefined,
        canonical_question_id: resolvedCanonicalQuestionId,
        question_aliases: effectiveType === 'UNKNOWN' || effectiveType === 'ASSUMPTION' ? [] : undefined,
        reconciliation_confidence: reconciliation?.confidence,
        reconciliation_reason: reconciliation?.reason,
        reconciliation_status: modelReconciliation && useModelReconciliation ? 'reconciled' : ((effectiveType === 'UNKNOWN' || effectiveType === 'ASSUMPTION') ? 'fallback' : undefined),
      };
      updated.nodes.push(createdNode);
    });

    source.content = source.content.trim() || extraction.summary;
    source.extraction_summary = extraction.summary;
    source.reconciliation_summary = pdfReconciliationSummary(extraction, resolvedClassifications);
    source.derived_node_ids = Array.from(new Set(nodeIds));
    source.processing_status = 'completed';
    source.processed_at = createdAt;
    source.model_used = modelUsed;
    source.extraction_hash = source.hash;
    source.error_message = undefined;
    updated.updated_at = createdAt;

    return { project: updated, skipped: false, extraction, modelUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini PDF extraction failed.';
    source.processing_status = 'failed';
    source.error_message = message;
    source.processed_at = nowIso();
    updated.updated_at = source.processed_at;
    return { project: updated, skipped: false, error: message };
  }
}
