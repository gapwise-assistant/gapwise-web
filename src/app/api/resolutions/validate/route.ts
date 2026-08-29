import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { StorageError } from '@/lib/storage/types';
import { validateProjectResolution } from '@/lib/resolutions/resolutionValidation';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1),
  nodeId: z.string().trim().min(1),
  proposedResponse: z.string().trim().min(1).max(5000),
});

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid resolution check request.' }, { status: 400 });
  if (error instanceof StorageError) {
    const status = error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'VALIDATION_ERROR' ? 400 : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  console.error('[Resolution validation route] failed', error);
  return NextResponse.json({ error: 'Resolution checking is unavailable.' }, { status: 503 });
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const result = await validateProjectResolution(body.projectId === '__general_context__'
      ? { ...body, userId }
      : { ...body, userId });
    return NextResponse.json({ validation: result.validation, fingerprint: result.fingerprint });
  } catch (error) {
    return errorResponse(error);
  }
}
