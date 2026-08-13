import { Project, UserMemoryProfile } from '@/types/clarity';
import { ContextPack, DurableMemory } from '@/types/contextPack';
import { agentNames, OrchestratorTrace, orchestratorTraceSchema, PartnerAgentOutput, validateStructuredOutput } from '@/lib/agents/schemas';
import { runAttentionAgent } from '@/lib/agents/attentionAgent';
import { runContextAgent } from '@/lib/agents/contextAgent';
import { runGapAgent } from '@/lib/agents/gapAgent';
import { runPartnerAgent } from '@/lib/agents/partnerAgent';
import { createGraphNode } from '@/lib/tools/graphTools';
import { buildContextPack } from '@/lib/retrieval/contextPack';

export interface AgentTurnResult {
  project: Project;
  partner: PartnerAgentOutput;
  contextPack: ContextPack;
  trace: OrchestratorTrace;
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
  const workingProject: Project = JSON.parse(JSON.stringify(params.project));
  const contextPack = buildContextPack({
    userId: params.userId,
    query: params.input,
    project: workingProject,
    profile: params.profile,
    durableMemories: params.durableMemories,
  });
  const contextResult = runContextAgent(params.input, workingProject);

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

  const gapOutput = runGapAgent(workingProject);
  const attentionOutput = runAttentionAgent(workingProject);
  const partner = runPartnerAgent(workingProject, params.profile, gapOutput, attentionOutput);

  const trace = validateStructuredOutput(orchestratorTraceSchema, {
    turnId: `turn_${Date.now()}`,
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

  return { project: workingProject, partner, contextPack, trace };
}
