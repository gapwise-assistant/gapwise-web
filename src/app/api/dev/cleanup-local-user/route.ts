import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import {
  cleanupLocalUserData,
  getLocalCleanupPreview,
  LOCAL_DATA_CLEANUP_CONFIRMATION,
} from '@/lib/demo/cleanupLocalUserData';

export const runtime = 'nodejs';

const requestSchema = z.object({
  confirm: z.literal(LOCAL_DATA_CLEANUP_CONFIRMATION),
}).strict();

const LOCAL_CLEANUP_FIRESTORE_REQUIRED_MESSAGE =
  'Local Gapwise data cleanup requires Firestore. Configure Firebase credentials and enable Firestore before continuing.';

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
    { error: error instanceof Error ? error.message : 'Local data cleanup failed.' },
    { status: 500 },
  );
}

function assertCleanupEnabled(): void {
  if (process.env.ENABLE_DESTRUCTIVE_DEV_RESET !== 'true') {
    throw new StorageError(
      'Local data cleanup is disabled. Set ENABLE_DESTRUCTIVE_DEV_RESET=true to enable it.',
      'PERMISSION_DENIED',
    );
  }
}

async function storageForLocalUser(request: NextRequest) {
  const userId = await requireAuthenticatedUserId(request);
  let storage: ReturnType<typeof requireFirestoreStorage>;
  try {
    storage = requireFirestoreStorage();
  } catch {
    throw new StorageError(LOCAL_CLEANUP_FIRESTORE_REQUIRED_MESSAGE, 'CONFIGURATION_ERROR');
  }
  // Force a read before presenting a preview or mutating anything so missing
  // Firestore configuration fails clearly instead of falling back to mock data.
  await storage.getAppScope(userId);
  return { storage, userId };
}

export async function GET(request: NextRequest) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({ error: 'Local data cleanup is available only on localhost.' }, { status: 404 });
  }

  try {
    assertCleanupEnabled();
    const { storage, userId } = await storageForLocalUser(request);
    return NextResponse.json({ preview: await getLocalCleanupPreview(storage, userId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({ error: 'Local data cleanup is available only on localhost.' }, { status: 404 });
  }

  try {
    assertCleanupEnabled();
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Exact confirmation required: ${LOCAL_DATA_CLEANUP_CONFIRMATION}` },
        { status: 400 },
      );
    }
    const { storage, userId } = await storageForLocalUser(request);
    const result = await cleanupLocalUserData({ storage, userId });
    const resetFailed = result.partialFailures.some((failure) => failure.stage === 'reset');
    return NextResponse.json(result, { status: resetFailed ? 500 : result.partialFailures.length > 0 ? 207 : 200 });
  } catch (error) {
    return jsonError(error);
  }
}
