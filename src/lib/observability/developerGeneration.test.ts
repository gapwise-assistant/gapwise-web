import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { MockStorageProvider } from '@/lib/storage/mock';
import {
  attachDeveloperGenerationError,
  startDeveloperGenerationRun,
} from '@/lib/observability/developerGeneration';

const tempDirectories: string[] = [];

async function makeStorage(): Promise<{ storage: MockStorageProvider; filePath: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-generation-trace-'));
  tempDirectories.push(directory);
  const filePath = path.join(directory, 'storage.json');
  return { storage: new MockStorageProvider(filePath), filePath };
}

function project() {
  return createProjectFromInput(
    { name: 'Trace test project', goal: 'Verify a persisted generation timeline.' },
    '2026-08-27T12:00:00.000Z',
  );
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('developer generation recorder', () => {
  it('persists ordered completed steps for one project and survives a provider restart', async () => {
    const { storage, filePath } = await makeStorage();
    const currentProject = project();
    await storage.saveProject('trace-user', currentProject);

    const recorder = await startDeveloperGenerationRun({
      userId: 'trace-user',
      projectId: currentProject.id,
      generator: 'Trace test generator',
      storage,
    });
    await recorder.step({ name: 'Project created in memory', category: 'project' }, () => currentProject);
    await recorder.step({ name: 'Initial project saved', category: 'storage' }, async () => {
      await storage.saveProject('trace-user', currentProject);
      return currentProject;
    });
    await recorder.complete();

    const restartedStorage = new MockStorageProvider(filePath);
    const runs = await restartedStorage.listDeveloperGenerationRuns('trace-user', currentProject.id);
    const steps = await restartedStorage.getDeveloperGenerationSteps('trace-user', recorder.run.id);

    expect(runs).toEqual([expect.objectContaining({
      id: recorder.run.id,
      projectId: currentProject.id,
      status: 'completed',
    })]);
    expect(steps.map((step) => [step.sequence, step.name, step.status, step.projectId])).toEqual([
      [1, 'Project created in memory', 'completed', currentProject.id],
      [2, 'Initial project saved', 'completed', currentProject.id],
    ]);
    expect(JSON.stringify({ runs, steps })).not.toContain(currentProject.goal);
    expect(JSON.stringify({ runs, steps })).not.toContain('prompt');
    expect(JSON.stringify({ runs, steps })).not.toContain('response');
  });

  it('keeps earlier steps, records the failing middle step, and omits later steps', async () => {
    const { storage } = await makeStorage();
    const currentProject = project();
    await storage.saveProject('trace-user', currentProject);
    const recorder = await startDeveloperGenerationRun({
      userId: 'trace-user', projectId: currentProject.id, generator: 'Trace failure generator', storage,
    });

    await recorder.step({ name: 'First operation', category: 'project' }, () => undefined);
    await expect(recorder.step({ name: 'Save project to Firestore', category: 'storage' }, async () => {
      throw new Error('Firestore write failed');
    })).rejects.toThrow('Firestore write failed');
    await expect(recorder.step({ name: 'Should not run', category: 'validation' }, () => undefined)).rejects.toThrow('already failed');

    const run = await storage.getDeveloperGenerationRun('trace-user', recorder.run.id);
    const steps = await storage.getDeveloperGenerationSteps('trace-user', recorder.run.id);
    expect(run).toMatchObject({ status: 'failed', projectId: currentProject.id, error: 'Firestore write failed' });
    expect(steps.map((step) => [step.sequence, step.name, step.status, step.error])).toEqual([
      [1, 'First operation', 'completed', undefined],
      [2, 'Save project to Firestore', 'failed', 'Firestore write failed'],
    ]);
    expect(steps.some((step) => step.name === 'Should not run')).toBe(false);

    const returnedError = attachDeveloperGenerationError(new Error('Firestore write failed'), recorder);
    expect(returnedError).toMatchObject({ generationRunId: recorder.run.id, projectId: currentProject.id });
  });
});
