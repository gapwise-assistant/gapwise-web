import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertFullAccess, requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { createSoftwareReleaseDemoForUser } from '@/lib/demo/softwareReleaseDemo';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json().catch(() => ({})));
    const principal = await requireAuthenticatedPrincipal(request, body.userId);
    assertFullAccess(principal);
    const result = await createSoftwareReleaseDemoForUser({ userId: principal.uid });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StorageError) {
      const status = error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'PERMISSION_DENIED'
          ? 403
          : error.code === 'VALIDATION_ERROR'
            ? 400
            : 503;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error('[RelayDesk software-release demo] generation failed', error);
    const diagnostic = error as Error & { generationRunId?: string; projectId?: string };
    return NextResponse.json({
      error: 'The software release demo could not be created.',
      ...(diagnostic.generationRunId ? { generationRunId: diagnostic.generationRunId } : {}),
      ...(diagnostic.projectId ? { projectId: diagnostic.projectId } : {}),
    }, { status: 500 });
  }
}
