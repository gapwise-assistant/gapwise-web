import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { createHarborHistoryDemoForUser } from '@/lib/demo/harborHistory';
import { FIRESTORE_REQUIRED_MESSAGE, requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  fresh: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({ error: 'Harbor history demos are available only on localhost.' }, { status: 404 });
  }

  try {
    const body = requestSchema.parse(await request.json().catch(() => ({})));
    const userId = await requireAuthenticatedUserId(request, body.userId);
    try {
      const storage = requireFirestoreStorage();
      // A lightweight read verifies that credentials and the configured
      // Firestore database are reachable before the multi-step demo begins.
      await storage.getAppScope(userId);
    } catch {
      return NextResponse.json({ error: FIRESTORE_REQUIRED_MESSAGE }, { status: 503 });
    }
    const result = await createHarborHistoryDemoForUser({ userId, fresh: body.fresh });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof StorageError && error.code === 'UNAUTHENTICATED') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const diagnostic = error as Error & { generationRunId?: string; projectId?: string };
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'The Harbor history demo could not be created.',
      ...(diagnostic.generationRunId ? { generationRunId: diagnostic.generationRunId } : {}),
      ...(diagnostic.projectId ? { projectId: diagnostic.projectId } : {}),
    }, { status: 500 });
  }
}
