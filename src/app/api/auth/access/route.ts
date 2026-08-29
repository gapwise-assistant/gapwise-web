import { NextResponse } from 'next/server';
import { requireAuthenticatedPrincipal } from '@/lib/auth/server';
import { publicDemoMessagesRemaining, isPublicDemoPrincipal } from '@/lib/auth/publicDemo';
import { requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const principal = await requireAuthenticatedPrincipal(request);
    let remaining: number | null = null;
    if (isPublicDemoPrincipal(principal)) {
      const usage = await requireFirestoreStorage().getPublicDemoUsage(principal.uid);
      remaining = publicDemoMessagesRemaining(usage);
    }
    return NextResponse.json({
      accessTier: principal.accessTier,
      publicDemoMessagesRemaining: remaining,
    });
  } catch (error) {
    const status = error instanceof StorageError && error.code === 'UNAUTHENTICATED' ? 401 : 503;
    return NextResponse.json({ error: 'Access configuration is unavailable.' }, { status });
  }
}
