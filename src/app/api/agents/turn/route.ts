import { NextResponse } from 'next/server';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { runGapswiseOrchestrator } from '@/lib/agents/orchestrator';
import { loadProject, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { recordTrace } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getAgentModelPolicy } from '@/lib/agents/modelPolicy';
import { loadDurableMemories, loadUserMemoryProfile } from '@/lib/memory/serverStore';
import { evaluateGapRuntime, getGapAgentRuntimeMode, type GapRuntimeResult } from '@/lib/agents/gapRuntime';
import { rankGaps } from '@/lib/tools/graphTools';
import { runAttentionAgent } from '@/lib/agents/attentionAgent';
import { runPartnerAgent } from '@/lib/agents/partnerAgent';
import { gapAgentOutputSchema, validateStructuredOutput } from '@/lib/agents/schemas';
import { gapAgentOutputFromAssessment } from '@/lib/agents/gapAssessmentV1';
import type { AgentTurnResult } from '@/lib/agents/orchestrator';
import { decisionValueForTrace } from '@/lib/observability/decisionValueTrace';
import type { UserMemoryProfile } from '@/types/clarity';

function traceAgentConfigs(gapRuntime: GapRuntimeResult) {
  const policy = getAgentModelPolicy();
  return Object.entries(policy).map(([role, config]) => ({
    agentName: `${role[0].toUpperCase()}${role.slice(1)} Agent`,
    model: role === 'gap' ? gapRuntime.metadata?.model ?? config.model : config.model,
    thinkingLevel: role === 'gap' ? gapRuntime.metadata?.thinkingLevel ?? config.thinkingLevel : config.thinkingLevel,
    maxOutputTokens: role === 'gap' ? gapRuntime.metadata?.maxOutputTokens ?? config.maxOutputTokens : config.maxOutputTokens,
    execution: role === 'gap' && gapRuntime.metadata
      ? 'used' as const
      : 'would_use' as const,
  }));
}

