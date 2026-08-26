import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getStorageProvider, setActiveProjectId, setAppScope } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { branchProjectFromSnapshot, createProjectSnapshot } from '@/lib/history/projectSnapshots';

export const runtime = 'nodejs';

const branchSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  requestedTitle: z.string().trim().min(1).max(180).optional(),
  clientRequestId: z.string().trim().min(1).max(180).optional(),
});

function errorResponse(error: unknown) {
  const status = error instanceof StorageError
    ? error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'VALIDATION_ERROR' ? 400 : 503
    : 500;
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Project branch failed.' }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; snapshotId: string }> },
) {
  try {
    const { projectId, snapshotId } = await params;
    const body = branchSchema.parse(await request.json().catch(() => ({})));
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const snapshot = await getStorageProvider().getProjectSnapshot(userId, snapshotId);
    if (!snapshot || snapshot.projectId !== projectId) {
      throw new StorageError('The requested project snapshot was not found.', 'PERMISSION_DENIED');
    }
    const result = await branchProjectFromSnapshot({
      userId,
      snapshotId,
      requestedTitle: body.requestedTitle,
      clientRequestId: body.clientRequestId,
    });
    await setAppScope(userId, { type: 'project', projectId: result.project.id });
    await setActiveProjectId(userId, result.project.id);
    try {
      await createProjectSnapshot({
        userId,
        projectId: result.project.id,
        trigger: { type: 'project_created' },
        label: 'Project branched',
        summary: `Created from ${'projectState' in snapshot ? snapshot.projectState.title : snapshot.project.title}.`,
      });
    } catch (error) {
      console.warn('[Project snapshots] branch snapshot unavailable', error);
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return error instanceof z.ZodError
      ? NextResponse.json({ error: 'Invalid project branch request.', issues: error.issues }, { status: 400 })
      : errorResponse(error);
  }
}
