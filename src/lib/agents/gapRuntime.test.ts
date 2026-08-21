import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assessGapsV1Deterministically } from '@/lib/agents/gapAssessmentV1';
import { evaluateGapRuntime, getGapAgentRuntimeMode, refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { requestGapAssessment, validateGapGuidanceReferences } from '@/lib/agents/gapRemote';
import { CAREER_GAP_GOLDEN_SET } from '@/lib/evals/careerGapGoldenSet';
import { materializeCareerGapCase } from '@/lib/evals/careerGapFixture';

vi.mock('@/lib/agents/gapRemote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/gapRemote')>();
  return { ...actual, requestGapAssessment: vi.fn() };
});

const mockedRequest = vi.mocked(requestGapAssessment);

function metadata() {
  return {
    runId: 'gap_test_run',
    agent: 'Gap Agent' as const,
    model: 'gemini-3.5-flash',
    thinkingLevel: 'high',
    thinkingApplied: true,
    maxOutputTokens: 4096,
    inputTokens: 1200,
    outputTokens: 500,
    latencyMs: 900,
    estimatedCost: null,
    costSource: 'unavailable' as const,
    validationStatus: 'passed' as const,
    confidence: 0.9,
    escalated: false,
    escalationReason: null,
    inputSummary: '30 graph nodes, 30 edges, 12 scoped context IDs',
    outputSummary: '7 candidates; selected one',
  };
}

function recommendationFor(assessment: ReturnType<typeof assessGapsV1Deterministically>) {
  const selected = assessment.candidates.find((candidate) => candidate.gapId === assessment.selectedGapId);
  if (!selected) return null;
  return {
    focus: 'Clarify the most important unresolved decision input.',
    whyNow: 'This answer controls the next live decision.',
    nextStep: 'Get the missing answer and record it in the project.',
    whatCouldChange: 'The answer could change whether the current plan proceeds.',
    supportingIds: [
      ...selected.sourceUnknownNodeIds,
      ...selected.affectedDecisions.map((decision) => decision.decisionId),
      ...selected.evidenceReview.evidenceIds,
    ].filter((id, index, ids) => ids.indexOf(id) === index).slice(0, 6),
    generatedBy: 'gap-agent' as const,
  };
}

describe('Gap Agent runtime modes', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    delete process.env.GAPSWISE_DEMO_MODE;
    delete process.env.GAP_AGENT_MODE;
  });

  afterEach(() => {
    delete process.env.GAPSWISE_DEMO_MODE;
    delete process.env.GAP_AGENT_MODE;
  });

  it('defaults to deterministic and makes no remote call', async () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user' });
    expect(getGapAgentRuntimeMode()).toBe('deterministic');
    expect(result.mode).toBe('deterministic');
    expect(result.comparison.validationStatus).toBe('not_run');
    expect(result.effectiveGuidance?.generatedBy).toBe('deterministic');
    expect(result.effectiveGuidance?.nextStep).toBeTruthy();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('compares a valid shadow result without changing the effective selection', async () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    mockedRequest.mockResolvedValue({ assessment, recommendation: recommendationFor(assessment), metadata: metadata() });
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user', mode: 'shadow' });
    expect(result.agentGapNodeId).toBe(result.deterministicGapNodeId);
    expect(result.effectiveGapNodeId).toBe(result.deterministicGapNodeId);
    expect(result.comparison.agreement).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(result.agentGuidance?.generatedBy).toBe('gap-agent');
    expect(result.effectiveGuidance?.generatedBy).toBe('deterministic');
  });

  it('uses a validated live selection', async () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    const alternative = assessment.candidates.find((candidate) =>
      candidate.suppressionReason === null && candidate.gapId !== assessment.selectedGapId
    )!;
    const liveAssessment = {
      ...assessment,
      selectedGapId: alternative.gapId,
      selectionRationale: 'The alternative is the minimum discriminating live gap.',
    };
    mockedRequest.mockResolvedValue({ assessment: liveAssessment, recommendation: recommendationFor(liveAssessment), metadata: metadata() });
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user', mode: 'live' });
    expect(result.agentGapNodeId).toBe(alternative.sourceUnknownNodeIds[0]);
    expect(result.effectiveGapNodeId).toBe(alternative.sourceUnknownNodeIds[0]);
    expect(result.comparison.agreement).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.effectiveGuidance?.generatedBy).toBe('gap-agent');
  });

  it('recalculates the effective question when a live runtime is refreshed after anchoring', async () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    mockedRequest.mockResolvedValue({ assessment, recommendation: recommendationFor(assessment), metadata: metadata() });
    process.env.GAP_AGENT_MODE = 'live';

    const result = await refreshProjectGapRuntime({
      userId: 'test-user',
      project: input.project,
      profile: undefined,
      memories: input.memories,
      route: '/api/projects/decision-anchor',
      label: 'Gap Agent after decision anchoring',
    });

    expect(result.runtime?.mode).toBe('live');
    expect(result.project.active_question?.node_id).toBe(result.runtime?.effectiveGapNodeId);
    expect(result.project.active_question?.guidance?.generatedBy).toBe('gap-agent');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('falls back deterministically when live graph references are invalid', async () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    const selectedIndex = assessment.candidates.findIndex((candidate) => candidate.gapId === assessment.selectedGapId);
    const invalid = {
      ...assessment,
      candidates: assessment.candidates.map((candidate, index) => index === selectedIndex ? {
        ...candidate,
        affectedDecisions: candidate.affectedDecisions.map((decision) => ({
          ...decision,
          pathNodeIds: [candidate.sourceUnknownNodeIds[0], 'missing_graph_node', decision.decisionId],
        })),
      } : candidate),
    };
    mockedRequest.mockResolvedValue({ assessment: invalid, recommendation: recommendationFor(invalid), metadata: metadata() });
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user', mode: 'live' });
    expect(result.fallbackUsed).toBe(true);
    expect(result.effectiveGapNodeId).toBe(result.deterministicGapNodeId);
    expect(result.comparison.failureReason).toBe('graph_reference');
    expect(result.effectiveGuidance?.generatedBy).toBe('deterministic');
  });

  it('forces deterministic mode when demo mode is enabled', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user', mode: 'live' });
    expect(result.mode).toBe('deterministic');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('rejects user-facing guidance that cites context outside the selected gap', () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    const recommendation = recommendationFor(assessment)!;

    expect(() => validateGapGuidanceReferences({
      assessment,
      recommendation: { ...recommendation, supportingIds: ['unrelated_private_context'] },
      metadata: metadata(),
    })).toThrow(/unrelated project context/i);
  });
});
