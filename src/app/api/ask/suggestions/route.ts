import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { isPublicDemoPrincipal, loadPublicDemoProject } from '@/lib/auth/publicDemo';
import { getStorageProvider, requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { hasValidAskSuggestionsLease } from '@/lib/ask/suggestionsLease';

export const runtime = 'nodejs';

const projectRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1),
});

const assessmentStatuses = new Set(['preparing', 'ready', 'stale', 'failed']);

async function readRequest(request: Request): Promise<{ userId?: string; projectId: string }> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    return projectRequestSchema.parse({
      userId: url.searchParams.get('userId') ?? undefined,
      projectId: url.searchParams.get('projectId'),
    });
  }
  return projectRequestSchema.parse(await request.json());
}

async function readSavedSuggestions(request: Request): Promise<NextResponse> {
  let parsed: { userId?: string; projectId: string };
  try {
    parsed = await readRequest(request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'A projectId is required to load suggestions.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid suggestions request.' }, { status: 400 });
  }

  let principal: Awaited<ReturnType<typeof requireAuthenticatedPrincipal>>;
  try {
    principal = await requireAuthenticatedPrincipal(request, parsed.userId);
  } catch (error) {
    const status = error instanceof StorageError && error.code === 'PERMISSION_DENIED' ? 403 : 401;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status });
  }

  try {
    const userId = principal.uid;
    const storage = isPublicDemoPrincipal(principal) ? requireFirestoreStorage() : getStorageProvider();
    if (isPublicDemoPrincipal(principal)) {
      await loadPublicDemoProject(principal, storage, parsed.projectId);
    }
    const currentProjectVersion = await storage.getProjectSemanticVersion(userId, parsed.projectId);
    if (currentProjectVersion === null) {
      return NextResponse.json({ error: 'The requested workspace was not found.' }, { status: 404 });
    }
    const latest = await storage.getLatestAskSuggestionsCache(userId, parsed.projectId);

    if (latest && latest.projectId !== parsed.projectId) {
      return NextResponse.json({ error: 'Suggestions are unavailable for this workspace.' }, { status: 503 });
    }
    const requestedVersion = latest?.requestedSemanticProjectVersion ?? latest?.semanticProjectVersion;
    const leaseExpired = latest?.status === 'preparing' && !hasValidAskSuggestionsLease(latest);
    const status = !latest
      ? 'preparing'
      : requestedVersion && requestedVersion !== currentProjectVersion
        ? 'stale'
        : leaseExpired
          ? 'stale'
        : latest.status && assessmentStatuses.has(latest.status)
          ? latest.status
          : 'ready';

    return NextResponse.json({
      topQuestions: latest?.topQuestions ?? [],
      otherQuestions: latest?.otherQuestions ?? [],
      projectId: parsed.projectId,
      semanticVersion: latest?.publishedInputVersion ?? latest?.projectStateVersion ?? currentProjectVersion,
      ...(latest?.generatedAt ?? latest?.updatedAt ? { generatedAt: latest.generatedAt ?? latest.updatedAt } : {}),
      status,
      cached: true,
      ...(latest?.generatedBy ? { generatedBy: latest.generatedBy } : {}),
    });
  } catch (error) {
    console.error('[Gapwise Ask suggestions read]', {
      projectId: parsed.projectId,
      message: error instanceof Error ? error.message : 'unknown-error',
    });
    return NextResponse.json({ error: 'Suggestions are unavailable right now.' }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return readSavedSuggestions(request);
}

/** Kept as a compatibility method for existing clients; it remains read-only. */
export async function POST(request: Request) {
  return readSavedSuggestions(request);
}
