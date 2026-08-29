import { NextResponse } from 'next/server';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { createOrReuseQuickDemoForUser, createQuickDemoForUser } from '@/lib/demo/quickDemo';
import { isPublicDemoPrincipal } from '@/lib/auth/publicDemo';
import { requirePublicDemoAppCheck, PUBLIC_DEMO_APPCHECK_ERROR } from '@/lib/auth/appCheck';
import { getStorageProvider, requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const FIRESTORE_MESSAGE =
  'Quick Gapwise demo requires Firestore. Configure Firebase credentials and enable Firestore before creating it.';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { userId?: string };
    const principal = await requireAuthenticatedPrincipal(request, body.userId?.trim());
    const userId = principal.uid;
    // Public demo state must be durable and shared across reloads. Local
    // development keeps its existing configured provider so localhost tests
    // and demo mode are unchanged.
    const isPublicDemo = isPublicDemoPrincipal(principal);
    if (isPublicDemo) await requirePublicDemoAppCheck(request);
    const storage = isPublicDemo
      ? requireFirestoreStorage()
      : getStorageProvider();
    await storage.getAppScope(userId);
    const result = isPublicDemo
      ? await createOrReuseQuickDemoForUser({ userId, storage })
      : await createQuickDemoForUser({ userId, storage });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof StorageError) {
      const status = error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'PERMISSION_DENIED'
          ? 403
          : error.code === 'CONFIGURATION_ERROR' || error.code === 'UNAVAILABLE'
            ? 503
            : 400;
      const message = error.message === PUBLIC_DEMO_APPCHECK_ERROR
        ? PUBLIC_DEMO_APPCHECK_ERROR
        : error.code === 'CONFIGURATION_ERROR' || error.code === 'UNAVAILABLE'
        ? FIRESTORE_MESSAGE
        : error.message;
      return NextResponse.json({ error: message, code: error.code }, { status });
    }
    console.error('[Quick Gapwise demo] generation failed', error);
    return NextResponse.json({ error: 'The quick Gapwise demo could not be created.' }, { status: 500 });
  }
}
