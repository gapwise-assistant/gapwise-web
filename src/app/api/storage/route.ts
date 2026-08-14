import { NextRequest, NextResponse } from 'next/server';
import { loadProject, resetDemoProject, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

export const runtime = 'nodejs';

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

  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Storage request failed.', code: 'UNAVAILABLE' },
    { status: 500 }
  );
}

async function readUserId(request: NextRequest): Promise<string> {
  const userId = request.nextUrl.searchParams.get('userId')?.trim();
  return requireAuthenticatedUserId(request, userId);
}

export async function GET(request: NextRequest) {
  try {
    const userId = await readUserId(request);
    const project = await loadProject(userId);
    return NextResponse.json({ project });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { userId?: string; action?: string; project?: unknown };
    const userId = await requireAuthenticatedUserId(request, body.userId?.trim());

    if (body.action === 'RESET') {
      const project = await resetDemoProject(userId);
      return NextResponse.json({ project });
    }

    if (!body.project || typeof body.project !== 'object') {
      throw new StorageError('Missing project payload.', 'VALIDATION_ERROR');
    }

    const project = await saveProject(userId, body.project as Parameters<typeof saveProject>[1]);
    return NextResponse.json({ project });
  } catch (error) {
    return jsonError(error);
  }
}
