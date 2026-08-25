import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { getCachedFocusAssessment } from '@/lib/focus/focusCache';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import {
  getCachedProjectOverviewAssessment,
} from '@/lib/overview/projectOverviewCache';
import { loadProjectForScope } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid project overview request.' },
      { status: 400 },
    );
  }

  try {
    const userId = await requireAuthenticatedUserId(
      request,
      parsed.data.userId,
    );
    const { project, scope } = await loadProjectForScope(
      userId,
      parsed.data.projectId,
    );

    const contextPack = await buildContextPackForUser({
      userId,
      query: 'What is the current strategic state of this project?',
      project,
      profile: DEFAULT_USER_PROFILE,
      scope,
      includeBroadContext: true,
    });

    let focusAssessment = null;
    try {
      focusAssessment = await getCachedFocusAssessment(
        userId,
        project,
        contextPack,
        DEFAULT_USER_PROFILE,
      );
    } catch {
      // Overview can still be assessed without the tactical Focus input.
    }

    const assessment = await getCachedProjectOverviewAssessment(
      userId,
      project,
      project.historyEvents ?? [],
      focusAssessment,
      contextPack,
    );

    return NextResponse.json({ assessment });
  } catch (error) {
    const status = error instanceof StorageError && error.code === 'PERMISSION_DENIED'
      ? 403
      : 503;
    return NextResponse.json({
      error: error instanceof Error
        ? error.message
        : 'Project overview assessment failed.',
    }, { status });
  }
}
