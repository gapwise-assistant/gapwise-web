import { NextResponse } from 'next/server';
import { listTraces } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const userId = await requireAuthenticatedUserId(request, url.searchParams.get('userId') ?? undefined);
    return NextResponse.json({ traces: listTraces(userId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }
}
