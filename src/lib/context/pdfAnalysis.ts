import { Type } from '@google/genai';
import { z } from 'zod';
import { ClarityNode, ContextSource, Project } from '@/types/clarity';
import { nodeTypeSchema, validateStructuredOutput } from '@/lib/agents/schemas';
import { getConfiguredGeminiModel, getVertexGenAIClient } from '@/lib/google/genai';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';

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
});

export type PdfExtraction = z.infer<typeof pdfExtractionSchema>;

export interface AnalyzePdfInput {
  sourceId: string;
  storageUrl: string;
  mimeType?: string;
  model?: string;
  genAI?: ReturnType<typeof getVertexGenAIClient>;
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

function statusForType(type: ClarityNode['type']): ClarityNode['status'] {
  return type === 'UNKNOWN' || type === 'RISK' || type === 'NEXT_ACTION' || type === 'GOAL' ? 'OPEN' : 'RESOLVED';
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
  const model = input.model ?? getConfiguredGeminiModel();
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
              '{"summary":"short summary","nodes":[{"type":"KNOWN | GOAL | CONSTRAINT | ASSUMPTION | DECISION | UNKNOWN | EVIDENCE | RISK | NEXT_ACTION","text":"node text","confidence":0.0}]}. ' +
              'Keep nodes concise, source-grounded, and useful for goals, gaps, decisions, risks, evidence, constraints, and next actions.',
          },
        ],
      },
    ],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: ['summary', 'nodes'],
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
    });

    const nodeIds = extraction.nodes.map((_node, index) => makeNodeId(sourceId, index));
    const createdAt = nowIso();
    updated.nodes = updated.nodes.filter((node) => !source.derived_node_ids.includes(node.id));
    updated.nodes.push(
      ...extraction.nodes.map((node, index) => ({
        id: nodeIds[index],
        type: node.type,
        text: node.text,
        status: statusForType(node.type),
        confidence: node.confidence,
        impact: node.confidence,
        source_refs: [sourceId],
        created_by: 'agent' as const,
        created_at: createdAt,
        updated_at: createdAt,
        x: 180 + Math.random() * 360,
        y: 220 + Math.random() * 280,
      }))
    );

    source.content = source.content.trim() || extraction.summary;
    source.extraction_summary = extraction.summary;
    source.derived_node_ids = nodeIds;
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
