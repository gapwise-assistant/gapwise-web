import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadGoldenDemoForUser } from '@/lib/demo/bootstrap';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
});

function jsonError(error: unknown) {
  if (error instanceof StorageError) {
    const status =
      error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'PERMISSION_DENIED'
          ? 403
          : error.code === 'VALIDATION_ERROR'
            ? 400
            : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid demo request.', issues: error.issues }, { status: 400 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Demo data could not be loaded.', code: 'UNAVAILABLE' },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json().catch(() => ({})));
    const userId = await requireAuthenticatedUserId(request, body.userId);
    return NextResponse.json(await loadGoldenDemoForUser(userId));
  } catch (error) {
    return jsonError(error);
  }
}
