import { Type } from '@google/genai';
import { z } from 'zod';
import { ClarityNode, ContextProcessingLog, ContextProcessingLogStage, ContextSource, EdgeType, Project, ProjectPatchOperation, UserMemoryProfile } from '@/types/clarity';
import { nodeTypeSchema, validateStructuredOutput } from '@/lib/agents/schemas';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed, isDemoMode } from '@/lib/runtime/demoMode';
import {
  hashText,
  ingestContextSource,
  IngestSourceInput,
  PrecomputedRelationship,
  PrecomputedSourceNode,
} from '@/lib/context/ingestion';
import { projectForReasoning } from '@/lib/context/sourceState';
import { serializeProcessingProjectSnapshot } from '@/lib/context/processingProjectSnapshot';
import { defaultMimeTypeForSourceType } from '@/lib/context/contextAttachments';
import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { appendContextAddedHistory, appendNextActionCompletionHistory } from '@/lib/history/projectHistory';
import { resolveSatisfiedNextActions } from '@/lib/actions/completion';
import { retireExplicitlyDisprovedRisks } from '@/lib/graph/riskLifecycle';
import {
  changedProjectNodeIds,
  completeProjectRelationships,
} from '@/lib/graph/relationshipCompletion';

const reconciliationClassificationSchema = z.enum([
  'NEW_UNCERTAINTY',
  'PARAPHRASE',
  'SUBQUESTION',
  'SUPPORTING_EVIDENCE',
  'NEXT_ACTION',
  'ALREADY_ANSWERED',
  'ASSUMPTION',
  'RELATED_BUT_DISTINCT',
  'EQUIVALENT',
  'REFINES_EXISTING',
  'BROADER_THAN_EXISTING',
  'DISTINCT',
]);

const reconciliationResultSchema = z.object({
  candidate_index: z.number().int().min(0).max(11),
  /** Stable internal identity attached immediately after model validation. */
  candidate_ref: z.string().optional(),
  classification: reconciliationClassificationSchema,
  canonical_question_id: z.string().optional(),
  canonical_node_id: z.string().optional(),
  canonical_candidate_index: z.number().int().min(0).max(11).optional(),
  canonical_candidate_ref: z.string().optional(),
  same_atomic_proposition: z.boolean().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(280),
});

const normalizedNodeTypeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.toUpperCase() : value),
  nodeTypeSchema
);

const extractionBasisSchema = z.enum(['USER_STATED', 'AI_DERIVED']);
const nodeGroundingSchema = z.enum(['SOURCE_ASSERTED', 'HYPOTHETICAL', 'AI_DERIVED']);

const canonicalChangeSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('RESOLVE_DECISION'),
    targetNodeId: z.string().min(1),
    outcome: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    operation: z.literal('OPEN_DECISION'),
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    operation: z.literal('RESOLVE_UNKNOWN'),
    targetNodeId: z.string().min(1),
    answer: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    operation: z.literal('NO_CHANGE'),
    confidence: z.number().min(0).max(1).default(1),
  }),
]);

const patchContextNodeTypeSchema = z.enum([
  'KNOWN',
  'EVIDENCE',
  'CONSTRAINT',
  'PREFERENCE',
  'RISK',
  'ASSUMPTION',
]);

const operationGroundingSchema = z.enum(['SOURCE_ASSERTED', 'AI_DERIVED']);

const projectPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('ADD_CONTEXT'),
    nodeType: patchContextNodeTypeSchema,
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1).default(0.7),
    grounding: operationGroundingSchema.optional(),
    operationRef: z.string().optional(),
    targetNodeId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('OPEN_DECISION'),
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1).default(0.7),
    grounding: operationGroundingSchema.optional(),
    operationRef: z.string().optional(),
    targetNodeId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('RESOLVE_DECISION'),
    targetNodeId: z.string().min(1),
    outcome: z.string().min(1),
    confidence: z.number().min(0).max(1),
    grounding: operationGroundingSchema.optional(),
    operationRef: z.string().optional(),
  }),
  z.object({
    op: z.literal('OPEN_UNKNOWN'),
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1).default(0.7),
    grounding: operationGroundingSchema.optional(),
    operationRef: z.string().optional(),
    targetNodeId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('RESOLVE_UNKNOWN'),
    targetNodeId: z.string().min(1),
    answer: z.string().min(1),
    confidence: z.number().min(0).max(1),
    grounding: operationGroundingSchema.optional(),
    operationRef: z.string().optional(),
  }),
  z.object({
    op: z.literal('ADD_ACTION'),
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1).default(0.7),
    grounding: operationGroundingSchema.optional(),
    operationRef: z.string().optional(),
    targetNodeId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('NO_CHANGE'),
    confidence: z.number().min(0).max(1).optional(),
    grounding: operationGroundingSchema.optional(),
    operationRef: z.string().optional(),
  }),
]);

