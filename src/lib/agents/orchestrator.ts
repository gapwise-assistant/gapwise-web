import { Project, UserMemoryProfile } from '@/types/clarity';
import { ContextPack, DurableMemory } from '@/types/contextPack';
import { agentNames, OrchestratorTrace, orchestratorTraceSchema, PartnerAgentOutput, validateStructuredOutput } from '@/lib/agents/schemas';
import { runAttentionAgent } from '@/lib/agents/attentionAgent';
import { runContextAgent } from '@/lib/agents/contextAgent';
import { assessGapEscalation, runGapAgent } from '@/lib/agents/gapAgent';
import { assessGapsV1Deterministically, gapAgentOutputFromAssessment, hasLiveDecision } from '@/lib/agents/gapAssessmentV1';
import { runPartnerAgent } from '@/lib/agents/partnerAgent';
import { createGraphNode, rankGaps } from '@/lib/tools/graphTools';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { getAgentModelPolicy, getGapEscalationModelConfig } from '@/lib/agents/modelPolicy';
import type { TraceAgentRun, TraceGapAnalysis, TraceHandoff } from '@/types/observability';
import { decisionValueForTrace } from '@/lib/observability/decisionValueTrace';
import { reconcileQuestionCandidate } from '@/lib/questions/canonical';

export interface AgentTurnResult {
  project: Project;
  partner: PartnerAgentOutput;
  contextPack: ContextPack;
  trace: OrchestratorTrace;
  observability: {
    agentRuns: TraceAgentRun[];
    gapAnalysis: TraceGapAnalysis;
    handoffs: TraceHandoff[];
  };
}

function traceEvent(
  agentName: OrchestratorTrace['agentEvents'][number]['agentName'],
  summary: string,
  contextIds?: string[]
) {
  return {
    agentName,
    summary,
    timestamp: new Date().toISOString(),
    contextIds,
  };
}

