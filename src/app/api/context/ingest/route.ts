import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { DEMO_PDF_EXTRACTION } from '@/lib/demo/localFixtures';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { validateContextAttachment } from '@/lib/context/contextAttachments';
import { hashText, ingestContextSource, IngestSourceInput } from '@/lib/context/ingestion';
import { isDemoMode, isLocalhostRequest } from '@/lib/runtime/demoMode';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { getContextAssetsBucket } from '@/lib/storage/assets';
import { assertStorageUrlBelongsToUser } from '@/lib/auth/server';
import { parseGsUrl, uploadContextSourceAsset } from '@/lib/storage/gcsAssets';
import { StorageError } from '@/lib/storage/types';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import { Project } from '@/types/clarity';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { estimateTokenCount, recordTrace } from '@/lib/observability/trace';
import { appendCalendarSyncStep } from '@/lib/observability/trace';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { loadUserMemoryProfile } from '@/lib/memory/serverStore';
import { scheduleAskSuggestionsRefresh } from '@/lib/ask/suggestionsScheduler';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';

export const runtime = 'nodejs';

const activeContextIngestions = new Map<string, Promise<Response>>();

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
  calendarSyncRunId: z.string().trim().min(1).max(120).optional(),
  profile: profileSchema.optional(),
  forceReprocess: z.boolean().optional(),
});

type SourceRequest = z.infer<typeof jsonSourceSchema>;

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof StorageError) {
    if (['UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND', 'VALIDATION_ERROR'].includes(error.code)) {
      return error.message;
    }
    return fallback;
  }
  return fallback;
}

function jsonError(error: unknown, status = 500, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    error: userFacingError(error, 'Context ingestion failed. Please try again.'),
    ...extra,
  }, { status });
}

function assertProvidedStorageUrlIsSafe(source: SourceRequest, userId: string): void {
  const storageUrl = source.storageUrl?.trim();
  if (!storageUrl) return;

  if (source.origin === 'connector') {
    let parsed: URL;
    try {
      parsed = new URL(storageUrl);
    } catch {
      throw new StorageError('The connected source URL is invalid.', 'VALIDATION_ERROR');
    }
    if (parsed.protocol !== 'https:' || !(parsed.hostname === 'google.com' || parsed.hostname.endsWith('.google.com'))) {
      throw new StorageError('Connected source URLs must use a Google HTTPS source.', 'VALIDATION_ERROR');
    }
    return;
  }

  if (isDemoMode() && storageUrl.startsWith('local-demo://')) return;
  if (!storageUrl.startsWith('gs://')) {
    throw new StorageError('User-provided context assets must use an authenticated gs:// URL.', 'VALIDATION_ERROR');
  }
  const { bucket, objectName } = parseGsUrl(storageUrl);
  if (bucket !== getContextAssetsBucket()) {
    throw new StorageError('The context asset bucket does not match the configured bucket.', 'VALIDATION_ERROR');
  }
  assertStorageUrlBelongsToUser(storageUrl, userId);
  const expectedPrefix = `users/${encodeURIComponent(userId)}/sources/`;
  if (!objectName.startsWith(expectedPrefix)) {
    throw new StorageError('The requested context asset does not belong to this user.', 'PERMISSION_DENIED');
  }
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
  if (!project) throw new StorageError('The requested workspace was not found for this user.', 'PERMISSION_DENIED');
  return { project, isGeneral: false };
}

async function saveTarget(userId: string, project: Project, isGeneral: boolean): Promise<void> {
  if (isGeneral) await saveGeneralContext(userId, project);
  else await saveProject(userId, project);
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
    mimeType: String(form.get('mimeType') ?? file?.type ?? '').trim() || undefined,
    sizeBytes: file?.size,
    origin: 'user',
    calendarSyncRunId: String(form.get('calendarSyncRunId') ?? '').trim() || undefined,
    profile: (() => {
      try { return JSON.parse(String(form.get('profile') ?? '{}')) as unknown; } catch { return undefined; }
    })() as SourceRequest['profile'],
    forceReprocess: String(form.get('forceReprocess') ?? '') === 'true',
  };
  const parsed = jsonSourceSchema.safeParse(source);
  if (!parsed.success) throw new StorageError('Invalid context source request.', 'VALIDATION_ERROR');
  if (!file) throw new StorageError('A file is required for this multipart Context upload.', 'VALIDATION_ERROR');
  const bytes = Buffer.from(await file.arrayBuffer());
  const attachment = validateContextAttachment({
    type: parsed.data.type,
    filename: parsed.data.filename || file.name,
    mimeType: parsed.data.mimeType || file.type,
    bytes,
  });
  const content = parsed.data.content || (parsed.data.type === 'text' || parsed.data.type === 'note'
    ? new TextDecoder().decode(bytes)
    : '');
  return {
    source: {
      ...parsed.data,
      content,
      mimeType: attachment.mimeType,
      hash: hashBytes(bytes),
      sizeBytes: attachment.sizeBytes,
    },
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
  const lockKey = `${userId}:${parsed.source.projectId}:${parsed.source.sourceId}`;
  const previous = activeContextIngestions.get(lockKey);
  if (previous) await previous.catch(() => undefined);

  const operation = processParsedContextRequest(request, parsed, userId, started).catch((error) => {
    console.error('[Context ingestion] request failed', {
      userId,
      projectId: parsed.source.projectId,
      sourceId: parsed.source.sourceId,
      error,
    });
    return jsonError(error, statusForError(error));
  });
  activeContextIngestions.set(lockKey, operation);
  try {
    return await operation;
  } finally {
    if (activeContextIngestions.get(lockKey) === operation) activeContextIngestions.delete(lockKey);
  }
}

