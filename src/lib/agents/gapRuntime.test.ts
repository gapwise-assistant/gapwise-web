import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assessGapsV1Deterministically } from '@/lib/agents/gapAssessmentV1';
import { evaluateGapRuntime, getGapAgentRuntimeMode } from '@/lib/agents/gapRuntime';
import { requestGapAssessment } from '@/lib/agents/gapRemote';
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
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('compares a valid shadow result without changing the effective selection', async () => {
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const assessment = assessGapsV1Deterministically(input);
    mockedRequest.mockResolvedValue({ assessment, metadata: metadata() });
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user', mode: 'shadow' });
    expect(result.agentGapNodeId).toBe(result.deterministicGapNodeId);
    expect(result.effectiveGapNodeId).toBe(result.deterministicGapNodeId);
    expect(result.comparison.agreement).toBe(true);
    expect(result.fallbackUsed).toBe(false);
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
    mockedRequest.mockResolvedValue({ assessment: liveAssessment, metadata: metadata() });
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user', mode: 'live' });
    expect(result.agentGapNodeId).toBe(alternative.sourceUnknownNodeIds[0]);
    expect(result.effectiveGapNodeId).toBe(alternative.sourceUnknownNodeIds[0]);
    expect(result.comparison.agreement).toBe(false);
    expect(result.fallbackUsed).toBe(false);
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
    mockedRequest.mockResolvedValue({ assessment: invalid, metadata: metadata() });
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user', mode: 'live' });
    expect(result.fallbackUsed).toBe(true);
    expect(result.effectiveGapNodeId).toBe(result.deterministicGapNodeId);
    expect(result.comparison.failureReason).toBe('graph_reference');
  });

  it('forces deterministic mode when demo mode is enabled', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const input = materializeCareerGapCase(CAREER_GAP_GOLDEN_SET[0]);
    const result = await evaluateGapRuntime({ ...input, userId: 'test-user', mode: 'live' });
    expect(result.mode).toBe('deterministic');
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
