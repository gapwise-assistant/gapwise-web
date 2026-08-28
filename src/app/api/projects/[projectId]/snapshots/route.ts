import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';

export const runtime = 'nodejs';

const triggerTypes = z.enum([
  'project_created',
  'context_processed',
  'ask_response_created',
  'ask_proposal_added',
  'ask_proposal_dismissed',
  'gap_resolved',
  'gap_reopened',
  'answer_edited',
  'decision_confirmed',
  'decision_edited',
  'action_completed',
  'focus_changed',
]);

const createSnapshotSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  trigger: z.object({
    type: triggerTypes,
    historyEventId: z.string().trim().min(1).optional(),
    sourceId: z.string().trim().min(1).optional(),
    askMessageId: z.string().trim().min(1).optional(),
    proposalId: z.string().trim().min(1).optional(),
    nodeId: z.string().trim().min(1).optional(),
  }),
  label: z.string().trim().min(1).max(180),
  summary: z.string().trim().max(1000).optional(),
});

function statusFor(error: unknown): number {
  if (!(error instanceof StorageError)) return 500;
  if (error.code === 'UNAUTHENTICATED') return 401;
  if (error.code === 'PERMISSION_DENIED') return 403;
  if (error.code === 'NOT_FOUND') return 404;
  if (error.code === 'VALIDATION_ERROR') return 400;
  return 503;
}

function errorResponse(error: unknown) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : 'Workspace snapshot request failed.',
    ...(error instanceof StorageError ? { code: error.code } : {}),
  }, { status: statusFor(error) });
}

async function assertProjectAccess(userId: string, projectId: string, storage = requireFirestoreStorage()): Promise<void> {
  const project = await storage.getProject(userId, projectId);
  if (!project) throw new StorageError('The workspace does not exist.', 'NOT_FOUND');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const userId = await requireAuthenticatedUserId(request, new URL(request.url).searchParams.get('userId') ?? undefined);
    const storage = requireFirestoreStorage();
    await assertProjectAccess(userId, projectId, storage);
    const snapshots = await storage.listProjectSnapshots(userId, projectId);
    return NextResponse.json({ snapshots });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = createSnapshotSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const storage = requireFirestoreStorage();
    await assertProjectAccess(userId, projectId, storage);
    const snapshot = await createProjectSnapshot({
      userId,
      projectId,
      trigger: body.trigger,
      label: body.label,
      summary: body.summary,
    });
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (error) {
    return error instanceof z.ZodError
      ? NextResponse.json({ error: 'Invalid workspace snapshot request.', issues: error.issues }, { status: 400 })
      : errorResponse(error);
  }
}
