import { NextResponse } from 'next/server';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadProjectForScope, requireFirestoreStorage } from '@/lib/storage';
import { generateDailyBrief } from '@/lib/attention/generateBrief';
import { StorageError } from '@/lib/storage/types';
import { recordTrace } from '@/lib/observability/trace';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { loadDurableMemories, loadUserMemoryProfile } from '@/lib/memory/serverStore';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { isPublicDemoPrincipal, loadPublicDemoProject } from '@/lib/auth/publicDemo';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { focusAssessmentCacheId, focusProjectStateVersion, getCachedFocusAssessment } from '@/lib/focus/focusCache';
import { normalizeFocusAssessment } from '@/lib/focus/normalizeFocusAssessment';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const started = Date.now();
  let userId = 'unknown';
  try {
    const body = (await request.json()) as {
      userId?: string;
      period?: string;
      force?: boolean;
      projectId?: string;
    };
    const schedulerSecret = process.env.ATTENTION_RUN_SECRET?.trim();
    if (schedulerSecret && request.headers.get('authorization') === `Bearer ${schedulerSecret}`) {
      userId = body.userId?.trim() ?? '';
      if (!userId) throw new StorageError('Missing userId.', 'UNAUTHENTICATED');
    } else {
      const principal = await requireAuthenticatedPrincipal(request, body.userId?.trim());
      userId = principal.uid;
      if (isPublicDemoPrincipal(principal)) {
        const storage = requireFirestoreStorage();
        const project = await loadPublicDemoProject(principal, storage, body.projectId?.trim());
        const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
        const memories = await loadDurableMemories(userId, profile);
        const now = new Date();
        const contextPack = await buildContextPackForUser({
          userId,
          query: 'What needs my attention today?',
          project,
          profile,
          durableMemories: memories,
          scope: { type: 'project', projectId: project.id },
          reasoningMode: 'focus',
        }, { now });
        const brief = generateDailyBrief({
          userId,
          project,
          memories,
          profile,
          period: body.period,
          force: false,
          contextPack,
          now,
        });
        const focusVersion = await focusProjectStateVersion(project, contextPack, profile);
        const focusCache = await storage.getFocusAssessment(
          userId,
          focusAssessmentCacheId(project.id, focusVersion),
        );
        return NextResponse.json({
          brief,
          focusAssessment: focusCache?.assessment
            ? normalizeFocusAssessment(project, focusCache.assessment)
            : null,
        });
      }
    }

    const { project, scope } = await loadProjectForScope(userId, body.projectId?.trim() || undefined);
    const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    const memories = await loadDurableMemories(userId, profile);
    const now = new Date();
    const contextPack = await buildContextPackForUser({
      userId,
      query: 'What needs my attention today?',
      project,
      profile,
      durableMemories: memories,
      scope,
      reasoningMode: 'focus',
    }, { now });
    const brief = generateDailyBrief({
      userId,
      project,
      memories,
      profile,
      period: body.period,
      force: body.force,
      contextPack,
      now,
    });
    const focusAssessment = await getCachedFocusAssessment(userId, project, contextPack, profile);

    recordTrace({
      userId,
      route: '/api/attention/run',
      label: 'Attention brief',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      agentNames: ['Attention Agent'],
      contextIds: brief.recommendations.flatMap((recommendation) => recommendation.context_pack.includedContextIds),
      scores: brief.recommendations.map((recommendation) => ({ id: recommendation.id, score: recommendation.score })),
      toolCalls: ['generateDailyBrief', 'generateAttentionCandidates'],
      agentRuns: [{
        runId: `attention_${started}`,
        agent: 'Attention Agent',
        model: getAgentModelConfig('attention').model,
        thinkingLevel: getAgentModelConfig('attention').thinkingLevel,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - started,
        estimatedCost: 0,
        costSource: 'zero_cost_deterministic',
        validationStatus: 'passed',
        confidence: brief.recommendations[0]?.score ?? null,
        escalated: false,
        execution: 'deterministic',
        inputSummary: `${contextPack.includedContextIds.length} selected context IDs`,
        outputSummary: `${brief.recommendations.length} attention recommendations`,
      }],
    });

    return NextResponse.json({ brief, focusAssessment });
  } catch (error) {
    recordTrace({
      userId,
      route: '/api/attention/run',
      label: 'Attention brief failed',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      agentNames: ['Attention Agent'],
      contextIds: [],
      scores: [],
      toolCalls: [],
      error: error instanceof Error ? error.message : 'Attention run failed.',
    });
    const status = error instanceof StorageError && error.code === 'PERMISSION_DENIED' ? 403 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Attention run failed.' },
      { status }
    );
  }
}
