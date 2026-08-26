import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { DEMO_PDF_EXTRACTION } from '@/lib/demo/localFixtures';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { hashText, ingestContextSource, IngestSourceInput } from '@/lib/context/ingestion';
import { isDemoMode, isLocalhostRequest } from '@/lib/runtime/demoMode';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { uploadContextSourcePdf } from '@/lib/storage/gcsAssets';
import { StorageError } from '@/lib/storage/types';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import { Project, UserMemoryProfile } from '@/types/clarity';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { estimateTokenCount, recordTrace } from '@/lib/observability/trace';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';

export const runtime = 'nodejs';

const sourceTypeSchema = z.enum(['text', 'pdf', 'image', 'note', 'voice']);
const profileSchema = z.object({
  answer_density: z.enum(['concise', 'balanced', 'detailed']).optional(),
  question_frequency: z.enum(['low', 'moderate', 'high']).optional(),
  challenge_level: z.enum(['low', 'moderate', 'high']).optional(),
  evidence_preference: z.enum(['research_first', 'intuition_allowed', 'strict_data']).optional(),
  brainstorm_style: z.enum(['diverge_then_converge', 'direct_to_solution']).optional(),
  uncertainty_style: z.enum(['explicit', 'implicit']).optional(),
  durable_notes: z.array(z.string()).optional(),
}).passthrough();

const jsonSourceSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  filename: z.string().trim().min(1).max(240),
  content: z.string().max(500_000).default(''),
  type: sourceTypeSchema,
  mimeType: z.string().trim().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  storageUrl: z.string().trim().optional(),
  hash: z.string().trim().optional(),
  origin: z.enum(['user', 'connector']).optional(),
  profile: profileSchema.optional(),
  forceReprocess: z.boolean().optional(),
});

type SourceRequest = z.infer<typeof jsonSourceSchema>;

function jsonError(error: unknown, status = 500, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : 'Context ingestion failed.',
    ...extra,
  }, { status });
}

function statusForError(error: unknown): number {
  if (!(error instanceof StorageError)) return 500;
  if (error.code === 'UNAUTHENTICATED') return 401;
  if (error.code === 'PERMISSION_DENIED') return 403;
  if (error.code === 'VALIDATION_ERROR') return 400;
  return 503;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadTarget(userId: string, projectId: string): Promise<{ project: Project; isGeneral: boolean }> {
  if (projectId === GENERAL_CONTEXT_ID) {
    return { project: await loadGeneralContext(userId), isGeneral: true };
  }
  const project = (await listProjects(userId)).find((item) => item.id === projectId);
  if (!project) throw new StorageError('The requested project was not found for this user.', 'PERMISSION_DENIED');
  return { project, isGeneral: false };
}

async function saveTarget(userId: string, project: Project, isGeneral: boolean): Promise<void> {
  if (isGeneral) await saveGeneralContext(userId, project);
  else await saveProject(userId, project);
}

function parseProfile(value: unknown): UserMemoryProfile {
  const parsed = profileSchema.safeParse(value);
  return parsed.success ? { ...DEFAULT_USER_PROFILE, ...parsed.data } : DEFAULT_USER_PROFILE;
}

async function parseRequest(request: Request): Promise<{
  source: SourceRequest;
  file?: File;
  bytes?: Buffer;
}> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    const parsed = jsonSourceSchema.safeParse(await request.json());
    if (!parsed.success) throw new StorageError('Invalid context source request.', 'VALIDATION_ERROR');
    return { source: parsed.data };
  }

  const form = await request.formData();
  const fileValue = form.get('file');
  const file = fileValue instanceof File ? fileValue : undefined;
  const source: SourceRequest = {
    userId: String(form.get('userId') ?? '').trim(),
    projectId: String(form.get('projectId') ?? '').trim(),
    sourceId: String(form.get('sourceId') ?? '').trim(),
    filename: String(form.get('filename') ?? file?.name ?? '').trim(),
    content: String(form.get('content') ?? ''),
    type: String(form.get('type') ?? 'pdf') as SourceRequest['type'],
    mimeType: String(form.get('mimeType') ?? file?.type ?? 'application/pdf').trim(),
    sizeBytes: file?.size,
    origin: 'user',
    profile: (() => {
      try { return JSON.parse(String(form.get('profile') ?? '{}')) as unknown; } catch { return undefined; }
    })() as SourceRequest['profile'],
    forceReprocess: String(form.get('forceReprocess') ?? '') === 'true',
  };
  const parsed = jsonSourceSchema.safeParse(source);
  if (!parsed.success) throw new StorageError('Invalid context source request.', 'VALIDATION_ERROR');
  if (!file || parsed.data.type !== 'pdf' || file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new StorageError('A PDF file is required for multipart Context uploads.', 'VALIDATION_ERROR');
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    source: { ...parsed.data, hash: hashBytes(bytes), sizeBytes: bytes.length },
    file,
    bytes,
  };
}

