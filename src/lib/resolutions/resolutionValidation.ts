import { createHash } from 'node:crypto';
import { Type } from '@google/genai';
import { z } from 'zod';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { loadGeneralContext, listProjects } from '@/lib/storage';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import { canonicalQuestionGroups } from '@/lib/questions/canonical';
import type { ClarityNode, Project } from '@/types/clarity';
import type {
  ResolutionValidation,
  ResolutionValidationMetadata,
  ResolutionValidationSubmission,
} from '@/types/resolutionValidation';
import { StorageError } from '@/lib/storage/types';

export type ResolutionNodeType = 'UNKNOWN' | 'ASSUMPTION' | 'DECISION';

export interface ResolutionValidationInput {
  userId: string;
  projectId: string;
  nodeId: string;
  nodeType: ResolutionNodeType;
  prompt: string;
  proposedResponse: string;
  existingResolution?: string;
  relatedContext: Array<{
    nodeId: string;
    type: string;
    text: string;
    status: string;
  }>;
  semanticProjectVersion: string;
}

export interface ProjectResolutionValidation {
  validation: ResolutionValidation;
  fingerprint: string;
  project: Project;
  node: ClarityNode;
}

const validationSchema = z.object({
  verdict: z.enum(['sufficient', 'warning', 'unavailable']),
  reason: z.string().trim().min(1).max(500),
  missingInformation: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
  suggestedRevision: z.string().trim().min(1).max(500).optional(),
  confidence: z.number().min(0).max(1),
});

const cache = new Map<string, { expiresAt: number; value: ResolutionValidation }>();
const inFlight = new Map<string, Promise<ResolutionValidation>>();
const CACHE_TTL_MS = 120_000;

