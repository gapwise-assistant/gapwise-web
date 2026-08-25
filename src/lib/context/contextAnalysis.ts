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
import {
  canonicalOpenQuestions,
} from '@/lib/questions/canonical';
import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';

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

const projectPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('ADD_CONTEXT'),
    nodeType: patchContextNodeTypeSchema,
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1),
    operationRef: z.string().optional(),
    targetNodeId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('OPEN_DECISION'),
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1),
    operationRef: z.string().optional(),
    targetNodeId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('RESOLVE_DECISION'),
    targetNodeId: z.string().min(1),
    outcome: z.string().min(1),
    confidence: z.number().min(0).max(1),
    operationRef: z.string().optional(),
  }),
  z.object({
    op: z.literal('OPEN_UNKNOWN'),
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1),
    operationRef: z.string().optional(),
    targetNodeId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('RESOLVE_UNKNOWN'),
    targetNodeId: z.string().min(1),
    answer: z.string().min(1),
    confidence: z.number().min(0).max(1),
    operationRef: z.string().optional(),
  }),
  z.object({
    op: z.literal('ADD_ACTION'),
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
    impact: z.number().min(0).max(1),
    operationRef: z.string().optional(),
    targetNodeId: z.string().optional(),
    nodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('NO_CHANGE'),
    confidence: z.number().min(0).max(1).optional(),
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

  const keptRefs = new Set(
    analysis.nodes
      .filter((node) => node.grounding === 'SOURCE_ASSERTED')
      .map((node) => node.candidate_ref)
      .filter((ref): ref is string => Boolean(ref)),
  );
  const referenceIsKept = (ref: string): boolean => !ref.startsWith('new:') || keptRefs.has(ref);

  return {
    ...analysis,
    nodes: analysis.nodes.filter((node) => node.grounding === 'SOURCE_ASSERTED'),
    relationships: analysis.relationships.filter((relationship) =>
      referenceIsKept(relationship.source_ref) && referenceIsKept(relationship.target_ref)
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
      const targetNodeId = reconciliation?.canonical_node_id ?? reconciliation?.canonical_question_id;
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

function analysisOperations(analysis: ContextAnalysis): ProjectPatchOperation[] {
  const operations = analysis.operations.length > 0
    ? analysis.operations
    : legacyNodesToOperations(analysis);
  return operations.map((operation, index) => ({
    ...operation,
    operationRef: operation.operationRef ?? `op:${index}`,
  }));
}

function compactNode(node: ClarityNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    text: node.text,
    status: node.status,
    confidence: node.confidence,
    impact: node.impact,
    canonical_node_id: node.canonical_node_id,
    canonical_question_id: node.canonical_question_id,
    why_it_matters: node.why_it_matters?.slice(0, 2) ?? [],
  };
}

function projectSnapshot(project: Project, query = ''): string {
  const structuralTypes = new Set<ClarityNode['type']>([
    'GOAL',
    'UNKNOWN',
    'ASSUMPTION',
    'DECISION',
    'CONSTRAINT',
    'RISK',
    'NEXT_ACTION',
  ]);
  const contextualTypes = new Set<ClarityNode['type']>([
    'KNOWN',
    'EVIDENCE',
    'PREFERENCE',
  ]);
  const candidateTypes = new Set([
    ...structuralTypes,
    ...contextualTypes,
  ]);
  const queryTokens = meaningfulTokens(query);
  const relevanceFor = (node: ClarityNode): number => {
    if (!queryTokens.size) return node.impact * node.confidence;
    const nodeTokens = meaningfulTokens(`${node.text} ${node.why_it_matters?.join(' ') ?? ''}`);
    return [...nodeTokens].filter((token) => queryTokens.has(token)).length;
  };
  const validNodes = project.nodes
    .filter((node) => node.status !== 'DEPRECATED' && candidateTypes.has(node.type));
  const rankedStructural = validNodes
    .filter((node) => structuralTypes.has(node.type))
    .sort((left, right) =>
      relevanceFor(right) - relevanceFor(left)
      || (right.impact * right.confidence) - (left.impact * left.confidence)
      || right.updated_at.localeCompare(left.updated_at)
    );
  const rankedContextual = validNodes
    .filter((node) => contextualTypes.has(node.type))
    .sort((left, right) =>
      relevanceFor(right) - relevanceFor(left)
      || (right.impact * right.confidence) - (left.impact * left.confidence)
      || right.updated_at.localeCompare(left.updated_at)
    );
  const selectedNodes: ClarityNode[] = [];
  const addSelected = (node: ClarityNode | undefined): void => {
    if (!node || selectedNodes.some((candidate) => candidate.id === node.id)) return;
    selectedNodes.push(node);
  };
  // Keep structural gaps and decisions represented, then add relevant facts,
  // evidence, and preferences. The final cap keeps the model input bounded
  // without systematically excluding context that explains a later decision.
  rankedStructural.slice(0, 10).forEach(addSelected);
  rankedStructural
    .filter((node) => node.status === 'OPEN')
    .slice(0, 8)
    .forEach(addSelected);
  rankedStructural
    .filter((node) => node.type === 'GOAL' || node.type === 'DECISION')
    .slice(0, 5)
    .forEach(addSelected);
  rankedContextual.slice(0, 8).forEach(addSelected);

  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  project.edges
    .filter((edge) => selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target))
    .map((edge) => project.nodes.find((node) => node.id === (selectedNodeIds.has(edge.source) ? edge.target : edge.source)))
    .filter((node): node is ClarityNode => node !== undefined && node.status !== 'DEPRECATED' && candidateTypes.has(node.type))
    .sort((left, right) => relevanceFor(right) - relevanceFor(left) || (right.impact * right.confidence) - (left.impact * left.confidence))
    .forEach(addSelected);

  const importantGraphNodes = selectedNodes.slice(0, 24);
  const importantNodes = importantGraphNodes.map(compactNode);
  const importantNodeIds = new Set(importantGraphNodes.map((node) => node.id));
  const edges = project.edges
    .filter((edge) => importantNodeIds.has(edge.source) && importantNodeIds.has(edge.target))
    .slice(0, 24)
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
    "You are Gapwise's canonical project-state interpreter.",
    'Analyze one newly supplied source against the current canonical project state and determine what changed in project reality.',
    `Project goal: ${project.goal}`,
    `New source filename: ${input.filename}`,
    `New context text or user-provided description: ${input.content.trim() || '(The source is provided as a file; inspect it.)'}`,
    'Return only structured JSON with summary, relevance, operations, and relationships.',
    'operations are the only representation of project mutations. Do not additionally return persistable extracted nodes for the same semantic content.',
    'Use ADD_CONTEXT for one explicit source-asserted KNOWN, EVIDENCE, CONSTRAINT, PREFERENCE, RISK, or ASSUMPTION proposition.',
    'Use OPEN_DECISION for one explicit unresolved user-controlled choice that is not already represented.',
    'Use RESOLVE_DECISION when the source clearly commits to an outcome for an existing OPEN DECISION. Keep the original decision question as the target identity and put only the chosen outcome in outcome.',
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
    ] : []),
    `Current compact project state, relevance-ranked for this source: ${projectSnapshot(project, input.content)}`,
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
        required: ['summary', 'relevance', 'operations', 'relationships'],
        properties: {
          summary: { type: Type.STRING },
          relevance: { type: Type.STRING, enum: ['relevant', 'possibly_not_relevant'] },
          operations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['op', 'confidence'],
              properties: {
                op: { type: Type.STRING, enum: ['ADD_CONTEXT', 'OPEN_DECISION', 'RESOLVE_DECISION', 'OPEN_UNKNOWN', 'RESOLVE_UNKNOWN', 'ADD_ACTION', 'NO_CHANGE'] },
                nodeType: { type: Type.STRING, enum: ['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'PREFERENCE', 'RISK', 'ASSUMPTION'] },
                targetNodeId: { type: Type.STRING },
                outcome: { type: Type.STRING },
                text: { type: Type.STRING },
                answer: { type: Type.STRING },
                impact: { type: Type.NUMBER },
                confidence: { type: Type.NUMBER },
              },
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

function successfulSource(source: ContextSource, hash: string): boolean {
  return source.hash === hash && source.extraction_hash === hash && source.processing_status === 'completed';
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

// Used only to keep the model input bounded and relevant. This does not
// classify, merge, or discard extracted project propositions.
function meaningfulTokens(value: string): Set<string> {
  const ignored = new Set(['what', 'where', 'when', 'which', 'who', 'how', 'why', 'does', 'could', 'would', 'should', 'are', 'the', 'and', 'for', 'from', 'with', 'this', 'that', 'about', 'into', 'your', 'you', 'can', 'will', 'have', 'need', 'know']);
  return new Set(
    value.toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length >= 4 && !ignored.has(token))
  );
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
      extractionHash: hash,
      processingStatus: 'completed',
      extractionSummary: analysis.summary,
      modelUsed,
      reconciliationSummary: input.reconciliationSummary,
      relevance: analysis.relevance,
      operations,
      relationships: analysisRelationshipsToPrecomputedRelationships(analysis),
      processingLog,
    }, profile);
    if (processingLog) {
      const persistedSource = updated.sources.find((source) => source.id === input.sourceId);
      if (persistedSource) persistedSource.processing_log = processingLog;
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
