import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedPrincipal, requireAuthenticatedUserId } from '@/lib/auth/server';
import { isPublicDemoPrincipal, loadPublicDemoProject } from '@/lib/auth/publicDemo';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { focusAssessmentCacheId, focusProjectStateVersion, getCachedFocusAssessment } from '@/lib/focus/focusCache';
import { normalizeFocusAssessment } from '@/lib/focus/normalizeFocusAssessment';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
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
  if (!parsed.success) return NextResponse.json({ error: 'Invalid focus assessment request.' }, { status: 400 });
  try {
    const userId = await requireAuthenticatedUserId(request, parsed.data.userId);
    const { project, scope } = await loadProjectForScope(userId, parsed.data.projectId);
    const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    const durableMemories = await loadDurableMemories(userId, profile);
    const contextPack = await buildContextPackForUser({
      userId,
      query: 'What needs my attention today?',
      project,
      profile,
      durableMemories,
      scope,
      includeBroadContext: true,
      reasoningMode: 'focus',
    });
    const focusAssessment = await getCachedFocusAssessment(userId, project, contextPack, profile);
    return NextResponse.json({ focusAssessment });
  } catch (error) {
    const status = error instanceof StorageError && error.code === 'PERMISSION_DENIED' ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Focus assessment failed.' }, { status });
  }
}

/** Read-only cache lookup for debug surfaces. It never generates a new focus assessment. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = requestSchema.safeParse({
    userId: url.searchParams.get('userId') ?? undefined,
    projectId: url.searchParams.get('projectId') ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: 'Invalid focus assessment request.' }, { status: 400 });
  try {
    const principal = await requireAuthenticatedPrincipal(request, parsed.data.userId);
    const userId = principal.uid;
    const storage = isPublicDemoPrincipal(principal) ? requireFirestoreStorage() : getStorageProvider();
    const project = isPublicDemoPrincipal(principal)
      ? await loadPublicDemoProject(principal, storage, parsed.data.projectId)
      : (await loadProjectForScope(userId, parsed.data.projectId)).project;
    const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    const durableMemories = await loadDurableMemories(userId, profile);
    const contextPack = await buildContextPackForUser({
      userId,
      query: 'What needs my attention today?',
      project,
      profile,
      durableMemories,
      includeBroadContext: true,
      reasoningMode: 'focus',
    });
    const projectStateVersion = await focusProjectStateVersion(project, contextPack, profile);
    const cacheId = focusAssessmentCacheId(project.id, projectStateVersion);
    const cached = await storage.getFocusAssessment(userId, cacheId);
    return NextResponse.json({
      focusAssessment: cached?.assessment
        ? normalizeFocusAssessment(project, cached.assessment)
        : null,
      cached: Boolean(cached),
    });
  } catch (error) {
    const status = error instanceof StorageError
      ? error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'PERMISSION_DENIED'
          ? 403
          : error.code === 'NOT_FOUND'
            ? 404
            : 503
      : 503;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Focus assessment lookup failed.' }, { status });
  }
}