async function processParsedContextRequest(
  request: Request,
  parsed: { source: SourceRequest; file?: File; bytes?: Buffer },
  userId: string,
  started: number,
): Promise<Response> {
  const source = { ...parsed.source, userId };
  const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
  try {
    assertProvidedStorageUrlIsSafe(source, userId);
  } catch (error) {
    return jsonError(error, statusForError(error));
  }
  let target: { project: Project; isGeneral: boolean };
  try {
    target = await loadTarget(source.userId, source.projectId);
  } catch (error) {
    return jsonError(error, statusForError(error));
  }

  // `hash` identifies the submitted attachment (or the complete JSON source
  // when there is no file). For attachments, the extraction hash also
  // includes the optional supporting text so changing that text is a real
  // reprocessing request rather than a duplicate.
  const sourceHash = source.hash ?? await hashText(`${source.filename}:${source.content}:${source.storageUrl ?? ''}`);
  const extractionHash = parsed.bytes
    ? await hashText(`${sourceHash}:${source.content}`)
    : sourceHash;
  source.hash = sourceHash;

  // A browser reload can lose the in-memory source ID. A failed source with
  // the same authenticated project, type, and attachment fingerprint is the
  // same retryable attempt, even when the client generated a new ID.
  const retrySource = target.project.sources.find((item) =>
    item.type === source.type &&
    item.hash === sourceHash &&
    item.processing_status === 'failed' &&
    (item.id === source.sourceId || source.origin !== 'connector')
  );
  if (retrySource) {
    source.sourceId = retrySource.id;
    if (!source.storageUrl && retrySource.storage_url) source.storageUrl = retrySource.storage_url;
    assertProvidedStorageUrlIsSafe(source, userId);
  }
  const forceReprocess = source.forceReprocess === true && process.env.NODE_ENV !== 'production';
  const duplicate = target.project.sources.find((item) =>
    item.type === source.type &&
    item.hash === sourceHash &&
    (
      item.extraction_hash === extractionHash
      // Sources written before supporting text was included in the
      // extraction fingerprint used the attachment hash for both fields.
      // Preserve that retry compatibility only when no supporting text was
      // supplied; otherwise the request must be analyzed again.
      || (!source.content.trim() && item.extraction_hash === sourceHash)
    ) &&
    item.processing_status === 'completed' &&
    (source.origin !== 'connector' || item.id === source.sourceId)
  );
  if (duplicate && !forceReprocess) {
    if (source.calendarSyncRunId) {
      appendCalendarSyncStep(source.calendarSyncRunId, {
        name: 'Client import / Context ingestion',
        status: 'completed',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        details: {
          sourceId: source.sourceId,
          projectId: source.projectId,
          resultProjectId: target.project.id,
          outcome: 'skipped_duplicate',
          duplicateSourceId: duplicate.id,
          saveCompleted: false,
          reloadCompleted: false,
          derivedNodeIds: duplicate.derived_node_ids,
        },
      });
    }
    return NextResponse.json({
      project: target.project,
      sourceId: duplicate.id,
      storageUrl: duplicate.storage_url,
      skipped: true,
      modelUsed: duplicate.model_used,
      ...(source.calendarSyncRunId ? { calendarSyncRunId: source.calendarSyncRunId } : {}),
    });
  }

  let storageUrl = source.storageUrl;
  if (parsed.file && parsed.bytes && !storageUrl) {
    try {
      if (isDemoMode()) {
        storageUrl = `local-demo://users/${source.userId}/sources/${source.sourceId}/${source.filename}`;
      } else {
        const uploaded = await uploadContextSourceAsset({
          userId: source.userId,
          sourceId: source.sourceId,
          filename: source.filename,
          contentType: source.mimeType || 'application/octet-stream',
          bytes: parsed.bytes,
        });
        storageUrl = uploaded.storageUrl;
      }
    } catch (error) {
      const failed = await ingestContextSource(target.project, {
        ...source,
        storageUrl,
        processingStatus: 'failed',
        errorMessage: userFacingError(error, 'The attachment could not be uploaded. Please try again.'),
      }, profile);
      await saveTarget(source.userId, failed, target.isGeneral);
      return jsonError(error, statusForError(error), { project: failed });
    }
  }

  const input: IngestSourceInput = {
    sourceId: source.sourceId,
    filename: source.filename,
    content: source.content,
    type: source.type,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    storageUrl,
    hash: extractionHash,
    ...(parsed.bytes ? { attachmentHash: sourceHash } : {}),
    origin: source.origin,
  };
  if (isDemoMode() && source.type === 'pdf') {
    input.extractionSummary = DEMO_PDF_EXTRACTION.summary;
    input.modelUsed = 'demo-fixture-v1';
    input.derivedNodes = DEMO_PDF_EXTRACTION.nodes;
  }

  const priorHistoryEventIds = new Set((target.project.historyEvents ?? []).map((event) => event.id));
  const result = await processContextSource(target.project, input, profile, {
    forceReprocess,
    captureProcessingLog: isLocalhostRequest(request),
  });
  const semanticStateChanged = semanticProjectVersion(target.project) !== semanticProjectVersion(result.project);
  if (!result.skipped && !result.error) {
    const refreshed = await refreshProjectGapRuntime({
      userId: source.userId,
      project: result.project,
      profile,
      route: '/api/context/ingest',
      label: 'Gap Agent after context ingestion',
    });
    result.project = refreshed.project;
  }
  if (result.error) {
    const failedSource = result.project.sources.find((item) => item.id === source.sourceId);
    if (failedSource) failedSource.error_message = 'Context could not be analyzed right now. Please try again.';
  }
  if (!result.skipped) await saveTarget(source.userId, result.project, target.isGeneral);
  if (!target.isGeneral && semanticStateChanged && !result.skipped && !result.error) {
    await scheduleAskSuggestionsRefresh({
      userId: source.userId,
      project: result.project,
      profile,
    });
  }

  const sourceHistoryEventId = !result.skipped && !result.error
    ? result.project.historyEvents?.find((event) =>
      event.type === 'context_added'
      && event.sourceId === source.sourceId
      && !priorHistoryEventIds.has(event.id)
    )?.id
    : undefined;

  let reloadedProjectId: string | undefined;
  if (source.calendarSyncRunId) {
    if (!result.error && !result.skipped && !target.isGeneral) {
      const reloaded = await loadTarget(source.userId, source.projectId);
      result.project = reloaded.project;
      reloadedProjectId = reloaded.project.id;
    }
    const persistedSource = result.project.sources.find((item) => item.id === source.sourceId);
    appendCalendarSyncStep(source.calendarSyncRunId, {
      name: 'Client import / Context ingestion',
      status: result.error ? 'failed' : 'completed',
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      details: {
        sourceId: source.sourceId,
        projectId: source.projectId,
        resultProjectId: result.project.id,
        outcome: result.error ? 'failed' : result.skipped ? 'skipped_unchanged' : 'imported',
        importedSourceId: persistedSource?.id ?? null,
        processingStatus: persistedSource?.processing_status ?? null,
        derivedNodeIds: persistedSource?.derived_node_ids ?? [],
        historyEventId: sourceHistoryEventId ?? null,
        saveCompleted: !result.skipped,
        reloadCompleted: Boolean(reloadedProjectId),
        reloadedProjectId: reloadedProjectId ?? null,
      },
      ...(result.error ? { error: result.error } : {}),
    });
  }

  if (result.error) {
    const safeError = 'Context could not be analyzed right now. Please try again.';
    console.error('[Context ingestion] model processing failed', {
      userId: source.userId,
      projectId: source.projectId,
      sourceId: source.sourceId,
      error: result.error,
    });
    return NextResponse.json({
      error: safeError,
      project: result.project,
      sourceId: source.sourceId,
      storageUrl,
      ...(source.calendarSyncRunId ? { calendarSyncRunId: source.calendarSyncRunId } : {}),
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
        summary: 'Stored the extracted nodes and relationships for the workspace graph.',
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
          ...(sourceHistoryEventId ? { historyEventId: sourceHistoryEventId } : {}),
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
    ...(source.calendarSyncRunId ? { calendarSyncRunId: source.calendarSyncRunId } : {}),
  });
}
