import { Project } from '@/types/clarity';
import {
  agentNames,
  attentionAgentOutputSchema,
  AttentionAgentOutput,
  AttentionRecommendation,
  validateStructuredOutput,
} from '@/lib/agents/schemas';
import { rankGaps } from '@/lib/tools/graphTools';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';

const attentionModelConfig = getAgentModelConfig('attention');

export const attentionAgentDefinition = {
  name: agentNames.attention,
  model: attentionModelConfig.model,
  thinkingLevel: attentionModelConfig.thinkingLevel,
  maxOutputTokens: attentionModelConfig.maxOutputTokens,
  description: 'Generates explainable recommendations about what deserves attention now.',
  adkReady: true,
};

function scoreRecommendation(gapPriority: number, actionability: number, effort: number): number {
  const score =
    0.25 * 0.9 +
    0.2 * gapPriority +
    0.15 * 0.7 +
    0.15 * actionability +
    0.1 * 0.75 +
    0.1 * gapPriority +
    0.05 * 0.6 -
    0.1 * effort;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

export function runAttentionAgent(project: Project): AttentionAgentOutput {
  const recommendations: AttentionRecommendation[] = rankGaps(project)
    .slice(0, 5)
    .map((gap, index) => ({
      id: `rec_${gap.node_id}`,
      title: index === 0 ? 'Resolve the top clarity gap' : 'Review unresolved project uncertainty',
      rationale: gap.reasons[0] ?? 'This uncertainty affects the project plan.',
      score: scoreRecommendation(gap.priority, gap.answerability, gap.interruption_cost),
      sourceNodeIds: [gap.node_id, ...gap.blocked_decision_ids],
      nextAction: gap.question,
    }));

  return validateStructuredOutput(attentionAgentOutputSchema, { recommendations });
}
