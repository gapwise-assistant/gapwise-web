import { NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { materializeProjectSnapshot } from '@/lib/history/projectSnapshots';

export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  const status = error instanceof StorageError
    ? error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'VALIDATION_ERROR' ? 400 : 503
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
    const storage = requireFirestoreStorage();
    const project = await storage.getProject(userId, projectId);
    const snapshot = await storage.getProjectSnapshot(userId, snapshotId);
    if (!project) throw new StorageError('The project does not exist.', 'NOT_FOUND');
    if (!snapshot) throw new StorageError('The requested project snapshot was not found.', 'NOT_FOUND');
    if (snapshot.projectId !== projectId) throw new StorageError('The requested snapshot belongs to another project.', 'PERMISSION_DENIED');
    return NextResponse.json(await materializeProjectSnapshot({ userId, snapshotId }));
  } catch (error) {
    return errorResponse(error);
  }
}
