import { Type } from '@google/genai';
import { z } from 'zod';
import { ClarityNode, ContextProcessingLog, ContextProcessingLogStage, ContextSource, EdgeType, Project, QuestionReconciliationSummary, UserMemoryProfile } from '@/types/clarity';
import { nodeTypeSchema, validateStructuredOutput } from '@/lib/agents/schemas';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { StorageError } from '@/lib/storage/types';
import { assertExternalServicesAllowed, isDemoMode } from '@/lib/runtime/demoMode';
import { matchesExplicitDecisionTitle } from '@/lib/decisions/anchoring';
import {
  hashText,
  extractDeterministicFallbackNodes,
  ingestContextSource,
  IngestSourceInput,
  PrecomputedRelationship,
  PrecomputedSourceNode,
} from '@/lib/context/ingestion';
import { projectForReasoning } from '@/lib/context/sourceState';
import {
  canonicalOpenQuestions,
  canonicalQuestionGroups,
  reconcileQuestionCandidates,
  semanticallyEquivalentQuestion,
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

const RECONCILIATION_CAN_USE_CANONICAL_TARGET = new Set([
  'PARAPHRASE',
  'SUBQUESTION',
  'ASSUMPTION',
  'SUPPORTING_EVIDENCE',
  'NEXT_ACTION',
  'ALREADY_ANSWERED',
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
  'satisfies',
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

export function sanitizeCanonicalReconciliationTargets(
  reconciliation: ContextAnalysis['reconciliation'],
): ContextAnalysis['reconciliation'] {
  return reconciliation.map((item) => {
    if (item.classification === 'NEW_UNCERTAINTY' || item.classification === 'RELATED_BUT_DISTINCT') {
      return {
        ...item,
        canonical_question_id: undefined,
        canonical_candidate_index: undefined,
      };
    }
    return item;
  });
}

function sanitizeModelReconciliation(analysis: ContextAnalysis): ContextAnalysis {
  return {
    ...analysis,
    reconciliation: sanitizeCanonicalReconciliationTargets(analysis.reconciliation).filter((item) => {
      const node = analysis.nodes[item.candidate_index];
      return Boolean(node && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION'));
    }),
  };
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
    'Return only structured JSON.',
    'Build a concise project understanding from the supplied source. Extract only materially useful facts, goals, constraints, decisions, preferences, evidence, risks, experiments, unknowns, and next actions.',
    'Distinguish project content from conversational or meta-level requests directed at Gapwise. Questions asking Gapwise to explain, justify, compare, summarize, prioritize, or elaborate on its own recommendation do not by themselves create project facts, decisions, unknowns, risks, or actions. Only extract a project node when the message introduces, changes, confirms, rejects, or reveals information about the underlying project. The conversation itself may remain available as chat context without becoming canonical project state.',
    'Treat the source as one semantic document rather than one node per sentence. Consolidate repeated statements about the same underlying concept, but keep distinct project concepts as separate nodes. Every node must be atomic: it should represent one fact, constraint, preference, risk, decision, unknown, or action that can change independently. Do not combine multiple independent requirements, rules, facts, or risks into one node merely because they appear near each other in the source. Never return two nodes representing the same underlying project concept.',
    'Example: "Capacity is 24 people and one supervisor is required per 12 participants" should become two nodes because capacity and supervision are separate constraints.',
    'Example: "Safety glasses are required for groups over 10, drinks must stay away from workbenches, and cancellations within 72 hours lose 50% of the fee" should become three separate nodes.',
    'For DECISION nodes, use status OPEN only for an explicitly pending, unresolved, conditional, or not-yet-chosen choice. Use RESOLVED only when a choice is already recorded. Never infer an open decision from a generic task or plan. If the source states the same decision multiple times, return exactly one DECISION node.',
    'Explicit unresolved choice language such as needing to decide, choose, determine, select, or settle something represents an OPEN DECISION.',
    'Do not classify the subject of an explicit unresolved choice as a PREFERENCE merely because the source also contains preferences, constraints, or supporting evidence.',
    'A PREFERENCE expresses what the user favors; a DECISION represents a choice the user still needs to make.',
    'Do not infer a DECISION merely because one option becomes attractive, available, cheaper, safer, or preferred. Create a DECISION only when the user explicitly states that a choice was made or the source clearly communicates commitment to one option. A preference or evidence supporting one option leaves an existing decision OPEN. For example, "I have access to a free courtyard and would rather avoid paying" is KNOWN/PREFERENCE, while "We\'ll use the courtyard for the first event" is a DECISION. "I\'m leaning toward the courtyard" is PREFERENCE or supporting evidence, not a committed DECISION.',
    'Do not infer that an option has been chosen merely because the user describes it positively, prefers it, or provides supporting evidence. A DECISION requires clear language indicating commitment or a completed choice. Preserve uncertainty in the source wording.',
    'Create UNKNOWN nodes only for missing factual information that must be learned, observed, measured, or confirmed. Do not create an UNKNOWN from a question whose answer is an explanation or judgment from Gapwise rather than missing information about the external project. Do not use UNKNOWN for a user-controlled choice between alternatives. If the user is deciding what to choose, whether to do something, how often to do it, which option to use, or what policy to adopt, create an OPEN DECISION instead. External confirmations, approvals, requirements, statuses, availability, or results may be UNKNOWNs when material.',
    'A statement that the user has not completed a user-controlled action already tells us the current state. Do not convert it into an UNKNOWN asking whether the action was completed. Preserve the absence or unfinished state as EVIDENCE, KNOWN, or RISK when useful, and add a NEXT_ACTION when completing the work materially advances the project.',
    'If the source says "I have not created a backup plan", do not ask whether a backup plan exists. Represent the missing contingency as a RISK or EVIDENCE and, when useful, add a NEXT_ACTION to create the backup plan. Create an UNKNOWN only if genuinely missing external information remains, such as which alternative venue is available.',
    'For external pending statements such as "approval is pending", "the manager has not confirmed the time", or "the supplier has not confirmed availability", create one concise evidence-seeking UNKNOWN when the missing confirmation materially affects the project.',
    'Every UNKNOWN must contain a complete, explicit subject and object. Avoid vague wording such as "Have they confirmed yet?" when the source names the object.',
    'A user-controlled unresolved choice is always a DECISION, not an UNKNOWN. This includes choices expressed as questions such as "how often should we meet?", "should members pay?", "which venue should we use?", or "should we launch now?". Do not create an UNKNOWN merely because the choice is phrased as a question. Do not create an UNKNOWN that merely restates an OPEN DECISION. UNKNOWN is only for missing factual information that can inform a decision. Example: "I am unsure whether to use a café or community room" → DECISION. Example: "I am not sure how often the club should meet" → DECISION: Choose the meeting frequency. Example: "I do not know whether members should pay" → DECISION: Determine whether members should pay. Example: "I do not know whether the workshop is available every other Thursday" → UNKNOWN: Confirm biweekly workshop availability.',
    'Prefer distinct high-value concepts over repeated or low-value factual details when selecting up to 12 nodes: open decisions, material unknowns/blockers, risks, constraints/preferences, next actions, then supporting facts/evidence.',
    'Merge semantically repeated questions with existing canonical project questions when appropriate. Do not merge questions merely because they mention the same noun. Compare the answer required and the downstream action that would change.',
    'For every returned UNKNOWN or ASSUMPTION node, classify its relationship to canonical_questions and other question-like nodes returned in this response. Only UNKNOWN and ASSUMPTION nodes may appear in reconciliation. Never return reconciliation entries for DECISION, RISK, KNOWN, EVIDENCE, NEXT_ACTION, PREFERENCE, CONSTRAINT, or GOAL.',
    'Use PARAPHRASE, SUBQUESTION, ASSUMPTION, SUPPORTING_EVIDENCE, NEXT_ACTION, ALREADY_ANSWERED, NEW_UNCERTAINTY, or RELATED_BUT_DISTINCT as appropriate. Set canonical_question_id or canonical_candidate_index only when the classification is PARAPHRASE, SUBQUESTION, ASSUMPTION, SUPPORTING_EVIDENCE, NEXT_ACTION, or ALREADY_ANSWERED. NEW_UNCERTAINTY represents a new canonical question and must never reference an existing canonical question or candidate. RELATED_BUT_DISTINCT may be related semantically but must also leave canonical_question_id and canonical_candidate_index unset. Never point forward.',
    'Classify whether this source appears relevant to the current project as relevant or possibly_not_relevant. This classification is advisory and must never delete supplied evidence.',
    'When a new node materially changes the understanding of another new or existing node, include the appropriate relationship. Its source_node_index is the zero-based index of a returned node, and target_node_id is an existing node id from the compact project state or new:<index> for another returned node.',
    'Pay particular attention to relationships that explain what information, constraints, risks, or evidence materially influence an OPEN DECISION.',
    'Use resolves only when the source contains a completed answer, result, or outcome that already resolves the target.',
    'Use satisfies when a NEXT_ACTION is specifically intended to complete, settle, or answer an existing DECISION, UNKNOWN, or ASSUMPTION.',
    'A satisfies relationship describes intended work and must not imply that the target is already resolved.',
    'Use depends_on only when the source genuinely cannot proceed until the target is satisfied. For A depends_on B, A is the dependent source and B is the prerequisite target.',
    'For B blocks A, B is the prerequisite source and A is the blocked dependent target.',
    'Use informs or affects when information changes priority or direction but does not prevent the target from proceeding.',
    'Allowed relationship types are supports, contradicts, supersedes, resolves, satisfies, depends_on, blocks, affects, informs, and derived_from. Prefer a sparse, decision-relevant graph: connect material dependencies and influences, but do not create speculative relationships or relationships based only on shared topic.',
    'Preserve history. New information may contradict, supersede, resolve, or affect existing understanding, but never delete historical nodes.',
    'Return at most 12 distinct nodes. Each node must represent exactly one useful project concept. Prefer preserving separate high-impact concepts over compressing unrelated information into fewer nodes. Never include private reasoning.',
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
    analysis = sanitizeModelReconciliation(
      validateStructuredOutput(contextAnalysisSchema, parsedResponse),
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
    const isQuestion = node.type === 'UNKNOWN' || node.type === 'ASSUMPTION';
    const modelReconciliationRaw = isQuestion
      ? analysis.reconciliation.find((candidate) => candidate.candidate_index === index)
      : undefined;
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
    const canUseCanonicalTarget = Boolean(modelReconciliation)
      && RECONCILIATION_CAN_USE_CANONICAL_TARGET.has(modelReconciliation.classification);
    const modelCandidateTarget = modelReconciliation?.canonicalCandidateIndex;
    const validModelCandidateTarget = canUseCanonicalTarget
      && modelCandidateTarget !== undefined
      && modelCandidateTarget < index
      && modelCandidateTarget >= 0
      && (analysis.nodes[modelCandidateTarget]?.type === 'UNKNOWN' || analysis.nodes[modelCandidateTarget]?.type === 'ASSUMPTION')
      ? modelCandidateTarget
      : undefined;
    const validModelExistingTarget = canUseCanonicalTarget
      && modelReconciliation?.canonicalQuestionId
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

function normalizedSemanticText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nodeIsQuestionLike(
  node: ContextAnalysis['nodes'][number],
): boolean {
  return node.type === 'UNKNOWN' || node.type === 'ASSUMPTION';
}

function conceptTokens(value: string): Set<string> {
  const ignored = new Set([
    'what', 'where', 'when', 'which', 'who', 'how', 'why', 'does', 'could',
    'would', 'should', 'have', 'has', 'had', 'need', 'needs', 'decide',
    'whether', 'about', 'into', 'from', 'with', 'that', 'this', 'there',
    'their', 'they', 'them', 'your', 'you', 'our', 'ours', 'can', 'will',
    'the', 'and', 'for', 'are',
  ]);
  const normalizeToken = (token: string): string => {
    if (token.length > 6 && token.endsWith('ing')) return token.slice(0, -3);
    if (token.length > 5 && token.endsWith('ed')) return token.slice(0, -2);
    if (token.length > 5 && token.endsWith('s')) return token.slice(0, -1);
    return token;
  };
  return new Set(normalizedSemanticText(value)
    .split(' ')
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !ignored.has(token)));
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = conceptTokens(left);
  const rightTokens = conceptTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? shared / union : 0;
}

function semanticallyEquivalentModelNode(
  left: ContextAnalysis['nodes'][number],
  right: ContextAnalysis['nodes'][number],
): boolean {
  if (left.type !== right.type) return false;
  if (normalizedSemanticText(left.text) === normalizedSemanticText(right.text)) return true;
  if (nodeIsQuestionLike(left) && nodeIsQuestionLike(right)) {
    return semanticallyEquivalentQuestion(left.text, right.text);
  }
  const similarity = tokenSimilarity(left.text, right.text);
  switch (left.type) {
    case 'DECISION': return similarity >= 0.5;
    case 'NEXT_ACTION': return similarity >= 0.68;
    case 'RISK':
    case 'CONSTRAINT':
    case 'PREFERENCE': return similarity >= 0.72;
    case 'KNOWN':
    case 'EVIDENCE': return similarity >= 0.82;
    default: return similarity >= 0.8;
  }
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
      if (targetIndex === sourceNodeIndex) return [];
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
    if (canonicalCandidateIndex === candidateIndex) {
      return [{
        ...candidate,
        candidate_index: candidateIndex,
        canonical_candidate_index: undefined,
        classification: candidate.classification === 'PARAPHRASE'
          ? 'NEW_UNCERTAINTY'
          : candidate.classification,
      }];
    }
    return [{
      ...candidate,
      candidate_index: candidateIndex,
      canonical_candidate_index: canonicalCandidateIndex,
    }];
  });
  return {
    ...analysis,
    nodes,
    relationships,
    reconciliation: sanitizeCanonicalReconciliationTargets(reconciliation),
  };
}

function semanticallyRepresentsSameChoice(question: string, decision: string): boolean {
  return semanticallyEquivalentQuestion(question, decision);
}

function sourceHasDecisionCommitment(content: string): boolean {
  return /\b(?:i|we)\s+(?:will|shall|am going to|are going to|have chosen|has chosen|chose|decided to|decided on|selected|picked|am using|are using|am going with|are going with)\b/i.test(content)
    || /\b(?:i|we)['’](?:ll|m|re)\s+(?:use|using|go with|going to)\b/i.test(content)
    || /\b(?:the team|the group|the organizers?|the project)\s+(?:will|has chosen|chose|decided|selected|picked|is using|are using)\b/i.test(content)
    || /\b(?:has|have|was|were|is|are)\s+(?:been\s+)?(?:chosen|selected|picked|approved|committed)\b/i.test(content);
}

function sourceHasUnresolvedChoice(content: string, nodeText: string): boolean {
  return matchesExplicitDecisionTitle(nodeText, content)
    || /\b(?:not sure|unsure|uncertain|undecided)\b.{0,80}\b(?:whether|if|between|choice|option)\b/i.test(content)
    || /\b(?:before|until)\s+(?:(?:i|we)\s+)?(?:decid|choos|select|pick|commit)/i.test(content)
    || /\b(?:(?:i|we)\s+)?(?:still\s+)?need(?:ing)?\s+to\s+(?:decid|choos|determin|select|settl|pick|commit)/i.test(content)
    || /\b(?:have not|haven['’]?t|not yet)\s+(?:decid|choos|determin|select|settl|pick|commit)/i.test(content);
}

/**
 * Finalize a successful Gemini extraction. Gemini is the primary extractor;
 * deterministic extraction is reserved for the model-unavailable path.
 */
function finalizeQuestionCandidates(
  analysis: ContextAnalysis,
  input: AnalyzeContextInput,
  trace?: Record<string, unknown>,
): ContextAnalysis {
  type FinalizedCandidate = {
    node: ContextAnalysis['nodes'][number];
    originalIndices: number[];
  };

  const normalizeNode = (node: ContextAnalysis['nodes'][number]) => {
    if (node.type === 'DECISION'
      && !sourceHasDecisionCommitment(input.content)
      && !sourceHasUnresolvedChoice(input.content, node.text)) {
      return {
        ...node,
        type: 'PREFERENCE' as const,
        status: undefined,
      };
    }
    if (!nodeIsQuestionLike(node)) return node;
    return {
      ...node,
      text: normalizePersonalQuestion(node.text, input.content),
      question_aliases: (node.question_aliases ?? []).map((alias) =>
        normalizePersonalQuestion(alias, input.content)
      ),
    };
  };

  const normalizedNodes = analysis.nodes.map(normalizeNode);
  const finalized: FinalizedCandidate[] = [];
  const indexMap = new Map<number, number>();
  const representativeOriginalIndices = new Set<number>();

  normalizedNodes.forEach((node, originalIndex) => {
    const existingIndex = finalized.findIndex((candidate) =>
      semanticallyEquivalentModelNode(candidate.node, node)
    );
    if (existingIndex < 0) {
      const newIndex = finalized.length;
      finalized.push({ node, originalIndices: [originalIndex] });
      indexMap.set(originalIndex, newIndex);
      representativeOriginalIndices.add(originalIndex);
      return;
    }

    const existing = finalized[existingIndex];
    indexMap.set(originalIndex, existingIndex);
    const aliases = nodeIsQuestionLike(existing.node)
      ? Array.from(new Set([
          ...(existing.node.question_aliases ?? []),
          ...(node.question_aliases ?? []),
          node.text,
        ])).filter((alias) => alias.trim() && alias !== existing.node.text)
      : existing.node.question_aliases;
    finalized[existingIndex] = {
      node: {
        ...existing.node,
        confidence: Math.max(existing.node.confidence, node.confidence),
        impact: Math.max(existing.node.impact, node.impact),
        why_it_matters: Array.from(new Set([
          ...existing.node.why_it_matters,
          ...node.why_it_matters,
        ])),
        question_aliases: aliases,
        related_node_ids: Array.from(new Set([
          ...existing.node.related_node_ids,
          ...node.related_node_ids,
        ])),
      },
      originalIndices: [...existing.originalIndices, originalIndex],
    };
  });

  const canonicalReconciliation = analysis.reconciliation.filter((item) =>
    representativeOriginalIndices.has(item.candidate_index)
  );
  const deduplicatedNodes = finalized;
  const finalizedNodes = deduplicatedNodes.filter(({ node }) => {
    if (node.type !== 'UNKNOWN') return true;

    const duplicatesOpenDecision = deduplicatedNodes.some(({ node: other }) => {
      if (other.type !== 'DECISION' || other.status !== 'OPEN') return false;
      return semanticallyRepresentsSameChoice(node.text, other.text);
    });

    return !duplicatesOpenDecision;
  });
  const retainedIndexByDeduplicatedIndex = new Map(
    finalizedNodes.map((candidate, index) => [deduplicatedNodes.indexOf(candidate), index]),
  );
  const filteredIndexMap = new Map<number, number>();
  indexMap.forEach((deduplicatedIndex, originalIndex) => {
    const finalizedIndex = retainedIndexByDeduplicatedIndex.get(deduplicatedIndex);
    if (finalizedIndex !== undefined) filteredIndexMap.set(originalIndex, finalizedIndex);
  });
  const remapped = remapAnalysisIndexes(
    { ...analysis, reconciliation: canonicalReconciliation },
    finalizedNodes.map((candidate) => candidate.node),
    filteredIndexMap,
  );
  const result = sanitizeModelReconciliation(remapped);
  if (trace) {
    trace.model_candidates = analysis.nodes;
    trace.normalized_model_candidates = normalizedNodes;
    trace.deduplicated_model_candidates = finalized;
    trace.finalized_analysis = result;
  }
  return result;
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
      name: 'Model normalization and deduplication',
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