const relationshipSchema = z.enum([
  'supports',
  'contradicts',
  'depends_on',
  'blocks',
  'informs',
  'resolves',
  'satisfies',
  'derived_from',
  'supersedes',
  'affects',
] satisfies [EdgeType, ...EdgeType[]]);

const relationshipOutputSchema = z.object({
  source_ref: z.string().min(1).optional(),
  target_ref: z.string().min(1).optional(),
  // Accepted only for stored traces and older deterministic fixtures. The
  // live model contract below emits the symmetric ref fields.
  source_node_index: z.number().int().min(0).max(11).optional(),
  target_node_id: z.string().min(1).optional(),
  type: relationshipSchema,
  confidence: z.number().min(0).max(1).default(0.8),
}).superRefine((relationship, context) => {
  if (!relationship.source_ref && relationship.source_node_index === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A relationship source reference is required.' });
  }
  if (!relationship.target_ref && !relationship.target_node_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A relationship target reference is required.' });
  }
}).transform((relationship) => ({
  source_ref: relationship.source_ref ?? `new:${relationship.source_node_index}`,
  target_ref: relationship.target_ref ?? relationship.target_node_id ?? '',
  type: relationship.type,
  confidence: relationship.confidence,
}));

function legacyCanonicalChangeToOperation(change: Record<string, unknown>, index: number): Record<string, unknown> {
  const operationRef = `op:${index}`;
  switch (change.operation) {
    case 'RESOLVE_DECISION':
      return { op: 'RESOLVE_DECISION', targetNodeId: change.targetNodeId, outcome: change.outcome, confidence: change.confidence, operationRef };
    case 'OPEN_DECISION':
      return { op: 'OPEN_DECISION', text: change.text, confidence: change.confidence, impact: 0.9, operationRef };
    case 'RESOLVE_UNKNOWN':
      return { op: 'RESOLVE_UNKNOWN', targetNodeId: change.targetNodeId, answer: change.answer, confidence: change.confidence, operationRef };
    default:
      return { op: 'NO_CHANGE', confidence: change.confidence, operationRef };
  }
}