export async function POST(request: Request) {
  const started = Date.now();
  let parsed: { source: SourceRequest; file?: File; bytes?: Buffer };
  try {
    parsed = await parseRequest(request);
  } catch (error) {
    return jsonError(error, statusForError(error));
  }

  const userId = await requireAuthenticatedUserId(request, parsed.source.userId);
  const source = { ...parsed.source, userId };
  let target: { project: Project; isGeneral: boolean };
  try {
    target = await loadTarget(source.userId, source.projectId);
  } catch (error) {
    return jsonError(error, statusForError(error));
  }

  const computedHash = source.hash ?? await hashText(`${source.filename}:${source.content}:${source.storageUrl ?? ''}`);
  source.hash = computedHash;
  const forceReprocess = source.forceReprocess === true && process.env.NODE_ENV !== 'production';
  const duplicate = target.project.sources.find((item) =>
    item.type === source.type &&
    item.hash === computedHash &&
    item.extraction_hash === computedHash &&
    item.processing_status === 'completed'
  );
  if (duplicate && !forceReprocess) {
    return NextResponse.json({
      project: target.project,
      sourceId: duplicate.id,
      storageUrl: duplicate.storage_url,
      skipped: true,
      modelUsed: duplicate.model_used,
    });
  }

  let storageUrl = source.storageUrl;
  if (parsed.file && parsed.bytes) {
    try {
      if (isDemoMode()) {
        storageUrl = `local-demo://users/${source.userId}/sources/${source.sourceId}/${source.filename}`;
      } else {
        const uploaded = await uploadContextSourcePdf({
          userId: source.userId,
          sourceId: source.sourceId,
          filename: source.filename,
          contentType: source.mimeType || 'application/pdf',
          bytes: parsed.bytes,
        });
        storageUrl = uploaded.storageUrl;
      }
    } catch (error) {
      const failed = await ingestContextSource(target.project, {
        ...source,
        storageUrl,
        processingStatus: 'failed',
        errorMessage: error instanceof Error ? error.message : 'PDF upload failed.',
      }, parseProfile(source.profile));
      await saveTarget(source.userId, failed, target.isGeneral);
      return jsonError(error, statusForError(error), { project: failed });
    }
  }

  const input: IngestSourceInput = {
    sourceId: source.sourceId,
    filename: source.filename,
    content: source.content || (parsed.file ? source.filename : ''),
    type: source.type,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    storageUrl,
    hash: source.hash,
    origin: source.origin,
  };
  if (isDemoMode() && source.type === 'pdf') {
    input.extractionSummary = DEMO_PDF_EXTRACTION.summary;
    input.modelUsed = 'demo-fixture-v1';
    input.derivedNodes = DEMO_PDF_EXTRACTION.nodes;
  }

  const result = await processContextSource(target.project, input, parseProfile(source.profile), {
    forceReprocess,
    captureProcessingLog: isLocalhostRequest(request),
  });
  if (!result.skipped && !result.error) {
    const refreshed = await refreshProjectGapRuntime({
      userId: source.userId,
      project: result.project,
      profile: parseProfile(source.profile),
      route: '/api/context/ingest',
      label: 'Gap Agent after context ingestion',
    });
    result.project = refreshed.project;
  }
  if (!result.skipped) await saveTarget(source.userId, result.project, target.isGeneral);

  if (result.error) {
    return NextResponse.json({
      error: result.error,
      project: result.project,
      sourceId: source.sourceId,
      storageUrl,
    }, { status: 503 });
  }

  if (!isDemoMode() && !result.skipped && result.modelUsed) {
    const contextConfig = getAgentModelConfig('context');
    const anchoredDecision = result.project.nodes.find((node) =>
      node.type === 'DECISION' && node.status === 'OPEN' && node.source_refs.includes(source.sourceId)
    );
    const sourceDerivedNodeIds = new Set(result.project.sources.find((item) => item.id === source.sourceId)?.derived_node_ids ?? []);
    const anchoredQuestionNodeIds = anchoredDecision
      ? result.project.edges
        .filter((edge) => edge.target === anchoredDecision.id && ['blocks', 'informs'].includes(edge.type))
        .map((edge) => edge.source)
        .filter((nodeId) => sourceDerivedNodeIds.has(nodeId))
      : [];
    recordTrace({
      userId: source.userId,
      route: '/api/context/ingest',
      label: 'Decision Map context extraction',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      agentNames: ['Context Agent'],
      contextIds: result.project.sources.find((item) => item.id === source.sourceId)?.derived_node_ids ?? [],
      scores: [],
      toolCalls: ['processContextSource', 'graph extraction'],
      model: result.modelUsed,
      agentConfigs: [{
        agentName: 'Context Agent',
        model: contextConfig.model,
        thinkingLevel: contextConfig.thinkingLevel,
        maxOutputTokens: contextConfig.maxOutputTokens,
        execution: 'used',
      }],
      agentRuns: [{
        runId: `context_${source.sourceId}_${started}`,
        agent: 'Context Agent',
        model: result.modelUsed,
        thinkingLevel: contextConfig.thinkingLevel,
        inputTokens: estimateTokenCount(source.content),
        outputTokens: estimateTokenCount(JSON.stringify(result.analysis ?? {})),
        latencyMs: Date.now() - started,
        estimatedCost: 0,
        costSource: 'unavailable',
        validationStatus: result.analysis ? 'passed' : 'failed',
        confidence: result.analysis?.nodes.length
          ? Number((result.analysis.nodes.reduce((sum, node) => sum + node.confidence, 0) / result.analysis.nodes.length).toFixed(3))
          : null,
        escalated: false,
        execution: 'used',
        inputSummary: `One ${source.type} source (${source.sourceId})`,
        outputSummary: `${result.analysis?.nodes.length ?? 0} nodes and ${result.analysis?.relationships.length ?? 0} relationships`,
      }],
      contextSummary: {
        scope: target.isGeneral ? 'General context' : target.project.id,
        includedContextCount: result.project.sources.find((item) => item.id === source.sourceId)?.derived_node_ids.length ?? 0,
        goalCount: result.analysis?.nodes.filter((node) => node.type === 'GOAL').length ?? 0,
        unresolvedGapCount: result.analysis?.nodes.filter((node) => node.type === 'UNKNOWN').length ?? 0,
        evidenceCount: result.analysis?.nodes.filter((node) => node.type === 'EVIDENCE').length ?? 0,
        preferenceCount: result.analysis?.nodes.filter((node) => node.type === 'PREFERENCE').length ?? 0,
        decisionCount: result.analysis?.nodes.filter((node) => node.type === 'DECISION').length ?? 0,
        commitmentCount: result.analysis?.nodes.filter((node) => node.type === 'NEXT_ACTION').length ?? 0,
      },
      decisionAnchoring: anchoredDecision && anchoredQuestionNodeIds.length > 0 ? {
        decisionId: anchoredDecision.id,
        decisionTitle: anchoredDecision.text,
        questionNodeIds: anchoredQuestionNodeIds,
        linkCount: anchoredQuestionNodeIds.length,
        source: 'context_agent',
      } : undefined,
      pipelineSteps: [{
        name: 'Context Agent / graph extraction',
        agentName: 'Context Agent',
        summary: `Extracted ${result.analysis?.nodes.length ?? 0} candidate graph nodes from the uploaded context source.`,
        execution: 'used',
        contextCount: result.analysis?.nodes.length ?? 0,
      }, {
        name: 'Update Decision Map data',
        summary: 'Stored the extracted nodes and relationships for the project graph.',
        execution: 'deterministic',
        contextCount: result.project.nodes.length,
      }],
    });
  }

  if (!result.skipped && !result.error && source.projectId !== '__general_context__') {
    try {
      await createProjectSnapshot({
        userId: source.userId,
        projectId: source.projectId,
        trigger: {
          type: 'context_processed',
          sourceId: source.sourceId,
          historyEventId: result.project.historyEvents?.at(-1)?.id,
        },
        label: 'Context processed',
        summary: `Processed ${source.filename}.`,
      });
    } catch (error) {
      console.warn('[Project snapshots] context snapshot unavailable', error);
    }
  }

  return NextResponse.json({
    project: result.project,
    sourceId: source.sourceId,
    storageUrl,
    skipped: result.skipped,
    modelUsed: result.modelUsed,
    analysis: result.analysis,
  });
}
