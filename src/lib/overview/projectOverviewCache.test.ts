import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import {
  clearProjectOverviewAssessmentInFlightForTests,
  getCachedProjectOverviewAssessment,
  getProjectOverviewAssessmentWithMetadata,
  overviewProjectStateVersion,
} from '@/lib/overview/projectOverviewCache';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';
import type { ProjectOverviewAssessmentCacheRecord, StorageProvider } from '@/lib/storage/types';
import type { ContextPack } from '@/types/contextPack';
import type { ProjectHistoryEvent } from '@/types/clarity';

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

function makeFocus(nodeId: string) {
  return {
    kind: 'question' as const,
    title: 'Resolve the most important open question.',
    sourceNodeIds: [nodeId],
    sourceIds: [],
    actionNodeId: nodeId,
    score: 0.9,
    confidence: 0.9,
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

  it('reports generated then hit for the same persisted semantic state', async () => {
    const project = createProjectFromInput({
      name: 'Metadata project',
      goal: 'Prepare the project for launch.',
    }, '2026-08-24T10:00:00.000Z');
    const records = new Map<string, ProjectOverviewAssessmentCacheRecord>();
    const storage = {
      getProjectOverviewAssessment: vi.fn(async (_userId: string, id: string) => records.get(id) ?? null),
      saveProjectOverviewAssessment: vi.fn(async (_userId: string, record: ProjectOverviewAssessmentCacheRecord) => {
        records.set(record.id, record);
      }),
    } as unknown as StorageProvider;
    const generate = vi.fn(async () => makeAssessment());

    const generated = await getProjectOverviewAssessmentWithMetadata(
      'overview-user',
      project,
      [],
      null,
      undefined,
      { storage, generate },
    );
    const hit = await getProjectOverviewAssessmentWithMetadata(
      'overview-user',
      project,
      [],
      null,
      undefined,
      { storage, generate },
    );

    expect(generated.cache.status).toBe('generated');
    expect(hit.cache).toEqual({
      status: 'hit',
      projectStateVersion: generated.cache.projectStateVersion,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('ignores persistence metadata, event identity, and commitment ordering', async () => {
    const project = createProjectFromInput({
      name: 'Stable state project',
      goal: 'Prepare the project for launch.',
    }, '2026-08-24T10:00:00.000Z');
    const historyEvent: ProjectHistoryEvent = {
      id: 'event-original',
      projectId: project.id,
      createdAt: '2026-08-24T11:00:00.000Z',
      type: 'context_changed',
      title: 'Scope clarified',
      summary: 'The intended scope is clearer.',
      changes: [{ kind: 'updated', text: 'The intended scope is clearer.' }],
    };
    project.historyEvents = [historyEvent];
    const commitment = (id: string, text: string) => ({
      id,
      type: 'NEXT_ACTION' as const,
      text,
      status: 'OPEN' as const,
      confidence: 0.8,
      impact: 0.6,
      source_refs: [],
      created_by: 'agent' as const,
      created_at: '2026-08-24T10:00:00.000Z',
      updated_at: '2026-08-24T10:00:00.000Z',
    });
    const pack = (commitments: ReturnType<typeof commitment>[]) => ({
      upcomingCommitments: commitments,
    } as unknown as ContextPack);
    const focus = makeFocus(project.nodes[0].id);
    const first = await overviewProjectStateVersion(project, project.historyEvents, focus, pack([
      commitment('commitment-2', 'Send the launch checklist.'),
      commitment('commitment-1', 'Confirm the launch owner.'),
    ]));

    project.updated_at = '2026-08-25T15:00:00.000Z';
    historyEvent.id = 'event-new-timestamp';
    historyEvent.createdAt = '2026-08-25T15:00:00.000Z';
    const second = await overviewProjectStateVersion(project, project.historyEvents, {
      ...focus,
      score: 0.1,
      confidence: 0.2,
      whyNow: 'A different generated explanation.',
    }, pack([
      commitment('commitment-1', 'Confirm the launch owner.'),
      commitment('commitment-2', 'Send the launch checklist.'),
    ]));

    expect(second).toBe(first);
  });

  it('invalidates for confirmed answers, node state, relationships, and selected focus changes', async () => {
    const project = createProjectFromInput({
      name: 'Semantic state project',
      goal: 'Prepare the project for launch.',
    }, '2026-08-24T10:00:00.000Z');
    const base = await overviewProjectStateVersion(project);

    project.history.push({
      question: 'Which scope should launch first?',
      answer: 'Launch the smaller scope.',
      timestamp: '2026-08-24T11:00:00.000Z',
      graph_diff_summary: 'Decision resolved.',
    });
    const afterAnswer = await overviewProjectStateVersion(project);
    expect(afterAnswer).not.toBe(base);

    project.nodes.push({
      id: 'open-scope',
      type: 'DECISION',
      text: 'Choose the first launch scope.',
      status: 'OPEN',
      confidence: 0.9,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: project.created_at,
      updated_at: project.updated_at,
    });
    const afterNode = await overviewProjectStateVersion(project);
    expect(afterNode).not.toBe(afterAnswer);

    project.edges.push({
      id: 'goal-affects-scope',
      source: project.nodes[0].id,
      target: 'open-scope',
      type: 'affects',
    });
    const afterEdge = await overviewProjectStateVersion(project);
    expect(afterEdge).not.toBe(afterNode);

    const afterFocus = await overviewProjectStateVersion(project, [], makeFocus('open-scope'));
    expect(afterFocus).not.toBe(afterEdge);
  });
});
