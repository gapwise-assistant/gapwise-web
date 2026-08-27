import { randomUUID } from 'node:crypto';
import { boundedId } from '@/lib/ids/boundedId';
import { getStorageProvider } from '@/lib/storage';
import type {
  DeveloperGenerationRun,
  DeveloperGenerationStep,
  DeveloperGenerationStepCategory,
  StorageProvider,
} from '@/lib/storage/types';
import type { Project } from '@/types/clarity';

export interface DeveloperGenerationStepMetadata {
  name: string;
  category: DeveloperGenerationStepCategory;
  sourceId?: string;
  filename?: string;
  chatId?: string;
  messageId?: string;
  proposalId?: string;
  historyEventId?: string;
  snapshotId?: string;
  nodeCountBefore?: number;
  nodeCountAfter?: number;
  edgeCountBefore?: number;
  edgeCountAfter?: number;
  derivedNodeIds?: string[];
  summary?: string;
}

export interface DeveloperGenerationRecorder {
  readonly run: DeveloperGenerationRun;
  step<T>(metadata: DeveloperGenerationStepMetadata, operation: () => Promise<T> | T): Promise<T>;
  complete(): Promise<void>;
  fail(error: unknown): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectFromValue(value: unknown): Project | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { nodes?: unknown; edges?: unknown; id?: unknown };
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges) || typeof candidate.id !== 'string') return null;
  return candidate as Project;
}

function projectFromResult(value: unknown): Project | null {
  return projectFromValue(value) ?? (
    value && typeof value === 'object'
      ? projectFromValue((value as { project?: unknown }).project)
      : null
  );
}

async function projectCounts(
  storage: StorageProvider,
  userId: string,
  projectId: string,
): Promise<{ nodeCount?: number; edgeCount?: number }> {
  try {
    const project = await storage.getProject(userId, projectId);
    return project
      ? { nodeCount: project.nodes.length, edgeCount: project.edges.length }
      : {};
  } catch {
    return {};
  }
}

function durationSince(startedAt: string): number {
  return Math.max(0, Date.now() - Date.parse(startedAt));
}

export async function startDeveloperGenerationRun(params: {
  userId: string;
  projectId: string;
  generator: string;
  storage?: StorageProvider;
}): Promise<DeveloperGenerationRecorder> {
  const storage = params.storage ?? getStorageProvider();
  const startedAt = new Date().toISOString();
  const run: DeveloperGenerationRun = {
    id: boundedId('generation', `${params.generator}:${params.projectId}:${startedAt}:${randomUUID()}`),
    userId: params.userId,
    projectId: params.projectId,
    generator: params.generator,
    status: 'running',
    startedAt,
  };
  await storage.saveDeveloperGenerationRun(params.userId, run);

  let sequence = 0;
  let failed = false;

  const recorder: DeveloperGenerationRecorder = {
    run,

    async step<T>(metadata: DeveloperGenerationStepMetadata, operation: () => Promise<T> | T) {
      if (failed || run.status === 'failed') {
        throw new Error('Developer generation run has already failed.');
      }
      const sequenceNumber = ++sequence;
      const startedAt = new Date().toISOString();
      const step: DeveloperGenerationStep = {
        id: boundedId('generation_step', `${run.id}:${sequenceNumber}:${metadata.name}`),
        runId: run.id,
        userId: params.userId,
        projectId: params.projectId,
        sequence: sequenceNumber,
        ...metadata,
        status: 'running',
        startedAt,
      };
      const before = await projectCounts(storage, params.userId, params.projectId);
      step.nodeCountBefore ??= before.nodeCount;
      step.edgeCountBefore ??= before.edgeCount;
      await storage.saveDeveloperGenerationStep(params.userId, step);

      run.currentStep = metadata.name;
      await storage.saveDeveloperGenerationRun(params.userId, run);

      try {
        const result = await operation();
        const returnedProject = projectFromResult(result);
        const after = returnedProject
          ? { nodeCount: returnedProject.nodes.length, edgeCount: returnedProject.edges.length }
          : await projectCounts(storage, params.userId, params.projectId);
        if (metadata.sourceId && returnedProject) {
          step.derivedNodeIds ??= returnedProject.sources.find((source) => source.id === metadata.sourceId)?.derived_node_ids;
        }
        if (returnedProject) {
          if (metadata.category === 'storage' && metadata.name.toLowerCase().includes('reloaded')) {
            step.reloadedProjectId = returnedProject.id;
          }
        }
        if (valueHasString(result, 'sourceId')) step.sourceId ??= valueHasString(result, 'sourceId');
        if (valueHasString(result, 'messageId')) step.messageId ??= valueHasString(result, 'messageId');
        if (valueHasString(result, 'historyEventId')) step.historyEventId ??= valueHasString(result, 'historyEventId');
        if (!step.historyEventId && returnedProject) {
          step.historyEventId = returnedProject.historyEvents?.at(-1)?.id;
        }
        if (metadata.category === 'snapshot' && valueHasString(result, 'id')) step.snapshotId ??= valueHasString(result, 'id');
        step.nodeCountAfter ??= after.nodeCount;
        step.edgeCountAfter ??= after.edgeCount;
        step.status = 'completed';
        step.completedAt = new Date().toISOString();
        step.durationMs = durationSince(startedAt);
        await storage.saveDeveloperGenerationStep(params.userId, step);
        return result;
      } catch (error) {
        failed = true;
        const after = await projectCounts(storage, params.userId, params.projectId);
        step.nodeCountAfter ??= after.nodeCount;
        step.edgeCountAfter ??= after.edgeCount;
        step.status = 'failed';
        step.completedAt = new Date().toISOString();
        step.durationMs = durationSince(startedAt);
        step.error = errorMessage(error);
        try {
          await storage.saveDeveloperGenerationStep(params.userId, step);
        } catch {
          // Preserve the operation's original error even if diagnostic storage
          // is unavailable while recording the failed step.
        }
        try {
          await recorder.fail(error);
        } catch {
          // The original operation error is the useful error for the caller.
        }
        throw error;
      }
    },

    async complete() {
      if (failed || run.status === 'failed') return;
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      run.durationMs = durationSince(run.startedAt);
      delete run.currentStep;
      await storage.saveDeveloperGenerationRun(params.userId, run);
    },

    async fail(error) {
      if (run.status === 'failed') return;
      failed = true;
      run.status = 'failed';
      run.completedAt = new Date().toISOString();
      run.durationMs = durationSince(run.startedAt);
      run.error = errorMessage(error);
      await storage.saveDeveloperGenerationRun(params.userId, run);
    },
  };

  return recorder;
}

function valueHasString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate ? candidate : undefined;
}

export async function recordDeveloperGenerationStep<T>(
  recorder: DeveloperGenerationRecorder | undefined,
  metadata: DeveloperGenerationStepMetadata,
  operation: () => Promise<T> | T,
): Promise<T> {
  return recorder ? recorder.step(metadata, operation) : operation();
}

export function attachDeveloperGenerationError(
  error: unknown,
  recorder: DeveloperGenerationRecorder,
): Error {
  const result = error instanceof Error ? error : new Error(errorMessage(error));
  Object.assign(result, {
    generationRunId: recorder.run.id,
    projectId: recorder.run.projectId,
  });
  return result;
}
