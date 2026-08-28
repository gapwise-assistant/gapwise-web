import { assessGapsV1Deterministically, hasLiveDecision } from '@/lib/agents/gapAssessmentV1';
import { validateGapAssessmentAgainstProject, type GapAssessmentV1 } from '@/lib/agents/gapContractV1';
import { getAgentModelConfig, type AgentModelConfig } from '@/lib/agents/modelPolicy';
import { GapRemoteError, requestGapAssessment, type GapRemoteMetadata } from '@/lib/agents/gapRemote';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadDurableMemories, loadUserMemoryProfile } from '@/lib/memory/serverStore';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { rankGaps } from '@/lib/tools/graphTools';
import { recordTrace } from '@/lib/observability/trace';
import { decisionValueForTrace } from '@/lib/observability/decisionValueTrace';
import type { ContextPack, DurableMemory } from '@/types/contextPack';
import type { GapGuidance, Project, UserMemoryProfile } from '@/types/clarity';
import type { TraceGapComparison } from '@/types/observability';

export type GapAgentRuntimeMode = 'deterministic' | 'shadow' | 'live';

export interface GapRuntimeResult {
  mode: GapAgentRuntimeMode;
  deterministicAssessment: GapAssessmentV1;
  agentAssessment: GapAssessmentV1 | null;
  metadata: GapRemoteMetadata | null;
  deterministicGapNodeId: string | null;
  agentGapNodeId: string | null;
  effectiveGapNodeId: string | null;
  agentGuidance: GapGuidance | null;
  effectiveGuidance: GapGuidance | null;
  fallbackUsed: boolean;
  comparison: TraceGapComparison;
}

function configuredMode(): GapAgentRuntimeMode {
  if (isDemoMode()) return 'deterministic';
  const value = process.env.GAP_AGENT_MODE?.trim().toLowerCase();
  return value === 'shadow' || value === 'live' ? value : 'deterministic';
}

export function getGapAgentRuntimeMode(): GapAgentRuntimeMode {
  return configuredMode();
}

function selectedNodeId(assessment: GapAssessmentV1): string | null {
  if (!assessment.selectedGapId) return null;
  const selected = assessment.candidates.find((candidate) => candidate.gapId === assessment.selectedGapId);
  return selected?.sourceUnknownNodeIds[0] ?? null;
}

function compatibilityNodeId(project: Project, assessment: GapAssessmentV1, profile?: UserMemoryProfile): string | null {
  if (hasLiveDecision(project) || assessment.selectedGapId) return null;
  return rankGaps(project, profile)[0]?.node_id ?? null;
}

function failureReason(error: unknown): TraceGapComparison['failureReason'] {
  if (error instanceof GapRemoteError) {
    if (/timed out/i.test(error.message)) return 'timeout';
    if (/invalid response contract/i.test(error.message)) return 'contract';
    if (error.status === 502) return 'contract';
    if (error.status === 503) return 'unavailable';
    return 'transport';
  }
  if (error instanceof Error && /path|node|decision|evidence|graph/i.test(error.message)) return 'graph_reference';
  return 'unavailable';
}

