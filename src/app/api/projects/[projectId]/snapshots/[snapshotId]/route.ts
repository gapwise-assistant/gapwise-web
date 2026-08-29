import { NextResponse } from 'next/server';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { assertPublicDemoProject, isPublicDemoPrincipal } from '@/lib/auth/publicDemo';
import { getStorageProvider, requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { materializeProjectSnapshot } from '@/lib/history/projectSnapshots';

export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  const status = error instanceof StorageError
    ? error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'VALIDATION_ERROR' ? 400 : 503
    : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Workspace snapshot request failed.' }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; snapshotId: string }> },
) {
  try {
    const { projectId, snapshotId } = await params;
    const principal = await requireAuthenticatedPrincipal(request, new URL(request.url).searchParams.get('userId') ?? undefined);
    const userId = principal.uid;
    const storage = isPublicDemoPrincipal(principal)
      ? requireFirestoreStorage()
      : getStorageProvider();
    const usage = isPublicDemoPrincipal(principal) ? await storage.getPublicDemoUsage(userId) : null;
    assertPublicDemoProject(principal, projectId, usage);
    const project = await storage.getProject(userId, projectId);
    const snapshot = await storage.getProjectSnapshot(userId, snapshotId);
    if (!project) throw new StorageError('The workspace does not exist.', 'NOT_FOUND');
    if (!snapshot) throw new StorageError('The requested workspace snapshot was not found.', 'NOT_FOUND');
    if (snapshot.projectId !== projectId) throw new StorageError('The requested snapshot belongs to another workspace.', 'PERMISSION_DENIED');
    return NextResponse.json(await materializeProjectSnapshot({ userId, snapshotId }));
  } catch (error) {
    return errorResponse(error);
  }
}
