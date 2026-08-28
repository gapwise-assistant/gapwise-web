import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getStorageProvider } from '@/lib/storage';

export const runtime = 'nodejs';

const projectRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1),
});

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

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, parsed.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }

  try {
    const storage = getStorageProvider();
    const currentProjectVersion = await storage.getProjectSemanticVersion(userId, parsed.projectId);
    if (currentProjectVersion === null) {
      return NextResponse.json({ error: 'The requested workspace was not found.' }, { status: 404 });
    }

    const latest = await storage.getLatestAskSuggestionsCache(userId, parsed.projectId);
    const status = latest?.status
      ?? (latest && latest.semanticProjectVersion && currentProjectVersion
        && latest.semanticProjectVersion !== currentProjectVersion
        ? 'stale'
        : latest
          ? 'ready'
          : 'preparing');

    return NextResponse.json({
      topQuestions: latest?.topQuestions ?? [],
      otherQuestions: latest?.otherQuestions ?? [],
      projectId: parsed.projectId,
      ...(latest?.projectStateVersion ? { semanticVersion: latest.projectStateVersion } : {}),
      ...(latest?.updatedAt ? { generatedAt: latest.updatedAt } : {}),
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