export async function evaluateGapRuntime(params: {
  userId: string;
  project: Project;
  contextPack: ContextPack;
  memories: DurableMemory[];
  profile?: UserMemoryProfile;
  mode?: GapAgentRuntimeMode;
  evaluationConfig?: AgentModelConfig;
}): Promise<GapRuntimeResult> {
  const mode = isDemoMode() ? 'deterministic' : (params.mode ?? configuredMode());
  const deterministicAssessment = assessGapsV1Deterministically({
    project: params.project,
    contextPack: params.contextPack,
    memories: params.memories,
    profile: params.profile,
  });
  const deterministicGapNodeId = selectedNodeId(deterministicAssessment)
    ?? compatibilityNodeId(params.project, deterministicAssessment, params.profile);
  const deterministicGuidance = deterministicGapNodeId
    ? rankGaps(params.project, params.profile).find((gap) => gap.node_id === deterministicGapNodeId)?.guidance ?? null
    : null;
  const deterministicResult = (reason?: TraceGapComparison['failureReason']): GapRuntimeResult => ({
    mode,
    deterministicAssessment,
    agentAssessment: null,
    metadata: null,
    deterministicGapNodeId,
    agentGapNodeId: null,
    effectiveGapNodeId: deterministicGapNodeId,
    agentGuidance: null,
    effectiveGuidance: deterministicGuidance,
    fallbackUsed: mode === 'live' && Boolean(reason),
    comparison: {
      mode,
      deterministicGapId: deterministicGapNodeId,
      agentGapId: null,
      effectiveGapId: deterministicGapNodeId,
      agreement: null,
      fallbackUsed: mode === 'live' && Boolean(reason),
      validationStatus: reason ? 'failed' : mode === 'deterministic' ? 'not_run' : 'failed',
      failureReason: reason,
    },
  });

  if (mode === 'deterministic') return deterministicResult();

  try {
    const remote = await requestGapAssessment({
      userId: params.userId,
      project: params.project,
      contextPack: params.contextPack,
      memories: params.memories,
      evaluationConfig: params.evaluationConfig,
    });
    const agentAssessment = validateGapAssessmentAgainstProject(remote.assessment, params.project);
    const agentGapNodeId = selectedNodeId(agentAssessment);
    const effectiveGapNodeId = mode === 'live' ? agentGapNodeId : deterministicGapNodeId;
    return {
      mode,
      deterministicAssessment,
      agentAssessment,
      metadata: remote.metadata,
      deterministicGapNodeId,
      agentGapNodeId,
      effectiveGapNodeId,
      agentGuidance: remote.recommendation,
      effectiveGuidance: mode === 'live' ? remote.recommendation : deterministicGuidance,
      fallbackUsed: false,
      comparison: {
        mode,
        deterministicGapId: deterministicGapNodeId,
        agentGapId: agentGapNodeId,
        effectiveGapId: effectiveGapNodeId,
        agreement: deterministicGapNodeId === agentGapNodeId,
        fallbackUsed: false,
        runId: remote.metadata.runId,
        validationStatus: 'passed',
      },
    };
  } catch (error) {
    return deterministicResult(failureReason(error));
  }
}

function applyEffectiveSelection(
  project: Project,
  nodeId: string | null,
  guidance: GapGuidance | null,
  profile?: UserMemoryProfile,
): Project {
  const updated = JSON.parse(JSON.stringify(project)) as Project;
  const candidate = nodeId ? rankGaps(updated, profile).find((gap) => gap.node_id === nodeId) ?? null : null;
  if (candidate && guidance) candidate.guidance = guidance;
  updated.active_question = candidate;
  return updated;
}