export const contextAnalysisSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.operations === undefined) {
      const legacyChanges = Array.isArray(record.canonical_changes)
        ? record.canonical_changes
        : Array.isArray(record.changes)
          ? record.changes
          : undefined;
      if (legacyChanges) {
        return {
          ...record,
          operations: legacyChanges.map((change, index) => legacyCanonicalChangeToOperation(change as Record<string, unknown>, index)),
        };
      }
    }
  }
  return value;
}, z.object({
  summary: z.string().min(1),
  relevance: z.enum(['relevant', 'possibly_not_relevant']).default('relevant'),
  operations: z.array(projectPatchOperationSchema).max(24).default([]),
  nodes: z.array(z.object({
    /** Stable internal identity; generated by Gapwise, never by the model. */
    candidate_ref: z.string().optional(),
    type: normalizedNodeTypeSchema,
    text: z.string().min(1),
    grounding: nodeGroundingSchema.default('SOURCE_ASSERTED'),
    extraction_basis: extractionBasisSchema.optional(),
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
  canonical_changes: z.array(canonicalChangeSchema).optional(),
}));

export type ContextAnalysis = z.infer<typeof contextAnalysisSchema>;

function candidateRef(index: number): string {
  return `new:${index}`;
}

/**
 * Positional indexes exist only at the model boundary. From this point on,
 * normalization, filtering, reconciliation, and persistence use the stable
 * identity assigned to the original extracted candidate.
 */
function attachStableCandidateIdentity(analysis: ContextAnalysis): ContextAnalysis {
  return {
    ...analysis,
    nodes: analysis.nodes.map((node, index) => ({
      ...node,
      grounding: node.extraction_basis === 'AI_DERIVED'
        ? 'AI_DERIVED'
        : node.grounding ?? 'SOURCE_ASSERTED',
      candidate_ref: node.candidate_ref ?? candidateRef(index),
    })),
    reconciliation: analysis.reconciliation.map((item) => ({
      ...item,
      candidate_ref: item.candidate_ref ?? candidateRef(item.candidate_index),
      canonical_candidate_ref: item.canonical_candidate_ref
        ?? (item.canonical_candidate_index === undefined
          ? undefined
          : candidateRef(item.canonical_candidate_index)),
    })),
  };
}

export interface AnalyzeContextInput {
  sourceId: string;
  filename: string;
  content: string;
  type: ContextSource['type'];
  storageUrl?: string;
  mimeType?: string;
  semanticRole?: IngestSourceInput['semanticRole'];
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

export function sanitizeCanonicalReconciliationTargets(
  reconciliation: ContextAnalysis['reconciliation'],
): ContextAnalysis['reconciliation'] {
  return reconciliation.map((item) => {
    if (
      item.classification === 'NEW_UNCERTAINTY'
      || item.classification === 'RELATED_BUT_DISTINCT'
      || item.classification === 'BROADER_THAN_EXISTING'
      || item.classification === 'DISTINCT'
    ) {
      return {
        ...item,
        canonical_question_id: undefined,
        canonical_node_id: undefined,
        canonical_candidate_index: undefined,
        canonical_candidate_ref: undefined,
      };
    }
    return item;
  });
}

function sanitizeModelReconciliation(analysis: ContextAnalysis): ContextAnalysis {
  return {
    ...analysis,
    reconciliation: sanitizeCanonicalReconciliationTargets(analysis.reconciliation.map((item) =>
      item.classification === 'REFINES_EXISTING' && !item.same_atomic_proposition
        ? {
          ...item,
          classification: 'DISTINCT' as const,
          canonical_question_id: undefined,
          canonical_node_id: undefined,
          canonical_candidate_index: undefined,
          canonical_candidate_ref: undefined,
          reason: `${item.reason} The candidate was preserved because it was not confirmed as the same atomic proposition.`,
        }
        : item
    )).filter((item) => {
      const node = analysis.nodes.find((candidate) => candidate.candidate_ref === item.candidate_ref);
      return Boolean(node && (
        node.type === 'UNKNOWN'
        || node.type === 'ASSUMPTION'
        || node.type === 'DECISION'
        || isRepeatableCanonicalNodeType(node.type)
      ));
    }),
  };
}

function filterAiDerivedAskNodes(
  analysis: ContextAnalysis,
  input: AnalyzeContextInput,
): ContextAnalysis {
  if (input.semanticRole !== 'ask_message') return analysis;

  // Ask operations are model-derived unless the model explicitly identifies
  // them as directly stated by the user. Keep this gate before the shared
  // ProjectPatch executor so hypothetical reasoning can only become a
  // proposal, never canonical project state.
  const keptRefs = new Set(
    analysis.nodes
      .filter((node) => node.grounding === 'SOURCE_ASSERTED')
      .map((node) => node.candidate_ref)
      .filter((ref): ref is string => Boolean(ref)),
  );
  const referenceIsKept = (ref: string): boolean => !ref.startsWith('new:') || keptRefs.has(ref);
  const retainedOperationRefs = new Set(
    analysis.operations
      .map((operation, index) => operation.grounding === 'SOURCE_ASSERTED'
        ? (operation.operationRef ?? `op:${index}`)
        : undefined)
      .filter((ref): ref is string => Boolean(ref)),
  );
  const operationReferenceIsKept = (ref: string): boolean => {
    if (ref.startsWith('op:')) return retainedOperationRefs.has(ref);
    if (ref.startsWith('new:')) return retainedOperationRefs.has(ref) || keptRefs.has(ref);
    return true;
  };

  return {
    ...analysis,
    operations: analysis.operations.filter((operation) => operation.grounding === 'SOURCE_ASSERTED'),
    nodes: analysis.nodes.filter((node) => node.grounding === 'SOURCE_ASSERTED'),
    relationships: analysis.relationships.filter((relationship) =>
      referenceIsKept(relationship.source_ref)
      && referenceIsKept(relationship.target_ref)
      && operationReferenceIsKept(relationship.source_ref)
      && operationReferenceIsKept(relationship.target_ref)
    ),
    reconciliation: analysis.reconciliation.filter((item) =>
      Boolean(item.candidate_ref && keptRefs.has(item.candidate_ref))
    ),
  };
}

/**
 * Compatibility adapter for older deterministic fixtures that still provide
 * node-shaped model output. The live Gemini schema does not expose `nodes`;
 * this adapter still funnels legacy input into the same ProjectPatch executor
 * and never persists nodes directly.
 */
function legacyNodesToOperations(analysis: ContextAnalysis): ProjectPatchOperation[] {
  const reconciliationByRef = new Map(
    analysis.reconciliation.map((item) => [item.candidate_ref, item]),
  );
  return analysis.nodes
    .filter((node) => node.grounding === 'SOURCE_ASSERTED')
    .map((node, index): ProjectPatchOperation | undefined => {
      const operationRef = node.candidate_ref ?? `new:${index}`;
      const reconciliation = reconciliationByRef.get(node.candidate_ref);
      const reusesCanonicalNode = ['PARAPHRASE', 'EQUIVALENT', 'REFINES_EXISTING', 'ASSUMPTION']
        .includes(reconciliation?.classification ?? '');
      const targetNodeId = reusesCanonicalNode
        ? reconciliation?.canonical_node_id ?? reconciliation?.canonical_question_id
        : undefined;
      const confidence = node.confidence;
      const impact = node.impact;

      if (node.type === 'DECISION') {
        if (node.status === 'RESOLVED' && targetNodeId) {
          return { op: 'RESOLVE_DECISION', targetNodeId, outcome: node.text, confidence, operationRef };
        }
        return { op: 'OPEN_DECISION', text: node.text, confidence, impact, targetNodeId, operationRef };
      }
      if (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') {
        if (node.status === 'RESOLVED' && targetNodeId) {
          return { op: 'RESOLVE_UNKNOWN', targetNodeId, answer: node.text, confidence, operationRef };
        }
        return { op: 'OPEN_UNKNOWN', text: node.text, confidence, impact, targetNodeId, operationRef };
      }
      if (node.type === 'NEXT_ACTION') {
        return { op: 'ADD_ACTION', text: node.text, confidence, impact, targetNodeId, operationRef };
      }
      if (['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'PREFERENCE', 'RISK'].includes(node.type)) {
        return {
          op: 'ADD_CONTEXT',
          nodeType: node.type,
          text: node.text,
          confidence,
          impact,
          targetNodeId,
          operationRef,
        } as ProjectPatchOperation;
      }
      return undefined;
    })
    .filter((operation): operation is ProjectPatchOperation => Boolean(operation));
}

function legacyAnalysisNodesForMetadata(analysis: ContextAnalysis): PrecomputedSourceNode[] {
  const reconciliationByRef = new Map(analysis.reconciliation.map((item) => [item.candidate_ref, item]));
  return analysis.nodes.map((node) => {
    const reconciliation = reconciliationByRef.get(node.candidate_ref);
    return {
      candidateRef: node.candidate_ref,
      type: node.type,
      text: node.text,
      grounding: node.grounding,
      confidence: node.confidence,
      impact: node.impact,
      whyItMatters: node.why_it_matters,
      status: node.status,
      questionClassification: reconciliation?.classification,
      canonicalNodeId: reconciliation?.canonical_node_id,
      canonicalQuestionId: reconciliation?.canonical_question_id,
      reconciliationConfidence: reconciliation?.confidence,
      reconciliationReason: reconciliation?.reason,
      questionAliases: node.question_aliases,
    };
  });
}

function analysisOperations(analysis: ContextAnalysis): ProjectPatchOperation[] {
  const operations = analysis.operations.length > 0
    ? analysis.operations
    : legacyNodesToOperations(analysis);
  return operations.map((operation, index) => {
    const persistableOperation = {
      ...operation,
    } as ProjectPatchOperation & { grounding?: z.infer<typeof operationGroundingSchema> };
    delete persistableOperation.grounding;
    if (persistableOperation.op === 'OPEN_UNKNOWN') {
      persistableOperation.text = persistableOperation.text
        .replace(/^Has I\b/i, 'Have I')
        .replace(/^Has we\b/i, 'Have we')
        .replace(/^Does I\b/i, 'Do I')
        .replace(/^Does we\b/i, 'Do we')
        .replace(/^Is I\b/i, 'Am I');
    }
    return {
      ...persistableOperation,
      operationRef: operation.operationRef ?? `op:${index}`,
    };
  });
}

function analysisPrompt(input: AnalyzeContextInput, project: Project): string {
  return [
    "You are Gapwise's canonical project-state interpreter.",
    'Analyze one newly supplied source against the current canonical project state and determine what changed in project reality.',
    `Project goal: ${project.goal}`,
    `New source filename: ${input.filename}`,
    `New context text or user-provided description: ${input.content.trim() || '(The source is provided as a file; inspect it.)'}`,
    ...(input.storageUrl?.startsWith('gs://') ? [
      'A private stored attachment is also provided. Inspect the attachment itself; treat the user-provided text above only as supporting context and distinguish what is present in the file from what the user added separately.',
    ] : []),
    'Return only structured JSON with summary, relevance, operations, and relationships.',
    'operations are the only representation of project mutations. Do not additionally return persistable extracted nodes for the same semantic content.',
    'Use ADD_CONTEXT for one explicit source-asserted KNOWN, EVIDENCE, CONSTRAINT, PREFERENCE, RISK, or ASSUMPTION proposition.',
    'Use OPEN_DECISION for one explicit unresolved user-controlled choice that is not already represented.',
    'Use RESOLVE_DECISION when the source clearly commits to an outcome for an existing OPEN DECISION. Keep the original decision question as the target identity and put only the chosen outcome in outcome.',
    'A completed user commitment affecting an existing OPEN DECISION is primarily a RESOLVE_DECISION operation, not a new fact or preference.',
    'Use OPEN_UNKNOWN for one missing factual question that must be learned, observed, measured, or confirmed.',
    'Use RESOLVE_UNKNOWN when the source directly supplies the missing answer to an existing OPEN UNKNOWN or ASSUMPTION.',
    'Use ADD_ACTION for one explicitly intended or committed piece of project work.',
    'Use NO_CHANGE when the source is hypothetical, analytical, conversational, or does not change project reality.',
    'Every operation must represent one atomic proposition or one state change. Do not return multiple operations that merely restate one RESOLVE_DECISION outcome.',
    'Do not turn questions into facts, hypothetical consequences into risks, recommendations into actions, preferences into decisions, decisions into preferences, or missing user-controlled choices into UNKNOWNs. A user-controlled unresolved choice is a DECISION; missing external information is an UNKNOWN.',
    'A NEXT_ACTION requires actual intended project work stated or clearly committed in the source, with explicit commitment, intention, or an unfinished committed task. A request asking Gapwise what to focus on is conversational and is not a persisted action.',
    'Questions asking Gapwise to explain, justify, compare, summarize, prioritize, or elaborate on its own recommendation do not by themselves create project state. The conversation may remain available as chat context without becoming canonical project truth.',
    'Use the current source wording and the compact project state to identify existing canonical targets. Do not invent facts, outcomes, deadlines, or commitments.',
    'Operations reference existing targetNodeId values directly. Deterministic validation will only check that referenced targets exist, are not deprecated, have compatible types, are OPEN when resolving, and that required text is present. It will not re-decide semantic meaning.',
    'For relationship source_ref and target_ref, use an existing canonical node id or the operationRef of an operation in this response (for example op:0). Never invent an id.',
    'Create only a small number of relationships directly established by this source. At least one endpoint must be new or materially changed. Do not complete the historical graph or connect nodes solely because they share a topic.',
    'Use resolves only when the source contains a completed answer, result, or outcome that already resolves the target. Use satisfies only when a NEXT_ACTION is intended to complete an existing DECISION, UNKNOWN, or ASSUMPTION; satisfies does not resolve its target. For A depends_on B, A is the dependent source and B is the prerequisite target. For B blocks A, B is the prerequisite source and A is the blocked dependent target.',
    'Use informs when one node provides information needed to answer or evaluate another, even when the information is not conclusive. Use affects when it changes direction or priority, blocks when it prevents progress, supports when evidence or a known result supports a target, and derived_from only for explicit source-derived provenance. Keep relationships sparse and decision-relevant.',
    'Repeated facts, evidence, and constraints should reuse an existing canonical node through reconciliation rather than create duplicates. Exact duplicate protection remains a persistence safeguard, not a semantic classifier.',
    ...(input.semanticRole === 'ask_message' ? [
      'Semantic source role: USER ASK MESSAGE.',
      'Treat the current user message as first-class context. Operations must represent only clear project facts, uncertainties, preferences, choices, constraints, and commitments stated by the user. Reasoning-only content must use NO_CHANGE and must not become canonical project state.',
      'For every operation, include grounding: SOURCE_ASSERTED when the user directly states, reports, confirms, rejects, or commits to the operation; use AI_DERIVED when the operation is inferred from a hypothetical, analytical, comparative, or advice-seeking part of the message. Only SOURCE_ASSERTED operations will be persisted from an Ask message.',
    ] : []),
    `Current compact project state, relevance-ranked for this source: ${serializeProcessingProjectSnapshot(project, input.content)}`,
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
  const askOperationContract = input.semanticRole === 'ask_message';
  const operationGroundingProperties = askOperationContract
    ? { grounding: { type: Type.STRING, enum: ['SOURCE_ASSERTED', 'AI_DERIVED'] } }
    : {};
  const operationRequired = (fields: string[]): string[] => askOperationContract
    ? [...fields, 'grounding']
    : fields;
  const parts: Array<Record<string, unknown>> = [];
  if (input.storageUrl?.startsWith('gs://') && ['pdf', 'image', 'voice'].includes(input.type)) {
    parts.push({
      fileData: {
        fileUri: input.storageUrl,
        mimeType: input.mimeType || defaultMimeTypeForSourceType(input.type),
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
        required: ['summary', 'relevance', 'operations', 'relationships'],
        properties: {
          summary: { type: Type.STRING },
          relevance: { type: Type.STRING, enum: ['relevant', 'possibly_not_relevant'] },
          operations: {
            type: Type.ARRAY,
            items: {
              anyOf: [
                {
                  type: Type.OBJECT,
                  required: operationRequired(['op', 'nodeType', 'text', 'confidence', 'impact']),
                  properties: {
                    op: { type: Type.STRING, enum: ['ADD_CONTEXT'] },
                    nodeType: { type: Type.STRING, enum: ['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'PREFERENCE', 'RISK', 'ASSUMPTION'] },
                    text: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    impact: { type: Type.NUMBER },
                    ...operationGroundingProperties,
                  },
                },
                {
                  type: Type.OBJECT,
                  required: operationRequired(['op', 'text', 'confidence', 'impact']),
                  properties: {
                    op: { type: Type.STRING, enum: ['OPEN_DECISION', 'OPEN_UNKNOWN', 'ADD_ACTION'] },
                    text: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    impact: { type: Type.NUMBER },
                    ...operationGroundingProperties,
                  },
                },
                {
                  type: Type.OBJECT,
                  required: operationRequired(['op', 'targetNodeId', 'outcome', 'confidence']),
                  properties: {
                    op: { type: Type.STRING, enum: ['RESOLVE_DECISION'] },
                    targetNodeId: { type: Type.STRING },
                    outcome: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    ...operationGroundingProperties,
                  },
                },
                {
                  type: Type.OBJECT,
                  required: operationRequired(['op', 'targetNodeId', 'answer', 'confidence']),
                  properties: {
                    op: { type: Type.STRING, enum: ['RESOLVE_UNKNOWN'] },
                    targetNodeId: { type: Type.STRING },
                    answer: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    ...operationGroundingProperties,
                  },
                },
                {
                  type: Type.OBJECT,
                  required: operationRequired(['op']),
                  properties: {
                    op: { type: Type.STRING, enum: ['NO_CHANGE'] },
                    confidence: { type: Type.NUMBER },
                    ...operationGroundingProperties,
                  },
                },
              ],
            },
          },
          relationships: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['source_ref', 'target_ref', 'type', 'confidence'],
              properties: {
                source_ref: { type: Type.STRING },
                target_ref: { type: Type.STRING },
                type: { type: Type.STRING, enum: relationshipSchema.options },
                confidence: { type: Type.NUMBER },
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
    analysis = filterAiDerivedAskNodes(
      sanitizeModelReconciliation(attachStableCandidateIdentity(
        validateStructuredOutput(contextAnalysisSchema, parsedResponse),
      )),
      input,
    );
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

function successfulSource(
  source: ContextSource,
  extractionHash: string,
  attachmentHash?: string,
  hasSupportingText = false,
): boolean {
  if (source.processing_status !== 'completed') return false;
  if (attachmentHash && source.hash !== attachmentHash) return false;
  if (source.extraction_hash === extractionHash) return true;
  // Before attachment support was added, media sources used the byte hash as
  // both the source and extraction hash. Preserve that compatibility only for
  // requests without supporting text.
  return Boolean(attachmentHash && !hasSupportingText && source.extraction_hash === attachmentHash);
}

function isRepeatableCanonicalNodeType(type: ClarityNode['type']): boolean {
  return type === 'KNOWN' || type === 'EVIDENCE' || type === 'CONSTRAINT';
}

function analysisRelationshipsToPrecomputedRelationships(analysis: ContextAnalysis): PrecomputedRelationship[] {
  return analysis.relationships
    .map((relationship) => ({
    sourceRef: relationship.source_ref,
    targetRef: relationship.target_ref,
    type: relationship.type,
    confidence: relationship.confidence,
    }));
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
      size_bytes: input.sizeBytes,
      content: input.content,
      storage_url: input.storageUrl,
      hash,
      media_part_included: Boolean(
        input.storageUrl?.startsWith('gs://')
        && ['pdf', 'image', 'voice'].includes(input.type),
      ),
      project_snapshot: serializeProcessingProjectSnapshot(project),
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
  const existing = project.sources.find((source) => successfulSource(
    source,
    hash,
    input.attachmentHash,
    Boolean(input.content.trim()),
  ));
  if (existing && !options.forceReprocess) {
    return { project, skipped: true, modelUsed: existing.model_used };
  }

  if (isDemoMode()) {
    const demoDerivedNodes = input.derivedNodes
      ?? (input.semanticRole === 'ask_message' ? [] : undefined);
    appendProcessingStage(processingLog, {
      name: 'Deterministic demo extraction',
      status: 'completed',
      input: {
        demo_mode: true,
        source_type: input.type,
      },
      output: {
        model_used: input.modelUsed ?? 'deterministic-demo',
        supplied_nodes: demoDerivedNodes ?? 'fallbackNodesForSource(content)',
      },
      duration_ms: Date.now() - processStarted,
    });
    completeProcessingLog(processingLog, 'completed');
    let updated = await ingestContextSource(project, {
      ...input,
      hash,
      attachmentHash: input.attachmentHash,
      extractionHash: hash,
      processingStatus: input.processingStatus ?? 'completed',
      relevance: input.relevance ?? 'relevant',
      ...(demoDerivedNodes !== undefined ? { derivedNodes: demoDerivedNodes } : {}),
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
      semanticRole: input.semanticRole,
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
    // The model's operations are the semantic authority. From this point on,
    // deterministic code only assigns stable operation references; it does
    // not reinterpret the source or rewrite operation meaning.
    const operations = analysisOperations(rawAnalysis);
    appendProcessingStage(processingLog, {
      name: 'ProjectPatch operation validation',
      status: 'completed',
      input: { model_operations: rawAnalysis.operations },
      output: { normalized_operations: operations },
    });
    const analysis = rawAnalysis;
    appendProcessingStage(processingLog, {
      name: 'Canonical interpretation validation',
      status: 'completed',
      input: { validated_analysis: analysis },
      output: {
        model_operations: operations,
      },
    });
    appendProcessingStage(processingLog, {
      name: 'Graph persistence',
      status: 'completed',
      input: {
        extraction_summary: analysis.summary,
        relevance: analysis.relevance,
        operations,
        relationships: analysisRelationshipsToPrecomputedRelationships(analysis),
      },
      output: {
        operation_count: operations.length,
        relationship_count: analysis.relationships.length,
      },
    });
    completeProcessingLog(processingLog, 'completed');
    let updated = await ingestContextSource(project, {
      ...input,
      hash,
      attachmentHash: input.attachmentHash,
      extractionHash: hash,
      processingStatus: 'completed',
      extractionSummary: analysis.summary,
      modelUsed,
      reconciliationSummary: input.reconciliationSummary,
      relevance: analysis.relevance,
      operations,
      ...(rawAnalysis.operations.length === 0
        ? { derivedNodes: legacyAnalysisNodesForMetadata(analysis) }
        : {}),
      relationships: analysisRelationshipsToPrecomputedRelationships(analysis),
      deferHistory: true,
      processingLog,
    }, profile);
    const persistedSource = updated.sources.find((source) => source.id === input.sourceId);
    const relationshipChangedNodeIds = changedProjectNodeIds(project, updated);
    const relationshipCompletion = await completeProjectRelationships({
      projectBefore: project,
      projectAfter: updated,
      changedNodeIds: relationshipChangedNodeIds,
      source: {
        id: persistedSource?.id ?? input.sourceId ?? 'new-source',
        filename: input.filename,
        content: input.content,
      },
      genAI: options.genAI,
      model: options.model,
    });
    updated = relationshipCompletion.project;
    retireExplicitlyDisprovedRisks(updated);
    const completedActionIds = resolveSatisfiedNextActions(updated, new Date().toISOString());
    const historyEventCountBeforeContext = project.historyEvents?.length ?? 0;
    updated = appendContextAddedHistory(project, updated, {
      sourceId: input.sourceId ?? 'new-source',
      filename: input.filename,
      createdAt: new Date().toISOString(),
    });
    const sourceAfterContext = updated.sources.find((source) => source.id === input.sourceId);
    const contextHistoryAdded = (updated.historyEvents?.length ?? 0) > historyEventCountBeforeContext;
    if (sourceAfterContext && !contextHistoryAdded && completedActionIds.length === 0) {
      sourceAfterContext.semantic_contribution = false;
    }
    if (completedActionIds.length > 0) {
      appendNextActionCompletionHistory(updated, completedActionIds, new Date().toISOString());
    }
    if (processingLog) {
      const sourceWithLog = updated.sources.find((source) => source.id === input.sourceId);
      if (sourceWithLog) sourceWithLog.processing_log = processingLog;
      processingLog.stages.push({
        name: 'Relationship completion',
        status: relationshipCompletion.trace.error ? 'failed' : 'completed',
        started_at: new Date().toISOString(),
        duration_ms: 0,
        input: {
          changed_node_ids: relationshipChangedNodeIds,
        },
        output: relationshipCompletion.trace,
        ...(relationshipCompletion.trace.error ? { error: relationshipCompletion.trace.error } : {}),
      });
    }
    updated.clarity_score = calculateClarityScore(projectForReasoning(updated));
    updated.active_question = selectTopGap(projectForReasoning(updated), profile);
    updated.updated_at = new Date().toISOString();
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
      semanticRole: input.semanticRole,
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
    appendProcessingStage(processingLog, {
      name: 'Canonical interpretation unavailable',
      status: 'skipped',
      input: { content: input.content },
      output: { operations: [], retryable: true },
    });
    completeProcessingLog(processingLog, 'failed', message);
    const failed = await ingestContextSource(project, {
      ...input,
      hash,
      attachmentHash: input.attachmentHash,
      processingStatus: 'failed',
      errorMessage: message,
      extractionHash: undefined,
      derivedNodes: [],
      operations: [],
      processingLog,
    }, profile);
    return { project: failed, skipped: false, error: message };
  }
}
