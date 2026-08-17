import { NextResponse } from 'next/server';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { runGapswiseOrchestrator } from '@/lib/agents/orchestrator';
import { loadProject, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { recordTrace } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getAgentModelPolicy } from '@/lib/agents/modelPolicy';

function traceAgentConfigs() {
  const policy = getAgentModelPolicy();
  return Object.entries(policy).map(([role, config]) => ({
    agentName: `${role[0].toUpperCase()}${role.slice(1)} Agent`,
    model: config.model,
    thinkingLevel: config.thinkingLevel,
    maxOutputTokens: config.maxOutputTokens,
    // This orchestrator is deterministic today; these are the models that
    // would be used when the four-agent Gemini workflow is enabled.
    execution: 'would_use' as const,
  }));
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
    const result = runGapswiseOrchestrator({
      userId,
      input,
      project,
      profile: DEFAULT_USER_PROFILE,
      applyGraphUpdates: body.applyGraphUpdates ?? false,
    });
    const { observability, ...responseResult } = result;

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
      agentConfigs: traceAgentConfigs(),
      agentRuns: observability.agentRuns,
      gapAnalysis: observability.gapAnalysis,
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
