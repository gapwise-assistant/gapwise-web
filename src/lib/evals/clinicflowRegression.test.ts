import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { clinicFlowBaselineSources, clinicFlowRetryTestSource, CLINICFLOW_NODE_IDS, CLINICFLOW_REGRESSION_PROJECT_ID, CLINICFLOW_REGRESSION_USER_ID, createClinicFlowRegressionProject } from '@/lib/evals/clinicflowRegression';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { generateDailyBrief, clearBriefStoreForTests } from '@/lib/attention/generateBrief';
import { buildTodayQuestions } from '@/lib/today/sections';
import { rankGaps } from '@/lib/tools/graphTools';
import { MockStorageProvider } from '@/lib/storage/mock';
import { askGapswiseLocally } from '@/lib/ask/localDemoAdapter';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { ingestContextSource } from '@/lib/context/ingestion';
import type { DurableMemory } from '@/types/contextPack';
import type { Project } from '@/types/clarity';

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
const originalStorageMode = process.env.USE_FIRESTORE;
const originalMockPath = process.env.GAPSWISE_MOCK_STORAGE_PATH;
const tempDirectories: string[] = [];

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function openQuestionIds(project: Project): string[] {
  return project.nodes
    .filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN')
    .map((node) => node.id);
}

function canonicalNodeKeys(project: Project): string[] {
  return project.nodes.map((node) => `${node.type}:${node.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`);
}

function careerMemory(): DurableMemory {
  return {
    id: 'memory-career-other-project',
    category: 'career',
    text: 'I avoid frontend-heavy roles and prefer backend ownership.',
    source: 'explicit',
    source_refs: ['other-career-source'],
    confidence: 0.95,
    created_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-20T10:00:00.000Z',
    last_confirmed_at: '2026-08-20T10:00:00.000Z',
    why_remembered: 'A separate career project preference; it must not leak into ClinicFlow.',
  };
}

