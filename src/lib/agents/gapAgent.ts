import { Project } from '@/types/clarity';
import { agentNames, gapAgentOutputSchema, GapAgentOutput, validateStructuredOutput } from '@/lib/agents/schemas';
import { retrieveRelevantSources } from '@/lib/tools/contextTools';
import { rankGaps } from '@/lib/tools/graphTools';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';

const gapModelConfig = getAgentModelConfig('gap');

export const gapAgentDefinition = {
  name: agentNames.gap,
  model: gapModelConfig.model,
  thinkingLevel: gapModelConfig.thinkingLevel,
  maxOutputTokens: gapModelConfig.maxOutputTokens,
  description: 'Ranks unresolved uncertainty and avoids asking questions already answered by retrieved context.',
  adkReady: true,
};

export function runGapAgent(project: Project): GapAgentOutput {
  const [topGap] = rankGaps(project);
  if (!topGap) {
    return validateStructuredOutput(gapAgentOutputSchema, {
      selectedGapNodeId: null,
      question: null,
      priority: null,
      retrievalAnswered: false,
      reasons: ['No unresolved high-impact gaps remain.'],
    });
  }

  const sources = retrieveRelevantSources(project, topGap.question);
  const retrievalAnswered = sources.some((source) => {
    const sourceText = source.content.toLowerCase();
    const matchedTerms = topGap.question
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 5)
      .filter((term) => sourceText.includes(term));
    return matchedTerms.length >= 3;
  });

  return validateStructuredOutput(gapAgentOutputSchema, {
    selectedGapNodeId: topGap.node_id,
    question: retrievalAnswered ? null : topGap.question,
    priority: topGap.priority,
    retrievalAnswered,
    reasons: retrievalAnswered
      ? [`Retrieved likely answer evidence from ${sources[0]?.filename ?? 'context inbox'}.`]
      : topGap.reasons,
  });
}
