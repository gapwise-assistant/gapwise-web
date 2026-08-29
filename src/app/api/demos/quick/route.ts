import { NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { createQuickDemoForUser } from '@/lib/demo/quickDemo';
import { requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const FIRESTORE_MESSAGE =
  'Quick Gapwise demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { userId?: string };
    const userId = await requireAuthenticatedUserId(request, body.userId?.trim());
    const storage = requireFirestoreStorage();
    await storage.getAppScope(userId);
    const result = await createQuickDemoForUser({ userId, storage });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof StorageError) {
      const status = error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'PERMISSION_DENIED'
          ? 403
          : error.code === 'CONFIGURATION_ERROR' || error.code === 'UNAVAILABLE'
            ? 503
            : 400;
      const message = error.code === 'CONFIGURATION_ERROR' || error.code === 'UNAVAILABLE'
        ? FIRESTORE_MESSAGE
        : error.message;
      return NextResponse.json({ error: message, code: error.code }, { status });
    }
    console.error('[Quick Gapwise demo] generation failed', error);
    return NextResponse.json({ error: 'The quick Gapwise demo could not be created.' }, { status: 500 });
  }
}
