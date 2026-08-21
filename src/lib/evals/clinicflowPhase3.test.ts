import { afterEach, describe, expect, it } from 'vitest';
import { ingestContextSource } from '@/lib/context/ingestion';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { assessGapsV1Deterministically } from '@/lib/agents/gapAssessmentV1';
import { validateGapAssessmentAgainstProject } from '@/lib/agents/gapContractV1';
import { evaluateGapRuntime, refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { clinicFlowBaselineSources, clinicFlowRetryTestSource, CLINICFLOW_NODE_IDS, CLINICFLOW_REGRESSION_PROJECT_ID, createClinicFlowRegressionProject } from '@/lib/evals/clinicflowRegression';
import { clearTracesForTests, listTraces } from '@/lib/observability/trace';
import { createProjectFromInput } from '@/lib/projects/createProject';
import type { DurableMemory } from '@/types/contextPack';
import type { Project } from '@/types/clarity';

const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

function restoreDemoMode(): void {
  if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
  else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
}

async function materializeClinicFlow(): Promise<Project> {
  let project = createClinicFlowRegressionProject();
  for (const source of clinicFlowBaselineSources()) {
    project = await ingestContextSource(project, source, DEFAULT_USER_PROFILE);
  }
  project = await ingestContextSource(project, clinicFlowRetryTestSource(), DEFAULT_USER_PROFILE);
  return project;
}

function otherProjectMemory(): DurableMemory {
  return {
    id: 'phase3-other-project-memory',
    category: 'career',
    text: 'I avoid frontend-heavy roles and prefer backend ownership.',
    source: 'explicit',
    source_refs: ['phase3-other-source'],
    confidence: 0.95,
    created_at: '2026-08-21T10:00:00.000Z',
    updated_at: '2026-08-21T10:00:00.000Z',
    last_confirmed_at: '2026-08-21T10:00:00.000Z',
    why_remembered: 'Belongs to another project.',
  };
}

afterEach(() => {
  restoreDemoMode();
  clearTracesForTests();
});

describe('ClinicFlow Phase 3 retrieval and Gap Agent evaluation', () => {
  it('retrieves the right project evidence and keeps temporal source intent precise', async () => {
    const project = await materializeClinicFlow();
    const query = 'After the offline retry test, what is the next ClinicFlow launch gate?';
    const pack = buildContextPack({
      userId: 'clinicflow-phase3-user',
      query,
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [otherProjectMemory()],
      scope: { type: 'project', projectId: project.id },
    });

    expect(project.id).toBe(CLINICFLOW_REGRESSION_PROJECT_ID);
    expect(pack.activeGoals[0]?.id).toBe(`goal_${project.id}`);
    expect(pack.recentlyResolvedGaps.map((gap) => gap.id)).toContain(CLINICFLOW_NODE_IDS.retry);
    expect(pack.unresolvedGaps.map((gap) => gap.id)).toContain(CLINICFLOW_NODE_IDS.sms);
    expect(pack.userPreferences).toEqual([]);
    expect(pack.relevantEvidence.some((source) => source.source_id === 'clinic_src_retry_test_results')).toBe(true);
    expect(pack.relevantEvidence.every((source) => source.source_id.startsWith('clinic_src_'))).toBe(true);
    expect(pack.includedContextIds).not.toContain('phase3-other-project-memory');

    const latestDocumentPack = buildContextPack({
      userId: 'clinicflow-phase3-user',
      query: 'What does my latest document say about offline retry records?',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [],
      scope: { type: 'project', projectId: project.id },
    });
    expect(latestDocumentPack.relevantEvidence.map((source) => source.filename)).toEqual([
      '05-offline-retry-test-results.md',
    ]);
  });

  it('enforces the Gap Agent V1 contract and suppresses the answered retry gap', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const project = await materializeClinicFlow();
    const contextPack = buildContextPack({
      userId: 'clinicflow-phase3-user',
      query: 'Select the smallest unresolved fact that could change the ClinicFlow launch decision next.',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [],
      scope: { type: 'project', projectId: project.id },
    });

    const assessment = assessGapsV1Deterministically({ project, contextPack, memories: [] });
    const validated = validateGapAssessmentAgainstProject(assessment, project);
    const selected = validated.candidates.find((candidate) => candidate.gapId === validated.selectedGapId);
    const retry = validated.candidates.find((candidate) => candidate.sourceUnknownNodeIds.includes(CLINICFLOW_NODE_IDS.retry));

    expect(selected).toBeTruthy();
    expect(selected?.suppressionReason).toBeNull();
    expect(selected?.affectedDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ decisionId: CLINICFLOW_NODE_IDS.decision }),
    ]));
    expect(selected?.evidenceReview.evidenceIds.length).toBeGreaterThan(0);
    expect(selected?.acquisitionPath).toBeTruthy();
    expect(selected?.question).not.toMatch(/^what should i (do|know|clarify)\??$/i);
    expect(retry?.evidenceReview.answerability).toBe('answered');
    expect(retry?.suppressionReason).toBe('already_answered');
    expect(validated.suppressedGapIds).toContain(retry?.gapId);
  });

  it('does not let an unrelated graph question leak past the retrieved Context Pack', async () => {
    const project = await materializeClinicFlow();
    project.nodes.push({
      id: 'clinicflow_unrelated_question',
      type: 'UNKNOWN',
      text: 'Which patient education colors should the future marketing site use?',
      status: 'OPEN',
      confidence: 0.1,
      impact: 0.95,
      priority: 0.4,
      source_refs: [],
      why_it_matters: ['A separate future marketing project.'],
      created_by: 'user',
      created_at: '2026-08-21T10:00:00.000Z',
      updated_at: '2026-08-21T10:00:00.000Z',
    });
    project.edges.push({
      id: 'clinicflow_unrelated_question_edge',
      source: 'clinicflow_unrelated_question',
      target: CLINICFLOW_NODE_IDS.decision,
      type: 'blocks',
    });
    const contextPack = buildContextPack({
      userId: 'clinicflow-phase3-user',
      query: 'What should we verify about offline retry safety before launch?',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [],
      scope: { type: 'project', projectId: project.id },
    });

    const assessment = assessGapsV1Deterministically({ project, contextPack, memories: [] });
    expect(assessment.candidates.some((candidate) => candidate.sourceUnknownNodeIds.includes('clinicflow_unrelated_question'))).toBe(false);
    expect(assessment.candidates.filter((candidate) => candidate.suppressionReason === null).length).toBeGreaterThan(0);
  });

  it('recognizes a clear affirmative retrieved result without inventing a user answer', async () => {
    const project = await materializeClinicFlow();
    const sms = project.nodes.find((node) => node.id === CLINICFLOW_NODE_IDS.sms)!;
    project.sources.push({
      id: 'clinic_src_sms_approval',
      filename: 'legal-sms-approval.md',
      type: 'text',
      content: 'Legal approved the SMS consent language for PHI-related intake on August 20.',
      extracted_at: '2026-08-20T12:00:00.000Z',
      derived_node_ids: [sms.id],
    });
    sms.source_refs.push('clinic_src_sms_approval');
    const contextPack = buildContextPack({
      userId: 'clinicflow-phase3-user',
      query: 'Has legal approved the SMS consent language for PHI-related intake?',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [],
      scope: { type: 'project', projectId: project.id },
    });
    const assessment = assessGapsV1Deterministically({ project, contextPack, memories: [] });
    const smsCandidate = assessment.candidates.find((candidate) => candidate.sourceUnknownNodeIds.includes(CLINICFLOW_NODE_IDS.sms));

    expect(smsCandidate?.evidenceReview.answerability).toBe('answered');
    expect(smsCandidate?.suppressionReason).toBe('already_answered');
  });

  it('keeps demo runtime deterministic and does not fabricate an AI run', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const project = await materializeClinicFlow();
    const contextPack = buildContextPack({
      userId: 'clinicflow-phase3-user',
      query: 'What should we resolve next before the ClinicFlow go/no-go decision?',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [],
      scope: { type: 'project', projectId: project.id },
    });

    const runtime = await evaluateGapRuntime({
      userId: 'clinicflow-phase3-user',
      project,
      contextPack,
      memories: [],
      mode: 'deterministic',
    });

    expect(runtime.mode).toBe('deterministic');
    expect(runtime.metadata).toBeNull();
    expect(runtime.agentAssessment).toBeNull();
    expect(runtime.comparison.validationStatus).toBe('not_run');
    expect(runtime.effectiveGapNodeId).toBeTruthy();
    expect(listTraces('clinicflow-phase3-user')).toEqual([]);
  });

  it('builds and records the local Gap Agent selection after ingestion without a provider call', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const project = await materializeClinicFlow();
    const refreshed = await refreshProjectGapRuntime({
      userId: 'clinicflow-phase3-user',
      project,
      memories: [],
      route: '/api/context/ingest',
      label: 'Gap Agent after context ingestion',
    });

    expect(refreshed.runtime?.mode).toBe('deterministic');
    expect(refreshed.runtime?.metadata).toBeNull();
    expect(refreshed.project.active_question?.node_id).toBe(refreshed.runtime?.effectiveGapNodeId);
    expect(listTraces('clinicflow-phase3-user')).toHaveLength(1);
    expect(listTraces('clinicflow-phase3-user')[0]?.agentRuns ?? []).toEqual([]);
    expect(listTraces('clinicflow-phase3-user')[0]?.gapAnalysis?.selectedGapId).toBe(refreshed.runtime?.effectiveGapNodeId);
  });

  it('keeps a project-scoped pack isolated even when another project shares the user', async () => {
    const project = await materializeClinicFlow();
    const other = await ingestContextSource(
      createProjectFromInput({ name: 'Career notes', goal: 'Find a backend role.' }, '2026-08-21T09:00:00Z'),
      {
        sourceId: 'phase3-other-source',
        filename: 'career-preference.txt',
        type: 'text',
        content: 'I avoid frontend-heavy roles and prefer backend ownership.',
      },
      DEFAULT_USER_PROFILE,
    );

    const pack = buildContextPack({
      userId: 'clinicflow-phase3-user',
      query: 'What should I clarify about the next launch gate?',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [otherProjectMemory()],
      scope: { type: 'project', projectId: project.id },
    });

    expect(other.sources.some((source) => source.id === 'phase3-other-source')).toBe(true);
    expect(pack.relevantEvidence.some((source) => source.source_id === 'phase3-other-source')).toBe(false);
    expect(pack.userPreferences).toEqual([]);
    expect(pack.includedContextIds).not.toContain(other.id);
  });
});
