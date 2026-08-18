import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import {
  gapAssessmentV1Schema,
  type GapAssessmentV1,
} from '@/lib/agents/gapContractV1';
import { assessGapsV1Deterministically } from '@/lib/agents/gapAssessmentV1';
import type { AgentModelConfig } from '@/lib/agents/modelPolicy';
import type { ContextPack } from '@/types/contextPack';
import type { DurableMemory } from '@/types/contextPack';
import type { Project } from '@/types/clarity';

const gapRunMetadataSchema = z.object({
  runId: z.string().min(1),
  agent: z.literal('Gap Agent'),
  model: z.string().min(1),
  thinkingLevel: z.string().min(1),
  thinkingApplied: z.boolean(),
  maxOutputTokens: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative().nullable(),
  costSource: z.enum(['configured_rates', 'unavailable']),
  validationStatus: z.enum(['passed', 'failed']),
  confidence: z.number().min(0).max(1).nullable(),
  escalated: z.boolean(),
  escalationReason: z.string().nullable(),
  inputSummary: z.string(),
  outputSummary: z.string(),
});

const gapAssessmentResponseSchema = z.object({
  assessment: gapAssessmentV1Schema,
  metadata: gapRunMetadataSchema,
});

export type GapRemoteMetadata = z.infer<typeof gapRunMetadataSchema>;

export interface GapRemoteResult {
  assessment: GapAssessmentV1;
  metadata: GapRemoteMetadata;
}

export class GapRemoteError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GapRemoteError';
    this.status = status;
  }
}

function agentBaseUrl(): string {
  return (process.env.GAPSWISE_AGENT_URL ?? process.env.AGENT_SERVICE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
}

async function agentHeaders(): Promise<Record<string, string>> {
  const internalSecret = process.env.GAPSWISE_INTERNAL_API_SECRET?.trim();
  const headers: Record<string, string> = internalSecret
    ? { 'x-gapswise-internal-secret': internalSecret }
    : {};
  if (process.env.GAPSWISE_AGENT_AUTH !== 'true') return headers;
  const audience = agentBaseUrl();
  if (!audience.startsWith('https://')) {
    throw new GapRemoteError('Authenticated Gap Agent calls require an HTTPS service URL.');
  }
  try {
    const client = await new GoogleAuth().getIdTokenClient(audience);
    return { ...headers, ...await client.getRequestHeaders(audience) };
  } catch {
    throw new GapRemoteError('Gap Agent identity-token creation failed.');
  }
}

function timeoutMs(): number {
  const value = Number.parseInt(process.env.AGENT_GAP_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(value) ? Math.min(45_000, Math.max(3_000, value)) : 22_000;
}

function scopedProject(project: Project) {
  return {
    id: project.id,
    title: project.title,
    goal: project.goal,
    deadline: project.deadline,
    nodes: project.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      text: node.text,
      status: node.status,
      confidence: node.confidence,
      impact: node.impact,
      priority: node.priority,
      source_refs: node.source_refs,
      why_it_matters: node.why_it_matters,
    })),
    edges: project.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
    })),
    // Raw document bodies are intentionally excluded. Context Pack excerpts
    // carry the bounded evidence available to this inference pass.
    sources: project.sources.map((source) => ({ id: source.id, filename: source.filename })),
  };
}

export async function requestGapAssessment(params: {
  userId: string;
  project: Project;
  contextPack: ContextPack;
  memories?: DurableMemory[];
  evaluationConfig?: AgentModelConfig;
}): Promise<GapRemoteResult> {
  const candidateScaffold = assessGapsV1Deterministically({
    project: params.project,
    contextPack: params.contextPack,
    memories: params.memories ?? [],
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${agentBaseUrl()}/internal/gap-assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await agentHeaders() },
      body: JSON.stringify({
        userId: params.userId,
        project: scopedProject(params.project),
        contextPack: params.contextPack,
        candidateScaffold,
        ...(params.evaluationConfig ? {
          evaluationConfig: {
            model: params.evaluationConfig.model,
            thinkingLevel: params.evaluationConfig.thinkingLevel,
            maxOutputTokens: params.evaluationConfig.maxOutputTokens,
          },
        } : {}),
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json() as { detail?: unknown };
        detail = typeof body.detail === 'string' ? body.detail : '';
      } catch {
        // Keep transport failures sanitized.
      }
      throw new GapRemoteError(detail || `Gap Agent returned status ${response.status}.`, response.status);
    }
    const parsed = gapAssessmentResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new GapRemoteError('Gap Agent returned an invalid response contract.');
    return parsed.data;
  } catch (error) {
    if (error instanceof GapRemoteError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GapRemoteError('Gap Agent request timed out.');
    }
    throw new GapRemoteError('Gap Agent service is unavailable.');
  } finally {
    clearTimeout(timeout);
  }
}
