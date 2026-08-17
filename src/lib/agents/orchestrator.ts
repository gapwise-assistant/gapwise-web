import { Project, UserMemoryProfile } from '@/types/clarity';
import { ContextPack, DurableMemory } from '@/types/contextPack';
import { agentNames, OrchestratorTrace, orchestratorTraceSchema, PartnerAgentOutput, validateStructuredOutput } from '@/lib/agents/schemas';
import { runAttentionAgent } from '@/lib/agents/attentionAgent';
import { runContextAgent } from '@/lib/agents/contextAgent';
import { assessGapEscalation, runGapAgent } from '@/lib/agents/gapAgent';
import { runPartnerAgent } from '@/lib/agents/partnerAgent';
import { createGraphNode, rankGaps } from '@/lib/tools/graphTools';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { getAgentModelPolicy, getGapEscalationModelConfig } from '@/lib/agents/modelPolicy';
import type { TraceAgentRun, TraceGapAnalysis, TraceHandoff } from '@/types/observability';

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
  const contextPack = buildContextPack({
    userId: params.userId,
    query: params.input,
    project: workingProject,
    profile: params.profile,
    durableMemories: params.durableMemories,
  });
  const contextStarted = Date.now();
  const contextResult = runContextAgent(params.input, workingProject);
  const contextLatency = Date.now() - contextStarted;

  if (params.applyGraphUpdates) {
    contextResult.graphUpdate.createNodes.forEach((node) => {
      createGraphNode(workingProject, {
        type: node.type,
        text: node.text,
        confidence: node.confidence,
        impact: node.impact,
        source_refs: node.sourceRefs,
      });
    });
  }

  const candidates = rankGaps(workingProject);
  const escalation = assessGapEscalation(workingProject, candidates);
  const gapStarted = Date.now();
  const gapOutput = runGapAgent(workingProject);
  const gapLatency = Date.now() - gapStarted;
  const attentionStarted = Date.now();
  const attentionOutput = runAttentionAgent(workingProject);
  const attentionLatency = Date.now() - attentionStarted;
  const partnerStarted = Date.now();
  const partner = runPartnerAgent(workingProject, params.profile, gapOutput, attentionOutput);
  const partnerLatency = Date.now() - partnerStarted;

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
    candidates: candidates.slice(0, 5).map((candidate, index) => {
      const node = workingProject.nodes.find((item) => item.id === candidate.node_id);
      return {
        id: candidate.node_id,
        rank: index + 1,
        priority: candidate.priority,
        confidence: Number((1 - candidate.uncertainty).toFixed(3)),
        summary: `${node?.type.toLowerCase() ?? 'gap'} · ${candidate.blocked_decision_ids.length} linked decisions · ${node?.source_refs.length ?? 0} evidence links`,
      };
    }),
    selectedGapId: gapOutput.selectedGapNodeId,
    selectionReason: gapOutput.selectedGapNodeId
      ? 'Highest deterministic priority after uncertainty, impact, dependencies, urgency, answerability, and user relevance.'
      : 'No open high-impact gap was available.',
    confidence: gapOutput.selectedGapNodeId
      ? gapAnalysisConfidence(candidates[0])
      : null,
    evidenceIds: workingProject.nodes.find((node) => node.id === gapOutput.selectedGapNodeId)?.source_refs ?? [],
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
      `${candidates.length} ranked gap candidates`,
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
      inputCount: contextPack.includedContextIds.length, outputCount: candidates.length,
      selectedIds: candidates.slice(0, 5).map((candidate) => candidate.node_id),
      summary: 'Context Pack and extracted graph candidates handed to gap ranking.',
    },
    {
      id: `${turnId}_gap_attention`, from: 'Gap', to: 'Attention',
      inputCount: candidates.length, outputCount: gapOutput.selectedGapNodeId ? 1 : 0,
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

function gapAnalysisConfidence(candidate: ReturnType<typeof rankGaps>[number] | undefined): number | null {
  return candidate ? Number((1 - candidate.uncertainty).toFixed(3)) : null;
}
