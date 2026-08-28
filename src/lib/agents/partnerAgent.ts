import { Project, UserMemoryProfile } from '@/types/clarity';
import { AttentionAgentOutput, agentNames, GapAgentOutput, partnerAgentOutputSchema, PartnerAgentOutput, validateStructuredOutput } from '@/lib/agents/schemas';
import { questionPriorityThreshold } from '@/lib/personalization/preferences';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { rankGaps } from '@/lib/tools/graphTools';

const partnerModelConfig = getAgentModelConfig('partner');

export const partnerAgentDefinition = {
  name: agentNames.partner,
  model: partnerModelConfig.model,
  thinkingLevel: partnerModelConfig.thinkingLevel,
  maxOutputTokens: partnerModelConfig.maxOutputTokens,
  description: 'Chooses one question or action and communicates according to user preferences.',
  adkReady: true,
};

export function runPartnerAgent(
  project: Project,
  profile: UserMemoryProfile,
  gapOutput: GapAgentOutput,
  attentionOutput: AttentionAgentOutput
): PartnerAgentOutput {
  const threshold = questionPriorityThreshold(profile);
  const selectedGap = gapOutput.selectedGapNodeId
    ? rankGaps(project, profile).find((gap) => gap.node_id === gapOutput.selectedGapNodeId)
    : undefined;
  const decisionValueLevel = selectedGap?.decision_value?.level;
  const decisionValueAllowsQuestion = decisionValueLevel === 'high'
    || (profile.question_frequency !== 'low' && decisionValueLevel === 'medium');
  if (
    gapOutput.question &&
    gapOutput.selectedGapNodeId &&
    ((gapOutput.priority ?? 0) >= threshold || decisionValueAllowsQuestion)
  ) {
    return validateStructuredOutput(partnerAgentOutputSchema, {
      mode: 'ask_question',
      message:
        profile.answer_density === 'concise'
          ? gapOutput.question
          : `The next best question is: ${gapOutput.question}`,
      question: gapOutput.question,
      action: null,
      citedNodeIds: [gapOutput.selectedGapNodeId],
    });
  }

  const topRecommendation = attentionOutput.recommendations[0];
  if (topRecommendation) {
    return validateStructuredOutput(partnerAgentOutputSchema, {
      mode: 'recommend_action',
      message: topRecommendation.nextAction,
      question: null,
      action: topRecommendation.nextAction,
      citedNodeIds: topRecommendation.sourceNodeIds,
    });
  }

  return validateStructuredOutput(partnerAgentOutputSchema, {
    mode: 'acknowledge',
    message: `No critical unresolved gaps remain for ${project.title}.`,
    question: null,
    action: null,
    citedNodeIds: [],
  });
}
