import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { focusAssessmentCacheId, focusProjectStateVersion, getCachedFocusAssessment } from '@/lib/focus/focusCache';
import { normalizeFocusAssessment } from '@/lib/focus/normalizeFocusAssessment';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { getStorageProvider, loadProjectForScope } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';

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
    const contextPack = await buildContextPackForUser({
      userId,
      query: 'What needs my attention today?',
      project,
      profile: DEFAULT_USER_PROFILE,
      scope,
      includeBroadContext: true,
      reasoningMode: 'focus',
    });
    const focusAssessment = await getCachedFocusAssessment(userId, project, contextPack, DEFAULT_USER_PROFILE);
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
    const userId = await requireAuthenticatedUserId(request, parsed.data.userId);
    const { project } = await loadProjectForScope(userId, parsed.data.projectId);
    const projectStateVersion = await focusProjectStateVersion(project);
    const cacheId = focusAssessmentCacheId(project.id, projectStateVersion);
    const cached = await getStorageProvider().getFocusAssessment(userId, cacheId);
    return NextResponse.json({
      focusAssessment: cached?.assessment
        ? normalizeFocusAssessment(project, cached.assessment)
        : null,
      cached: Boolean(cached),
    });
  } catch (error) {
    const status = error instanceof StorageError && error.code === 'PERMISSION_DENIED' ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Focus assessment lookup failed.' }, { status });
  }
}