function applyLiveGapSelection(
  result: AgentTurnResult,
  runtime: GapRuntimeResult,
  profile: UserMemoryProfile,
): void {
  if (runtime.mode !== 'live' || runtime.fallbackUsed) return;
  const ranked = rankGaps(result.project, profile);
  const selected = runtime.effectiveGapNodeId
    ? ranked.find((candidate) => candidate.node_id === runtime.effectiveGapNodeId) ?? null
    : null;
  if (selected && runtime.effectiveGuidance) selected.guidance = runtime.effectiveGuidance;
  result.project.active_question = selected;
  const gapOutput = runtime.agentAssessment
    ? gapAgentOutputFromAssessment(result.project, runtime.agentAssessment, profile)
    : validateStructuredOutput(gapAgentOutputSchema, {
      selectedGapNodeId: selected?.node_id ?? null,
      question: selected?.question ?? null,
      priority: selected?.priority ?? null,
      retrievalAnswered: false,
      reasons: ['No validated live Gap Agent assessment was available.'],
    });
  const attention = runAttentionAgent(result.project, profile);
  result.partner = runPartnerAgent(result.project, profile, gapOutput, attention);
}

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const started = Date.now();
  let userId = 'unknown';
  try {
    const body = (await request.json()) as {
      userId?: string;
      input?: string;
      applyGraphUpdates?: boolean;
    };

    userId = await requireAuthenticatedUserId(request, body.userId?.trim());
    const input = body.input?.trim();
    if (!userId) throw new StorageError('Missing userId.', 'UNAUTHENTICATED');
    if (!input) throw new StorageError('Missing input.', 'VALIDATION_ERROR');

    const project = await loadProject(userId);
    const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    let durableMemories: Awaited<ReturnType<typeof loadDurableMemories>> = [];
    try {
      durableMemories = await loadDurableMemories(userId, profile);
    } catch {
      // A memory-provider outage must not break the existing graph turn.
    }
    const result = runGapswiseOrchestrator({
      userId,
      input,
      project,
      profile,
      durableMemories,
      applyGraphUpdates: body.applyGraphUpdates ?? false,
    });
    const gapRuntime = await evaluateGapRuntime({
      userId,
      project: result.project,
      contextPack: result.contextPack,
      memories: durableMemories,
      profile,
      mode: getGapAgentRuntimeMode(),
    });
    applyLiveGapSelection(result, gapRuntime, profile);
    const { observability, ...responseResult } = result;

    if (gapRuntime.metadata) {
      const remoteRun = {
        runId: gapRuntime.metadata.runId,
        agent: gapRuntime.mode === 'shadow' ? 'Gap Agent (shadow)' : 'Gap Agent',
        model: gapRuntime.metadata.model,
        thinkingLevel: gapRuntime.metadata.thinkingLevel,
        inputTokens: gapRuntime.metadata.inputTokens,
        outputTokens: gapRuntime.metadata.outputTokens,
        latencyMs: gapRuntime.metadata.latencyMs,
        estimatedCost: gapRuntime.metadata.estimatedCost,
        costSource: gapRuntime.metadata.costSource,
        validationStatus: gapRuntime.metadata.validationStatus,
        confidence: gapRuntime.metadata.confidence,
        escalated: gapRuntime.metadata.escalated,
        escalationReason: gapRuntime.metadata.escalationReason ?? undefined,
        execution: 'used' as const,
        inputSummary: gapRuntime.metadata.inputSummary,
        outputSummary: gapRuntime.metadata.outputSummary,
      };
      if (gapRuntime.mode === 'live') {
        const gapRunIndex = observability.agentRuns.findIndex((run) => run.agent === 'Gap Agent');
        if (gapRunIndex >= 0) observability.agentRuns[gapRunIndex] = remoteRun;
        else observability.agentRuns.push(remoteRun);
      } else {
        observability.agentRuns.push(remoteRun);
      }
    }

    if (gapRuntime.agentAssessment) {
      const gapByNode = new Map(rankGaps(result.project).map((gap) => [gap.node_id, gap]));
      const selected = gapRuntime.agentAssessment.candidates.find((candidate) => candidate.gapId === gapRuntime.agentAssessment?.selectedGapId);
      observability.gapAnalysis = {
        ...observability.gapAnalysis,
        candidates: gapRuntime.agentAssessment.candidates.map((candidate) => {
          const nodeId = candidate.sourceUnknownNodeIds[0];
          const rankedGap = gapByNode.get(nodeId);
          return {
            id: nodeId,
            rank: 0,
            priority: rankedGap?.priority ?? 0,
            confidence: ({ low: 0.35, medium: 0.65, high: 0.9 })[candidate.assessmentConfidence],
            summary: `${candidate.affectedDecisions.length} affected decisions · ${candidate.evidenceReview.evidenceIds.length} evidence IDs · ${candidate.evidenceReview.answerability}${candidate.suppressionReason ? ` · suppressed: ${candidate.suppressionReason}` : ''}`,
            decisionValue: rankedGap ? decisionValueForTrace(rankedGap) : undefined,
          };
        }).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
          .slice(0, 5)
          .map((candidate, index) => ({ ...candidate, rank: index + 1 })),
        selectedGapId: gapRuntime.agentGapNodeId,
        retrievalAnswered: gapRuntime.agentAssessment.selectedGapId === null
          && gapRuntime.agentAssessment.candidates.length > 0
          && gapRuntime.agentAssessment.candidates.every((candidate) => candidate.evidenceReview.answerability === 'answered'),
        selectionReason: gapRuntime.agentAssessment.selectionRationale,
        confidence: gapRuntime.metadata?.confidence ?? null,
        evidenceIds: selected?.evidenceReview.evidenceIds ?? [],
        escalated: gapRuntime.metadata?.escalated ?? false,
        escalationReason: gapRuntime.metadata?.escalationReason ?? undefined,
      };
    }

    if (body.applyGraphUpdates) {
      await saveProject(userId, result.project);
    }

    recordTrace({
      userId,
      route: '/api/agents/turn',
      label: 'Decision Map / graph orchestration',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      agentNames: result.trace.agentEvents.map((event) => event.agentName),
      contextIds: result.contextPack.includedContextIds,
      scores: [],
      toolCalls: ['buildContextPack', 'runGapswiseOrchestrator'],
      agentConfigs: traceAgentConfigs(gapRuntime),
      agentRuns: observability.agentRuns,
      gapAnalysis: observability.gapAnalysis,
      gapComparison: gapRuntime.comparison,
      handoffs: observability.handoffs,
      contextSummary: {
        scope: project.id,
        includedContextCount: result.contextPack.includedContextIds.length,
        goalCount: result.contextPack.activeGoals.length,
        unresolvedGapCount: result.contextPack.unresolvedGaps.length,
        evidenceCount: result.contextPack.relevantEvidence.length + result.contextPack.provenanceSources.length,
        preferenceCount: result.contextPack.userPreferences.length,
        decisionCount: result.contextPack.recentDecisions.length,
        commitmentCount: result.contextPack.upcomingCommitments.length,
      },
      pipelineSteps: [
        ...result.trace.agentEvents.map((event) => ({
          name: event.agentName,
          agentName: event.agentName,
          summary: `Local deterministic implementation: ${event.summary}`,
          execution: 'deterministic' as const,
          contextCount: event.contextIds?.length ?? 0,
        })),
        {
          name: `Gap Agent ${gapRuntime.mode} comparison`,
          agentName: 'Gap Agent',
          summary: gapRuntime.mode === 'deterministic'
            ? 'No ADK call was made; deterministic selection remained active.'
            : gapRuntime.fallbackUsed
              ? 'The ADK result was unavailable or invalid; deterministic fallback remained active.'
              : `${gapRuntime.mode === 'shadow' ? 'Compared' : 'Applied'} the validated ADK selection; deterministic agreement=${gapRuntime.comparison.agreement}.`,
          execution: gapRuntime.metadata ? 'used' as const : 'deterministic' as const,
          contextCount: result.contextPack.includedContextIds.length,
        },
        {
          name: 'Apply graph updates',
          summary: body.applyGraphUpdates
            ? `Applied ${result.project.nodes.length - project.nodes.length} candidate graph node updates to the project.`
            : 'Preview only; no graph updates were persisted.',
          execution: body.applyGraphUpdates ? 'used' as const : 'deterministic' as const,
          contextCount: result.contextPack.includedContextIds.length,
        },
        {
          name: 'Render Decision Map view',
          summary: 'The client lays out the persisted graph nodes and relationships deterministically.',
          execution: 'deterministic' as const,
          contextCount: result.project.nodes.length,
        },
      ],
    });

    return NextResponse.json(responseResult);
  } catch (error) {
    recordTrace({
      userId,
      route: '/api/agents/turn',
      label: 'Agent turn failed',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      agentNames: [],
      contextIds: [],
      scores: [],
      toolCalls: [],
      error: error instanceof Error ? error.message : 'Agent turn failed.',
    });
    const message = error instanceof Error ? error.message : 'Agent turn failed.';
    return NextResponse.json({ error: message }, { status: error instanceof StorageError ? 400 : 500 });
  }
}
