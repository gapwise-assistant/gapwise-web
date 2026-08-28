import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { anchorProjectDecision, openDecisions } from '@/lib/decisions/anchoring';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { recordTrace } from '@/lib/observability/trace';
import { listProjects, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import type { Project } from '@/types/clarity';
import { loadUserMemoryProfile } from '@/lib/memory/serverStore';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(220),
  questionNodeIds: z.array(z.string().trim().min(1)).min(1).max(6),
  profile: z.object({
    answer_density: z.enum(['concise', 'balanced', 'detailed']).optional(),
    question_frequency: z.enum(['low', 'moderate', 'high']).optional(),
    challenge_level: z.enum(['low', 'moderate', 'high']).optional(),
    evidence_preference: z.enum(['research_first', 'intuition_allowed', 'strict_data']).optional(),
    brainstorm_style: z.enum(['diverge_then_converge', 'direct_to_solution']).optional(),
    uncertainty_style: z.enum(['explicit', 'implicit']).optional(),
    durable_notes: z.array(z.string()).optional(),
  }).optional(),
});

function jsonError(error: unknown) {
  if (error instanceof StorageError) {
    const status = error.code === 'UNAUTHENTICATED'
      ? 401
      : error.code === 'PERMISSION_DENIED'
        ? 403
        : error.code === 'VALIDATION_ERROR'
          ? 400
          : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Decision anchoring failed.' }, { status: 500 });
}

function contextSummary(project: Project) {
  return {
    scope: project.id,
    includedContextCount: project.sources.filter((source) => !source.discarded_at).length,
    goalCount: project.nodes.filter((node) => node.type === 'GOAL' && node.status !== 'DEPRECATED').length,
    unresolvedGapCount: project.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN').length,
    evidenceCount: project.nodes.filter((node) => node.type === 'EVIDENCE').length,
    preferenceCount: project.nodes.filter((node) => node.type === 'PREFERENCE').length,
    decisionCount: project.nodes.filter((node) => node.type === 'DECISION').length,
    commitmentCount: project.nodes.filter((node) => node.type === 'NEXT_ACTION').length,
  };
}

function normalizedTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function POST(request: Request) {
  const started = Date.now();
  let userId = 'unknown';
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) throw new StorageError('Invalid decision anchor request.', 'VALIDATION_ERROR');
    userId = await requireAuthenticatedUserId(request, parsed.data.userId);
    const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    const project = (await listProjects(userId)).find((candidate) => candidate.id === parsed.data.projectId);
    if (!project) throw new StorageError('The requested workspace was not found for this user.', 'PERMISSION_DENIED');
    const questionNodeIds = parsed.data.questionNodeIds.filter((id) => project.nodes.some((node) =>
      node.id === id && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && node.status === 'OPEN'
    ));
    if (questionNodeIds.length === 0) throw new StorageError('Select at least one open question from this workspace.', 'VALIDATION_ERROR');
    const anchored = anchorProjectDecision(
      project,
      parsed.data.title,
      questionNodeIds,
      profile,
    );
    const refreshed = await refreshProjectGapRuntime({
      userId,
      project: anchored,
      profile,
      route: '/api/projects/decision-anchor',
      label: 'Gap Agent after decision anchoring',
    });
    await saveProject(userId, refreshed.project);

    const decision = openDecisions(refreshed.project).find((node) => normalizedTitle(node.text) === normalizedTitle(parsed.data.title));
    const runtime = refreshed.runtime;
    const gapConfig = getAgentModelConfig('gap');
    const execution = runtime?.metadata
      ? 'used' as const
      : runtime?.mode === 'deterministic'
        ? 'not_used' as const
        : 'would_use' as const;
    recordTrace({
      userId,
      route: '/api/projects/decision-anchor',
      label: 'Decision Map decision anchoring',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      agentNames: ['Decision Anchoring'],
      contextIds: questionNodeIds,
      scores: [],
      toolCalls: ['anchorProjectDecision', 'refreshProjectGapRuntime'],
      model: gapConfig.model,
      agentConfigs: [{
        agentName: 'Gap Agent',
        model: runtime?.metadata?.model ?? gapConfig.model,
        thinkingLevel: runtime?.metadata?.thinkingLevel ?? gapConfig.thinkingLevel,
        maxOutputTokens: runtime?.metadata?.maxOutputTokens ?? gapConfig.maxOutputTokens,
        execution,
      }],
      gapComparison: runtime?.comparison,
      contextSummary: contextSummary(refreshed.project),
      pipelineSteps: [
        {
          name: 'Anchor pending decision',
          agentName: 'Decision Anchoring',
          summary: `Linked ${questionNodeIds.length} user-selected question IDs to ${decision?.id ?? 'the pending decision'}.`,
          execution: 'deterministic',
          contextCount: questionNodeIds.length,
        },
        {
          name: 'Refresh Gap Agent selection',
          agentName: 'Gap Agent',
          summary: runtime?.metadata
            ? `Validated ${runtime.mode} selection ${runtime.agentGapNodeId ?? 'none'} after anchoring.`
            : runtime?.mode === 'deterministic'
              ? 'No ADK call was made; deterministic selection was recalculated.'
              : 'The configured Gap Agent would run after anchoring.',
          execution: runtime?.metadata ? 'used' : runtime?.mode === 'deterministic' ? 'deterministic' : 'would_use',
          contextCount: refreshed.project.nodes.length,
        },
      ],
      decisionAnchoring: {
        decisionId: decision?.id ?? null,
        decisionTitle: decision?.text ?? parsed.data.title,
        questionNodeIds,
        linkCount: questionNodeIds.length,
        source: 'user_confirmation',
      },
    });

    return NextResponse.json({
      project: refreshed.project,
      runtime: runtime ? {
        mode: runtime.mode,
        deterministicGapNodeId: runtime.deterministicGapNodeId,
        agentGapNodeId: runtime.agentGapNodeId,
        effectiveGapNodeId: runtime.effectiveGapNodeId,
        comparison: runtime.comparison,
      } : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