function bounded(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function responseCandidates(value: string): string[] {
  const candidates = [value.trim()];
  for (const match of value.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(value.slice(start, end + 1));
  return [...new Set(candidates.filter(Boolean))];
}

function parseValidation(value: string | undefined): ResolutionValidation {
  if (!value) throw new Error('The resolution validator returned no response.');
  for (const candidate of responseCandidates(value)) {
    try {
      const parsed = validationSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  throw new Error('The resolution validator returned an invalid response.');
}

function deterministicValidation(): ResolutionValidation {
  return {
    verdict: 'sufficient',
    reason: 'Local demo validation fixture accepted this response.',
    missingInformation: [],
    confidence: 0.5,
  };
}

const restatementWarning: ResolutionValidation = {
  verdict: 'warning',
  reason: 'This response repeats the unresolved item without adding a confirmed outcome.',
  missingInformation: [
    'Record what was confirmed, what changed, or what evidence resolves the item.',
  ],
  confidence: 1,
};

function stripMatchingSurroundingQuotes(value: string): string {
  const quotePairs: Array<readonly [string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ];
  const pair = quotePairs.find(([opening, closing]) => value.startsWith(opening) && value.endsWith(closing) && value.length > opening.length + closing.length);
  return pair ? value.slice(pair[0].length, -pair[1].length).trim() : value;
}

function normalizeRestatement(value: string): string {
  let normalized = value.trim().replace(/\s+/g, ' ');
  normalized = normalized.replace(/[.!?]+$/, '').trim();
  normalized = stripMatchingSurroundingQuotes(normalized);
  normalized = normalized.replace(/[.!?]+$/, '').trim();
  return normalized.toLocaleLowerCase();
}

function isEffectivelyIdenticalRestatement(input: ResolutionValidationInput, node: ClarityNode): boolean {
  if (node.status !== 'OPEN' || (node.type !== 'UNKNOWN' && node.type !== 'ASSUMPTION')) return false;
  const prompt = normalizeRestatement(input.prompt);
  const response = normalizeRestatement(input.proposedResponse);
  return Boolean(prompt && response && prompt === response);
}

function fingerprint(input: ResolutionValidationInput): string {
  return createHash('sha256').update(JSON.stringify({
    userId: input.userId,
    projectId: input.projectId,
    nodeId: input.nodeId,
    proposedResponse: input.proposedResponse,
    semanticProjectVersion: input.semanticProjectVersion,
  })).digest('hex');
}

async function generateValidation(input: ResolutionValidationInput): Promise<ResolutionValidation> {
  if (isDemoMode()) return deterministicValidation();

  try {
    const model = getAgentModelConfig('partner');
    const prompt = [
      'You are Gapwise resolution-quality validation.',
      'Check whether the proposed response meaningfully resolves the supplied project item.',
      'Evaluate answer quality and relevance only. Do not verify external truth and do not claim medical, legal, or financial correctness.',
      'Return JSON only with verdict, reason, missingInformation, optional suggestedRevision, and confidence.',
      'Use sufficient when the response is specific enough to persist and directly addresses the item.',
      'Use warning when it is insufficient, irrelevant, ambiguous, contradictory to supplied context, or still expresses unresolved uncertainty.',
      'For DECISION, the response must clearly record what was selected. A bare confirmation is not enough if it omits the outcome.',
      'Keep reason concise and make suggestedRevision a concise replacement only when useful.',
      `Target node type: ${input.nodeType}`,
      `Target question or decision: ${bounded(input.prompt, 1200)}`,
      `Existing recorded resolution, if any: ${bounded(input.existingResolution ?? 'None', 1000)}`,
      `Proposed response: ${bounded(input.proposedResponse, 5000)}`,
      `Directly related project context:\n${JSON.stringify(input.relatedContext)}`,
    ].join('\n\n');
    const response = await getVertexGenAIClient().models.generateContent({
      model: model.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        maxOutputTokens: 384,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['verdict', 'reason', 'missingInformation', 'confidence'],
          properties: {
            verdict: { type: Type.STRING, enum: ['sufficient', 'warning', 'unavailable'] },
            reason: { type: Type.STRING },
            missingInformation: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedRevision: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
          },
        },
      },
    });
    return parseValidation(response.text);
  } catch (error) {
    console.error('[Resolution validation] unavailable', {
      error: error instanceof Error ? error.message : 'unknown-error',
      projectId: input.projectId,
      nodeId: input.nodeId,
    });
    return {
      verdict: 'unavailable',
      reason: 'Gapwise could not check this response right now.',
      missingInformation: [],
      confidence: 0,
    };
  }
}

function relatedContext(project: Project, target: ClarityNode) {
  const relatedIds = project.edges
    .filter((edge) => edge.source === target.id || edge.target === target.id)
    .map((edge) => edge.source === target.id ? edge.target : edge.source);
  return [...new Set(relatedIds)]
    .map((id) => project.nodes.find((node) => node.id === id))
    .filter((node): node is ClarityNode => node !== undefined && node.status !== 'DEPRECATED')
    .sort((left, right) => right.impact * right.confidence - left.impact * left.confidence)
    .slice(0, 6)
    .map((node) => ({ nodeId: node.id, type: node.type, text: bounded(node.text, 600), status: node.status }));
}

function isResolutionNode(node: ClarityNode | undefined): node is ClarityNode & { type: ResolutionNodeType } {
  if (!node) return false;
  return (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION' || node.type === 'DECISION')
    && node.status !== 'DEPRECATED';
}

async function loadProjectForValidation(userId: string, projectId: string): Promise<Project> {
  if (projectId === GENERAL_CONTEXT_ID) return loadGeneralContext(userId);
  const project = (await listProjects(userId)).find((candidate) => candidate.id === projectId);
  if (!project) throw new StorageError('The requested workspace was not found for this user.', 'PERMISSION_DENIED');
  return project;
}

function targetNodeForValidation(project: Project, nodeId: string): ClarityNode | undefined {
  const group = canonicalQuestionGroups(project).find((candidate) => candidate.nodeIds.includes(nodeId));
  return group?.canonical ?? project.nodes.find((node) => node.id === nodeId);
}

export async function validateProjectResolution(params: {
  userId: string;
  projectId: string;
  nodeId: string;
  proposedResponse: string;
}): Promise<ProjectResolutionValidation> {
  const project = await loadProjectForValidation(params.userId, params.projectId);
  const node = targetNodeForValidation(project, params.nodeId);
  if (!isResolutionNode(node)) {
    throw new StorageError('Select a supported question, assumption, or decision.', 'VALIDATION_ERROR');
  }
  if (!['OPEN', 'RESOLVED'].includes(node.status)) {
    throw new StorageError('This item cannot be resolved from the current workspace state.', 'VALIDATION_ERROR');
  }
  const input: ResolutionValidationInput = {
    userId: params.userId,
    projectId: project.id,
    nodeId: node.id,
    nodeType: node.type,
    prompt: node.text,
    proposedResponse: params.proposedResponse.trim(),
    existingResolution: node.type === 'DECISION'
      ? node.decision_outcome
      : project.history.find((entry) => entry.nodeId === node.id)?.answer,
    relatedContext: relatedContext(project, node),
    semanticProjectVersion: project.semantic_version ?? semanticVersionForValidation(project),
  };
  const key = fingerprint(input);
  if (isEffectivelyIdenticalRestatement(input, node)) {
    cache.set(key, { value: restatementWarning, expiresAt: Date.now() + CACHE_TTL_MS });
    return { validation: restatementWarning, fingerprint: key, project, node };
  }
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { validation: cached.value, fingerprint: key, project, node };
  const pending = inFlight.get(key) ?? generateValidation(input);
  inFlight.set(key, pending);
  try {
    const validation = await pending;
    cache.set(key, { value: validation, expiresAt: Date.now() + CACHE_TTL_MS });
    return { validation, fingerprint: key, project, node };
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}

function semanticVersionForValidation(project: Project): string {
  return createHash('sha256').update(JSON.stringify({
    title: project.title,
    goal: project.goal,
    deadline: project.deadline ?? null,
    nodes: project.nodes.map((node) => ({ id: node.id, type: node.type, text: node.text, status: node.status, outcome: node.decision_outcome ?? null })),
    edges: project.edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
  })).digest('hex');
}

export function resolutionHistoryMetadata(
  validation: ResolutionValidation,
  submission?: ResolutionValidationSubmission,
): ResolutionValidationMetadata {
  return {
    verdict: validation.verdict,
    overridden: Boolean(submission?.validationOverride && validation.verdict === 'warning'),
    ...(validation.reason ? { reason: validation.reason } : {}),
    confidence: validation.confidence,
  };
}

export function validationWarningResponse(
  validation: ResolutionValidation,
  fingerprintValue: string,
) {
  return {
    error: 'This response may not fully resolve the item.',
    code: 'RESOLUTION_VALIDATION_WARNING',
    resolutionValidation: validation,
    validationFingerprint: fingerprintValue,
  };
}
