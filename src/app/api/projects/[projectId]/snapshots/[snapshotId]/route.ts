import { NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getStorageProvider } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { materializeProjectSnapshot } from '@/lib/history/projectSnapshots';

export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  const status = error instanceof StorageError
    ? error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'VALIDATION_ERROR' ? 400 : 503
    : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Project snapshot request failed.' }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; snapshotId: string }> },
) {
  try {
    const { projectId, snapshotId } = await params;
    const userId = await requireAuthenticatedUserId(request, new URL(request.url).searchParams.get('userId') ?? undefined);
    const storage = getStorageProvider();
    const project = await storage.getProject(userId, projectId);
    const snapshot = await storage.getProjectSnapshot(userId, snapshotId);
    if (!project || !snapshot || snapshot.projectId !== projectId) {
      throw new StorageError('The requested project snapshot was not found.', 'PERMISSION_DENIED');
    }
    return NextResponse.json(await materializeProjectSnapshot({ userId, snapshotId }));
  } catch (error) {
    return errorResponse(error);
  }
}
