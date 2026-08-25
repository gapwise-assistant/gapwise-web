import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import {
  clearProjectOverviewAssessmentInFlightForTests,
  getCachedProjectOverviewAssessment,
} from '@/lib/overview/projectOverviewCache';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';
import type { ProjectOverviewAssessmentCacheRecord, StorageProvider } from '@/lib/storage/types';

function makeAssessment(): ProjectOverviewAssessment {
  return {
    trajectory: { state: 'exploring', explanation: 'The project is still being shaped.' },
    summary: 'The project is still being shaped.',
    meaningfulChanges: [],
    goalImpact: { summary: 'The goal remains open.', positiveFactors: [], negativeFactors: [] },
    unsettled: [],
    criticalIssues: [],
    emergingInsights: [],
    confidence: 0.7,
  };
}

describe('Project Overview assessment cache', () => {
  beforeEach(() => {
    clearProjectOverviewAssessmentInFlightForTests();
  });

  it('reuses the same semantic assessment and invalidates after a meaningful node change', async () => {
    const project = createProjectFromInput({
      name: 'Test project',
      goal: 'Complete a reliable first release.',
    }, '2026-08-24T10:00:00.000Z');
    const records = new Map<string, ProjectOverviewAssessmentCacheRecord>();
    const storage = {
      getProjectOverviewAssessment: vi.fn(async (_userId: string, id: string) => records.get(id) ?? null),
      saveProjectOverviewAssessment: vi.fn(async (_userId: string, record: ProjectOverviewAssessmentCacheRecord) => {
        records.set(record.id, record);
      }),
    } as unknown as StorageProvider;
    const generate = vi.fn(async () => makeAssessment());

    await getCachedProjectOverviewAssessment('overview-user', project, [], null, undefined, { storage, generate });
    await getCachedProjectOverviewAssessment('overview-user', project, [], null, undefined, { storage, generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(storage.saveProjectOverviewAssessment).toHaveBeenCalledTimes(1);

    project.goal = 'Complete a reliable first release for a real pilot.';
    await getCachedProjectOverviewAssessment('overview-user', project, [], null, undefined, { storage, generate });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(storage.saveProjectOverviewAssessment).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight generation for the same semantic state', async () => {
    const project = createProjectFromInput({
      name: 'Test project',
      goal: 'Complete a reliable first release.',
    }, '2026-08-24T10:00:00.000Z');
    const storage = {
      getProjectOverviewAssessment: vi.fn(async () => null),
      saveProjectOverviewAssessment: vi.fn(async () => undefined),
    } as unknown as StorageProvider;
    let release: (() => void) | undefined;
    const generate = vi.fn(() => new Promise<ProjectOverviewAssessment>((resolve) => {
      release = () => resolve(makeAssessment());
    }));

    const first = getCachedProjectOverviewAssessment('overview-user', project, [], null, undefined, { storage, generate });
    const second = getCachedProjectOverviewAssessment('overview-user', project, [], null, undefined, { storage, generate });
    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(1);
    });
    expect(generate).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.all([first, second]);
  });
});