afterEach(async () => {
  restoreEnv('GAPSWISE_DEMO_MODE', originalDemoMode);
  restoreEnv('USE_FIRESTORE', originalStorageMode);
  restoreEnv('GAPSWISE_MOCK_STORAGE_PATH', originalMockPath);
  clearBriefStoreForTests();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('ClinicFlow complete deterministic regression scenario', () => {
  it('ingests messy context, ranks the highest-value gap, updates Today/Ask, and persists the transition', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    process.env.USE_FIRESTORE = 'false';

    let project = createClinicFlowRegressionProject();
    expect(project.id).toBe(CLINICFLOW_REGRESSION_PROJECT_ID);

    const baselineSnapshots: Array<{ filename: string; sourceNodeCount: number; openQuestionCount: number }> = [];
    for (const source of clinicFlowBaselineSources()) {
      const result = await processContextSource(project, source, DEFAULT_USER_PROFILE);
      expect(result.skipped).toBe(false);
      project = result.project;
      const storedSource = project.sources.find((candidate) => candidate.id === source.sourceId);
      expect(storedSource).toMatchObject({
        filename: source.filename,
        processing_status: 'completed',
        extraction_hash: source.extractionHash,
      });
      expect(storedSource?.derived_node_ids.length).toBeGreaterThan(0);
      expect(storedSource?.derived_node_ids.every((id) => project.nodes.some((node) => node.id === id))).toBe(true);
      baselineSnapshots.push({
        filename: source.filename,
        sourceNodeCount: storedSource?.derived_node_ids.length ?? 0,
        openQuestionCount: openQuestionIds(project).length,
      });
    }

    expect(baselineSnapshots).toHaveLength(4);
    expect(new Set(canonicalNodeKeys(project)).size).toBe(project.nodes.length);
    expect(project.sources).toHaveLength(4);
    expect(project.nodes.find((node) => node.id === CLINICFLOW_NODE_IDS.decision)?.status).toBe('OPEN');
    expect(project.nodes.find((node) => node.id === CLINICFLOW_NODE_IDS.retry)?.status).toBe('OPEN');
    expect(project.nodes.find((node) => node.id === CLINICFLOW_NODE_IDS.sms)?.status).toBe('OPEN');
    expect(project.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: CLINICFLOW_NODE_IDS.retry, target: CLINICFLOW_NODE_IDS.decision, type: 'blocks' }),
      expect.objectContaining({ source: CLINICFLOW_NODE_IDS.sms, target: CLINICFLOW_NODE_IDS.decision, type: 'blocks' }),
    ]));

    const baselineRanking = rankGaps(project);
    expect(baselineRanking.length).toBeGreaterThanOrEqual(4);
    const baselineTop = baselineRanking[0];
    expect(baselineTop?.blocked_decision_ids).toContain(CLINICFLOW_NODE_IDS.decision);
    expect(baselineTop?.decision_value?.affected_targets.some((target) => target.node_id === CLINICFLOW_NODE_IDS.decision)).toBe(true);
    expect(baselineTop?.decision_value?.reason).toBeTruthy();

    // The hash guard is part of the workflow: retrying the same upload is a no-op.
    const duplicate = await processContextSource(project, clinicFlowBaselineSources()[0], DEFAULT_USER_PROFILE);
    expect(duplicate.skipped).toBe(true);
    expect(duplicate.project.sources).toHaveLength(4);
    expect(duplicate.project.nodes).toHaveLength(project.nodes.length);

    const followUp = clinicFlowRetryTestSource();
    const afterRetryEvidence = await processContextSource(project, followUp, DEFAULT_USER_PROFILE);
    expect(afterRetryEvidence.skipped).toBe(false);
    project = afterRetryEvidence.project;
    expect(project.sources).toHaveLength(5);
    expect(project.nodes.find((node) => node.id === CLINICFLOW_NODE_IDS.retry)?.status).toBe('RESOLVED');
    expect(project.nodes.find((node) => node.id === CLINICFLOW_NODE_IDS.retry)?.source_refs).toContain(followUp.sourceId);
    expect(project.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: CLINICFLOW_NODE_IDS.retryTest, target: CLINICFLOW_NODE_IDS.retry, type: 'resolves' }),
    ]));

    const afterRanking = rankGaps(project);
    expect(afterRanking.every((candidate) => candidate.node_id !== CLINICFLOW_NODE_IDS.retry)).toBe(true);
    expect(afterRanking[0]?.node_id).not.toBe(baselineTop?.node_id);
    expect(afterRanking[0]?.decision_value?.reason).toBeTruthy();

    const now = new Date('2026-08-21T18:00:00.000Z');
    const scopedPack = buildContextPack({
      userId: CLINICFLOW_REGRESSION_USER_ID,
      query: 'After the offline retry test, what should be the next ClinicFlow launch gate?',
      project: afterRetryEvidence.project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [],
      scope: { type: 'project', projectId: project.id },
    });
    expect(scopedPack.recentlyResolvedGaps.some((gap) => gap.id === CLINICFLOW_NODE_IDS.retry)).toBe(true);
    expect(scopedPack.unresolvedGaps.some((gap) => gap.id === CLINICFLOW_NODE_IDS.sms)).toBe(true);
    expect(scopedPack.relevantEvidence.some((source) => source.filename === '05-offline-retry-test-results.md')).toBe(true);
    expect(scopedPack.relevantEvidence.every((source) => source.source_id.startsWith('clinic_src_'))).toBe(true);

    const brief = generateDailyBrief({
      userId: CLINICFLOW_REGRESSION_USER_ID,
      project,
      memories: [],
      contextPack: scopedPack,
      now,
      period: '2026-08-21',
      force: true,
    });
    const todayQuestions = buildTodayQuestions({ project, brief, now });
    expect(todayQuestions.length).toBeGreaterThan(0);
    expect(todayQuestions.some((question) => question.sourceNodeIds.includes(CLINICFLOW_NODE_IDS.sms))).toBe(true);
    expect(todayQuestions.some((question) => question.sourceNodeIds.includes(CLINICFLOW_NODE_IDS.retry))).toBe(false);
    expect(brief.recommendations.some((recommendation) => recommendation.source_node_ids.includes(CLINICFLOW_NODE_IDS.sms))).toBe(true);

    const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-clinicflow-regression-'));
    tempDirectories.push(directory);
    const storagePath = path.join(directory, 'state.json');
    process.env.GAPSWISE_MOCK_STORAGE_PATH = storagePath;
    const storage = new MockStorageProvider(storagePath);
    await storage.saveProject(CLINICFLOW_REGRESSION_USER_ID, project);

    const unrelated = await ingestContextSource(
      createProjectFromInput({ name: 'Career notes', goal: 'Find a backend role.' }, '2026-08-20T11:00:00.000Z'),
      {
        sourceId: 'other-career-source',
        filename: 'career-preference.txt',
        type: 'text',
        content: 'I avoid frontend-heavy roles and prefer backend ownership.',
        derivedNodes: [{ type: 'PREFERENCE', text: 'Avoid frontend-heavy roles.', confidence: 0.95, impact: 0.8 }],
      },
      DEFAULT_USER_PROFILE,
    );
    await storage.saveProject(CLINICFLOW_REGRESSION_USER_ID, unrelated);
    await storage.replaceMemories(CLINICFLOW_REGRESSION_USER_ID, [careerMemory()]);

    const restarted = new MockStorageProvider(storagePath);
    const reloaded = await restarted.getProject(CLINICFLOW_REGRESSION_USER_ID, project.id);
    expect(reloaded?.nodes.find((node) => node.id === CLINICFLOW_NODE_IDS.retry)?.status).toBe('RESOLVED');
    expect(reloaded?.sources.map((source) => source.id)).toEqual(expect.arrayContaining([
      'clinic_src_pilot_brief', 'clinic_src_clinical_notes', 'clinic_src_vendor_review', 'clinic_src_steering_update', followUp.sourceId,
    ]));
    expect((await restarted.listProjects(CLINICFLOW_REGRESSION_USER_ID)).map((item) => item.id)).toEqual(expect.arrayContaining([
      project.id,
      unrelated.id,
    ]));

    const askResult = await askGapswiseLocally({
      userId: CLINICFLOW_REGRESSION_USER_ID,
      projectId: project.id,
      message: 'What changed after the offline retry test, and what should we clarify next for ClinicFlow?',
    });
    expect(askResult.contextUsed?.projectTitle).toBe(project.title);
    expect(askResult.promptUsed).toContain('ClinicFlow');
    expect(askResult.promptUsed).toContain('offline retry');
    expect(askResult.sources.some((source) => source.title === 'career-preference.txt')).toBe(false);
    expect(askResult.sources.every((source) => source.id !== 'other-career-source')).toBe(true);
  });
});
