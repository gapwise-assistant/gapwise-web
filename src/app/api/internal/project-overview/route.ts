import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { isPublicDemoPrincipal, loadPublicDemoProject } from '@/lib/auth/publicDemo';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import {
  focusAssessmentCacheId,
  focusProjectStateVersion,
  getCachedFocusAssessment,
} from '@/lib/focus/focusCache';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import {
  overviewProjectStateVersion,
  projectOverviewAssessmentCacheId,
  getProjectOverviewAssessmentWithMetadata,
} from '@/lib/overview/projectOverviewCache';
import { getStorageProvider, loadProjectForScope, requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { loadDurableMemories, loadUserMemoryProfile } from '@/lib/memory/serverStore';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid workspace overview request.' },
      { status: 400 },
    );
  }

  try {
    const principal = await requireAuthenticatedPrincipal(request, parsed.data.userId);
    const userId = principal.uid;
    const storage = isPublicDemoPrincipal(principal) ? requireFirestoreStorage() : getStorageProvider();
    const loaded = isPublicDemoPrincipal(principal)
      ? null
      : await loadProjectForScope(userId, parsed.data.projectId);
    const project = isPublicDemoPrincipal(principal)
      ? await loadPublicDemoProject(principal, storage, parsed.data.projectId)
      : loaded!.project;
    const scope = isPublicDemoPrincipal(principal)
      ? { type: 'project' as const, projectId: project.id }
      : loaded!.scope;
    const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    const durableMemories = await loadDurableMemories(userId, profile);

    const contextPack = await buildContextPackForUser({
      userId,
      query: 'What is the current strategic state of this project?',
      project,
      profile,
      durableMemories,
      scope,
      includeBroadContext: true,
      graphReasoning: true,
      reasoningMode: 'reasoning',
    });

    let focusAssessment = null;
    if (isPublicDemoPrincipal(principal)) {
      // Public demo reads are cache-only. In particular, a cache miss must not
      // turn opening Overview into a Focus or Overview AI generation.
      const focusVersion = await focusProjectStateVersion(project, contextPack, profile);
      const focusCache = await storage.getFocusAssessment(
        userId,
        focusAssessmentCacheId(project.id, focusVersion),
      );
      focusAssessment = focusCache?.assessment ?? null;
      const overviewVersion = await overviewProjectStateVersion(
        project,
        project.historyEvents ?? [],
        focusAssessment,
        contextPack,
        profile,
      );
      const cached = await storage.getProjectOverviewAssessment(
        userId,
        projectOverviewAssessmentCacheId(project.id, overviewVersion),
      );
      return NextResponse.json({
        assessment: cached?.assessment ?? null,
        cache: { status: 'hit' as const, projectStateVersion: overviewVersion },
      });
    }

    try {
      focusAssessment = await getCachedFocusAssessment(
        userId,
        project,
        contextPack,
        profile,
      );
    } catch {
      // Overview can still be assessed without the tactical Focus input.
    }

    const result = await getProjectOverviewAssessmentWithMetadata(
      userId,
      project,
      project.historyEvents ?? [],
      focusAssessment,
      contextPack,
      { profile },
    );

    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof StorageError && error.code === 'PERMISSION_DENIED'
      ? 403
      : 503;
    console.error('[Project overview assessment failed]', {
      error,
      projectId: parsed.data.projectId,
    });
    return NextResponse.json({
      error: 'The project overview is temporarily unavailable.',
    }, { status });
  }
}
