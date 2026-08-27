import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { FIRESTORE_REQUIRED_MESSAGE, requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import {
  DESTRUCTIVE_HISTORY_RESET_CONFIRMATION,
  getLocalHistoryResetPreview,
  rebuildHistoryDemosForUser,
} from '@/lib/demo/rebuildHistoryDemos';

export const runtime = 'nodejs';

const requestSchema = z.object({
  confirm: z.literal(DESTRUCTIVE_HISTORY_RESET_CONFIRMATION),
}).strict();

function jsonError(error: unknown) {
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
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'History demo rebuild failed.' },
    { status: 500 },
  );
}

function assertDestructiveResetEnabled(): void {
  const configured = process.env.ENABLE_DESTRUCTIVE_DEV_RESET?.trim().toLowerCase();
  if (configured === 'false' || configured === '0') {
    throw new StorageError('Destructive local history rebuild is disabled. Set ENABLE_DESTRUCTIVE_DEV_RESET=true to enable it.', 'PERMISSION_DENIED');
  }
}

async function storageForLocalUser(request: NextRequest) {
  const userId = await requireAuthenticatedUserId(request);
  const storage = requireFirestoreStorage();
  // Force a small read before presenting a preview or beginning the rebuild so
  // missing credentials/database configuration fails before any mutation.
  await storage.getAppScope(userId);
  return { storage, userId };
}

export async function GET(request: NextRequest) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({ error: 'History demo rebuild is available only on localhost.' }, { status: 404 });
  }
  try {
    const { storage, userId } = await storageForLocalUser(request);
    return NextResponse.json({ preview: await getLocalHistoryResetPreview(storage, userId) });
  } catch (error) {
    if (error instanceof Error && error.message === FIRESTORE_REQUIRED_MESSAGE) {
      return NextResponse.json({ error: FIRESTORE_REQUIRED_MESSAGE }, { status: 503 });
    }
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({ error: 'History demo rebuild is available only on localhost.' }, { status: 404 });
  }
  try {
    assertDestructiveResetEnabled();
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `Exact confirmation required: ${DESTRUCTIVE_HISTORY_RESET_CONFIRMATION}` }, { status: 400 });
    }
    const { storage, userId } = await storageForLocalUser(request);
    const result = await rebuildHistoryDemosForUser({ storage, userId });
    return NextResponse.json(result, { status: result.partialFailures.length > 0 ? 207 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === FIRESTORE_REQUIRED_MESSAGE) {
      return NextResponse.json({ error: FIRESTORE_REQUIRED_MESSAGE }, { status: 503 });
    }
    return jsonError(error);
  }
}