export function runGapswiseOrchestrator(
  params: {
    userId: string;
    input: string;
    project: Project;
    profile: UserMemoryProfile;
    durableMemories?: DurableMemory[];
    applyGraphUpdates?: boolean;
  }
): AgentTurnResult {
  const turnId = `turn_${Date.now()}`;
  const policy = getAgentModelPolicy();
  const escalationConfig = getGapEscalationModelConfig();
  const workingProject: Project = JSON.parse(JSON.stringify(params.project));
  const contextStarted = Date.now();
  const contextResult = runContextAgent(params.input, workingProject);
  const contextLatency = Date.now() - contextStarted;

  if (params.applyGraphUpdates) {
    contextResult.graphUpdate.createNodes.forEach((node) => {
      const reconciliation = reconcileQuestionCandidate(node, workingProject);
      const isQuestion = node.type === 'UNKNOWN' || node.type === 'ASSUMPTION';
      createGraphNode(workingProject, {
        type: node.type,
        text: node.text,
        confidence: node.confidence,
        impact: node.impact,
        source_refs: node.sourceRefs,
        ...(isQuestion ? {
          question_role: reconciliation.classification === 'SUBQUESTION'
            ? 'subquestion'
            : reconciliation.classification === 'ASSUMPTION' || node.type === 'ASSUMPTION'
              ? 'assumption'
              : reconciliation.classification === 'RELATED_BUT_DISTINCT'
                ? 'related'
              : 'canonical',
          canonical_question_id: reconciliation.canonicalQuestionId,
          reconciliation_confidence: reconciliation.confidence,
          reconciliation_reason: reconciliation.reason,
          reconciliation_status: 'fallback' as const,
        } : {}),
      });
    });
  }

  // Build the pack after local extraction so the Gap Agent sees the same
  // project state that the rest of this turn will reason about. The pack is
  // now the candidate/evidence boundary, rather than an unused trace input.
  const contextPack = buildContextPack({
    userId: params.userId,
    query: params.input,
    project: workingProject,
    profile: params.profile,
    durableMemories: params.durableMemories,
  });

  const candidates = rankGaps(workingProject);
  const escalation = assessGapEscalation(workingProject, candidates);
  const gapStarted = Date.now();
  const gapAssessment = assessGapsV1Deterministically({
    project: workingProject,
    contextPack,
    memories: params.durableMemories ?? [],
  });
  const gapOutput = gapAssessment.selectedGapId || hasLiveDecision(workingProject)
    ? gapAgentOutputFromAssessment(workingProject, gapAssessment)
    : runGapAgent(workingProject);
  const effectiveGap = gapOutput.selectedGapNodeId
    ? candidates.find((candidate) => candidate.node_id === gapOutput.selectedGapNodeId) ?? null
    : null;
  workingProject.active_question = effectiveGap;
  const gapLatency = Date.now() - gapStarted;
  const attentionStarted = Date.now();
  const attentionOutput = runAttentionAgent(workingProject);
  const attentionLatency = Date.now() - attentionStarted;
  const partnerStarted = Date.now();
  const partner = runPartnerAgent(workingProject, params.profile, gapOutput, attentionOutput);
  const partnerLatency = Date.now() - partnerStarted;
  const gapByNode = new Map(candidates.map((candidate) => [candidate.node_id, candidate]));
  const gapTraceCandidates = gapAssessment.candidates
    .map((candidate) => {
      const nodeId = candidate.sourceUnknownNodeIds[0];
      const rankedGap = gapByNode.get(nodeId);
      return {
        id: nodeId,
        rank: 0,
        priority: rankedGap?.priority ?? 0,
        confidence: ({ low: 0.35, medium: 0.65, high: 0.9 }[candidate.assessmentConfidence] ?? 0),
        summary: `${candidate.affectedDecisions.length} affected decisions · ${candidate.evidenceReview.evidenceIds.length} evidence IDs · ${candidate.evidenceReview.answerability}${candidate.suppressionReason ? ` · suppressed: ${candidate.suppressionReason}` : ''}`,
        decisionValue: rankedGap ? decisionValueForTrace(rankedGap) : undefined,
      };
    })
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, 5)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  const runFor = (
    role: keyof typeof policy,
    latencyMs: number,
    inputSummary: string,
    outputSummary: string,
    confidence: number | null,
    escalationReason?: string,
  ): TraceAgentRun => ({
    runId: `${turnId}_${role}`,
    agent: `${role[0].toUpperCase()}${role.slice(1)} Agent`,
    model: policy[role].model,
    thinkingLevel: policy[role].thinkingLevel,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs,
    estimatedCost: 0,
    costSource: 'zero_cost_deterministic',
    validationStatus: 'passed',
    confidence,
    escalated: false,
    escalationReason,
    execution: 'deterministic',
    inputSummary,
    outputSummary,
  });

  const gapAnalysis: TraceGapAnalysis = {
    candidates: gapTraceCandidates,
    selectedGapId: gapOutput.selectedGapNodeId,
    retrievalAnswered: gapOutput.retrievalAnswered,
    selectionReason: gapOutput.selectedGapNodeId
      ? gapAssessment.selectedGapId
        ? gapAssessment.selectionRationale
        : 'No live decision target exists yet; retained the existing graph question until one is created.'
      : 'No open high-impact gap was available.',
    confidence: gapOutput.selectedGapNodeId
      ? (() => {
        const selected = gapAssessment.candidates.find((candidate) => candidate.gapId === gapAssessment.selectedGapId);
        return selected
          ? ({ low: 0.35, medium: 0.65, high: 0.9 }[selected.assessmentConfidence] ?? null)
          : null;
      })()
      : null,
    evidenceIds: gapAssessment.candidates.find((candidate) => candidate.gapId === gapAssessment.selectedGapId)?.evidenceReview.evidenceIds ?? [],
    escalated: false,
    escalationReason: escalation.reasons.length
      ? `${escalation.reasons.join('; ')}; deterministic runner recorded no retry.`
      : 'No escalation trigger met.',
    escalationModel: escalationConfig.model,
    escalationThinkingLevel: escalationConfig.thinkingLevel,
    escalationMaxOutputTokens: escalationConfig.maxOutputTokens,
  };

  const agentRuns: TraceAgentRun[] = [
    runFor(
      'context',
      contextLatency,
      `${contextPack.includedContextIds.length} selected context IDs`,
      `Extracted ${contextResult.graphUpdate.createNodes.length} candidate nodes and ${contextResult.graphUpdate.createEdges.length} candidate edges`,
      contextResult.graphUpdate.createNodes.length
        ? Number((contextResult.graphUpdate.createNodes.reduce((sum, node) => sum + node.confidence, 0) / contextResult.graphUpdate.createNodes.length).toFixed(3))
        : null,
    ),
    runFor(
      'gap',
      gapLatency,
      `${gapAssessment.candidates.length} scoped Context Pack gap candidates`,
      gapOutput.selectedGapNodeId ? `Selected ${gapOutput.selectedGapNodeId}` : 'No unresolved gap selected',
      gapAnalysis.confidence,
      gapAnalysis.escalationReason,
    ),
    runFor(
      'attention',
      attentionLatency,
      `${candidates.length} gap candidates and ${contextPack.activeGoals.length} active goals`,
      `Generated ${attentionOutput.recommendations.length} recommendations`,
      attentionOutput.recommendations[0]?.score ?? null,
    ),
    runFor(
      'partner',
      partnerLatency,
      `${attentionOutput.recommendations.length} recommendations and 1 selected gap`,
      `Returned ${partner.mode} with ${partner.citedNodeIds.length} cited identifiers`,
      partner.citedNodeIds.length ? 0.8 : 0.5,
    ),
  ];

  const handoffs: TraceHandoff[] = [
    {
      id: `${turnId}_context_gap`, from: 'Context', to: 'Gap',
      inputCount: contextPack.includedContextIds.length, outputCount: gapAssessment.candidates.length,
      selectedIds: gapAssessment.candidates.slice(0, 5).map((candidate) => candidate.sourceUnknownNodeIds[0]),
      summary: 'Context Pack scoped the graph candidates and supplied retrieved evidence to Gap assessment.',
    },
    {
      id: `${turnId}_gap_attention`, from: 'Gap', to: 'Attention',
      inputCount: gapAssessment.candidates.length, outputCount: gapOutput.selectedGapNodeId ? 1 : 0,
      selectedIds: gapOutput.selectedGapNodeId ? [gapOutput.selectedGapNodeId] : [],
      summary: 'Ranked uncertainty handed to attention prioritization.',
    },
    {
      id: `${turnId}_attention_partner`, from: 'Attention', to: 'Partner',
      inputCount: attentionOutput.recommendations.length, outputCount: attentionOutput.recommendations[0] ? 1 : 0,
      selectedIds: attentionOutput.recommendations[0]?.sourceNodeIds ?? [],
      summary: 'Top recommendations handed to the partner response step.',
    },
    {
      id: `${turnId}_partner_ui`, from: 'Partner', to: 'UI',
      inputCount: partner.citedNodeIds.length, outputCount: 1,
      selectedIds: partner.citedNodeIds,
      summary: 'Structured partner result handed to the product UI.',
    },
  ];

  const trace = validateStructuredOutput(orchestratorTraceSchema, {
    turnId,
    userId: params.userId,
    input: params.input,
    agentEvents: [
      traceEvent(
        agentNames.context,
        `Built Context Pack with ${contextPack.includedContextIds.length} included context IDs and extracted ${contextResult.graphUpdate.createNodes.length} candidate graph updates.`,
        contextPack.includedContextIds
      ),
      traceEvent(
        agentNames.gap,
        gapOutput.selectedGapNodeId
          ? `Selected ${gapOutput.selectedGapNodeId} with priority ${gapOutput.priority}.`
          : 'No unresolved gap selected.',
        contextPack.unresolvedGaps.map((gap) => gap.id)
      ),
      traceEvent(
        agentNames.attention,
        `Generated ${attentionOutput.recommendations.length} attention recommendations.`,
        attentionOutput.recommendations.flatMap((recommendation) => recommendation.sourceNodeIds)
      ),
      traceEvent(agentNames.partner, `Responded in ${partner.mode} mode.`, partner.citedNodeIds),
    ],
  });

  return { project: workingProject, partner, contextPack, trace, observability: { agentRuns, gapAnalysis, handoffs } };
}