function recordGapRuntimeTrace(params: {
  userId: string;
  route: string;
  label: string;
  project: Project;
  contextPack: ContextPack;
  result: GapRuntimeResult;
  started: number;
  profile?: UserMemoryProfile;
}): void {
  const config = getAgentModelConfig('gap');
  const metadata = params.result.metadata;
  const assessment = params.result.agentAssessment ?? params.result.deterministicAssessment;
  const gapByNode = new Map(rankGaps(params.project, params.profile).map((gap) => [gap.node_id, gap]));
  const selected = assessment.candidates.find((candidate) => candidate.gapId === assessment.selectedGapId);
  recordTrace({
    userId: params.userId,
    route: params.route,
    label: params.label,
    started_at: new Date(params.started).toISOString(),
    duration_ms: Date.now() - params.started,
    agentNames: ['Gap Agent'],
    contextIds: params.contextPack.includedContextIds,
    scores: [],
    toolCalls: ['buildContextPack', params.result.mode === 'deterministic' ? 'deterministic Context Pack Gap assessment' : 'ADK Gap Agent'],
    model: metadata?.model ?? config.model,
    agentConfigs: [{
      agentName: 'Gap Agent',
      model: metadata?.model ?? config.model,
      thinkingLevel: metadata?.thinkingLevel ?? config.thinkingLevel,
      maxOutputTokens: metadata?.maxOutputTokens ?? config.maxOutputTokens,
      execution: metadata ? 'used' : params.result.mode === 'deterministic' ? 'not_used' : 'would_use',
    }],
    agentRuns: metadata ? [{
      runId: metadata.runId,
      agent: 'Gap Agent',
      model: metadata.model,
      thinkingLevel: metadata.thinkingLevel,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      latencyMs: metadata.latencyMs,
      estimatedCost: metadata.estimatedCost,
      costSource: metadata.costSource,
      validationStatus: metadata.validationStatus,
      confidence: metadata.confidence,
      escalated: metadata.escalated,
      escalationReason: metadata.escalationReason ?? undefined,
      execution: 'used',
      inputSummary: metadata.inputSummary,
      outputSummary: metadata.outputSummary,
    }] : [],
    gapAnalysis: {
      candidates: assessment.candidates.map((candidate) => {
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
      selectedGapId: params.result.effectiveGapNodeId,
      retrievalAnswered: assessment.selectedGapId === null
        && assessment.candidates.length > 0
        && assessment.candidates.every((candidate) => candidate.evidenceReview.answerability === 'answered'),
      selectionReason: params.result.agentAssessment
        ? params.result.agentAssessment.selectionRationale
        : 'No validated ADK assessment was available; deterministic selection remained active.',
      confidence: metadata?.confidence ?? null,
      evidenceIds: selected?.evidenceReview.evidenceIds ?? [],
      escalated: metadata?.escalated ?? false,
      escalationReason: metadata?.escalationReason ?? undefined,
    },
    gapComparison: params.result.comparison,
    contextSummary: {
      scope: params.project.id,
      includedContextCount: params.contextPack.includedContextIds.length,
      goalCount: params.contextPack.activeGoals.length,
      unresolvedGapCount: params.contextPack.unresolvedGaps.length,
      evidenceCount: params.contextPack.relevantEvidence.length + params.contextPack.provenanceSources.length,
      preferenceCount: params.contextPack.userPreferences.length,
      decisionCount: params.contextPack.recentDecisions.length,
      commitmentCount: params.contextPack.upcomingCommitments.length,
    },
    pipelineSteps: [{
      name: 'Gap Agent / structural assessment',
      agentName: 'Gap Agent',
      summary: params.result.mode === 'shadow'
        ? `Shadow assessment compared with deterministic selection; agreement=${params.result.comparison.agreement ?? 'unavailable'}.`
          : params.result.mode === 'live'
            ? params.result.fallbackUsed
              ? 'Live assessment failed validation or transport; deterministic fallback was retained.'
              : 'Validated ADK selection became the effective project gap.'
          : 'The retrieval-aware deterministic Gap assessment selected the effective project gap; no external model call was made.',
      execution: metadata ? 'used' : params.result.mode === 'deterministic' ? 'deterministic' : 'not_used',
      contextCount: params.contextPack.includedContextIds.length,
    }],
  });
}

export async function refreshProjectGapRuntime(params: {
  userId: string;
  project: Project;
  profile?: UserMemoryProfile;
  memories?: DurableMemory[];
  route: string;
  label: string;
}): Promise<{ project: Project; runtime: GapRuntimeResult | null }> {
  const mode = configuredMode();
  const started = Date.now();
  const profile = params.profile ?? await loadUserMemoryProfile(params.userId, DEFAULT_USER_PROFILE);
  let memories = params.memories;
  if (!memories) {
    try {
      memories = await loadDurableMemories(params.userId, profile);
    } catch {
      memories = [];
    }
  }
  const contextPack = buildContextPack({
    userId: params.userId,
    query: 'Identify the smallest unresolved fact that could materially change the next live decision.',
    project: params.project,
    profile,
    durableMemories: memories,
    includeBroadContext: true,
  });
  const runtime = await evaluateGapRuntime({
    userId: params.userId,
    project: params.project,
    contextPack,
    memories,
    profile,
    mode,
  });
  // Deterministic and shadow modes still produce a real, inspectable
  // selection. Only the provider call is skipped; the selected gap and its
  // sanitized trace should not disappear just because local AI is offline.
  const project = !hasLiveDecision(params.project) && !runtime.deterministicAssessment.selectedGapId
    ? params.project
    : applyEffectiveSelection(params.project, runtime.effectiveGapNodeId, runtime.effectiveGuidance, profile);
  recordGapRuntimeTrace({
    userId: params.userId,
    route: params.route,
    label: params.label,
    project: params.project,
    contextPack,
    result: runtime,
    started,
    profile,
  });
  return { project, runtime };
}
