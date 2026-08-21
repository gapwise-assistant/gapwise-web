import { requestGapAssessment } from '@/lib/agents/gapRemote';
import {
  getGapEvaluationProfiles,
  type GapEvaluationProfile,
} from '@/lib/agents/modelPolicy';
import {
  deriveCareerGapAttention,
  deriveCareerGapPartnerAction,
  type CareerGapStrategySummary,
} from '@/lib/evals/careerGapEvaluator';
import type { CareerGapStrategy } from '@/lib/evals/careerGapTypes';

export function createLiveCareerGapStrategy(profile: GapEvaluationProfile): CareerGapStrategy {
  return {
    id: `adk-gap-${profile.id}`,
    label: profile.label,
    async run(input) {
      const result = await requestGapAssessment({
        userId: 'career-gap-evaluation',
        project: input.project,
        contextPack: input.contextPack,
        memories: input.memories,
        evaluationConfig: profile,
      });
      const urgency = deriveCareerGapAttention(input, result.assessment);
      return {
        gapAssessment: result.assessment,
        guidance: result.recommendation,
        attention: { urgency },
        partner: {
          action: deriveCareerGapPartnerAction(result.assessment, urgency),
        },
        runtime: {
          model: result.metadata.model,
          thinkingLevel: result.metadata.thinkingLevel,
          maxOutputTokens: result.metadata.maxOutputTokens,
          inputTokens: result.metadata.inputTokens,
          outputTokens: result.metadata.outputTokens,
          latencyMs: result.metadata.latencyMs,
          estimatedCost: result.metadata.estimatedCost,
          escalated: result.metadata.escalated,
        },
      };
    },
  };
}

export function getLiveCareerGapStrategies(): CareerGapStrategy[] {
  const requested = new Set(
    (process.env.CAREER_GAP_LIVE_PROFILES ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return getGapEvaluationProfiles()
    .filter((profile) => requested.size === 0 || requested.has(profile.id))
    .map(createLiveCareerGapStrategy);
}

export interface CareerGapWinner {
  summary: CareerGapStrategySummary;
  basis: 'estimated_cost' | 'token_proxy';
}

/**
 * Quality is a hard gate. Cost is considered only among passing profiles.
 * Token volume is an explicit proxy when pricing rates are not configured.
 */
export function chooseCheapestPassingCareerGapStrategy(
  summaries: CareerGapStrategySummary[],
): CareerGapWinner | null {
  const passing = summaries.filter((summary) => summary.passed);
  if (passing.length === 0) return null;
  const hasComparableCost = passing.every((summary) => summary.runtime.estimatedCost !== null);
  const sorted = [...passing].sort((left, right) => {
    if (hasComparableCost) {
      return (left.runtime.estimatedCost ?? 0) - (right.runtime.estimatedCost ?? 0);
    }
    const leftTokens = left.runtime.inputTokens + left.runtime.outputTokens;
    const rightTokens = right.runtime.inputTokens + right.runtime.outputTokens;
    return leftTokens - rightTokens || left.runtime.averageLatencyMs - right.runtime.averageLatencyMs;
  });
  return {
    summary: sorted[0],
    basis: hasComparableCost ? 'estimated_cost' : 'token_proxy',
  };
}
