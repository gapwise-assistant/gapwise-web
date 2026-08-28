import { CandidateGap, Project, UserMemoryProfile } from '@/types/clarity';
import { agentNames, gapAgentOutputSchema, GapAgentOutput, validateStructuredOutput } from '@/lib/agents/schemas';
import { retrieveRelevantSources } from '@/lib/tools/contextTools';
import { rankGaps } from '@/lib/tools/graphTools';
import { getAgentModelConfig, getGapEscalationPolicy } from '@/lib/agents/modelPolicy';

const gapModelConfig = getAgentModelConfig('gap');

export const gapAgentDefinition = {
  name: agentNames.gap,
  model: gapModelConfig.model,
  thinkingLevel: gapModelConfig.thinkingLevel,
  maxOutputTokens: gapModelConfig.maxOutputTokens,
  description: 'Ranks unresolved uncertainty and avoids asking questions already answered by retrieved context.',
  adkReady: true,
};

export interface GapEscalationAssessment {
  shouldEscalate: boolean;
  reasons: string[];
}

/**
 * Decide whether a stronger Gap Agent pass would be valuable. This only
 * returns routing metadata today; the deterministic demo never retries or
 * calls Gemini. The eventual live runner can use the same assessment to retry
 * with getGapEscalationModelConfig().
 */
export function assessGapEscalation(project: Project, candidates: CandidateGap[]): GapEscalationAssessment {
  const policy = getGapEscalationPolicy();
  const top = candidates[0];
  if (!top) return { shouldEscalate: false, reasons: [] };

  const reasons: string[] = [];
  const second = candidates[1];
  if (second && top.priority - second.priority <= policy.closeCandidateMargin) {
    reasons.push('multiple high-value gaps are close in priority');
  }
  if (top.uncertainty >= 1 - policy.lowConfidenceThreshold) {
    reasons.push('selected gap confidence is low');
  }
  if (top.downstream_impact >= policy.highImpactThreshold) {
    reasons.push('selected gap has high downstream impact');
  }
  const relatedEdges = project.edges.filter((edge) =>
    (edge.source === top.node_id || edge.target === top.node_id) &&
    ['blocks', 'depends_on', 'informs', 'contradicts'].includes(edge.type)
  );
  if (relatedEdges.length >= policy.complexPathThreshold) {
    reasons.push('reasoning path has multiple dependencies or conflicts');
  }

  if (!reasons.length) return { shouldEscalate: false, reasons: [] };
  return {
    shouldEscalate: policy.enabled && policy.maxRetries > 0,
    reasons: policy.enabled
      ? reasons
      : [...reasons, 'escalation is disabled by default'],
  };
}

export function runGapAgent(project: Project, profile?: UserMemoryProfile): GapAgentOutput {
  const [topGap] = rankGaps(project, profile);
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
