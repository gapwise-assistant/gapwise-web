import { NextResponse } from 'next/server';
import { listTraces } from '@/lib/observability/trace';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId') ?? undefined;
  return NextResponse.json({ traces: listTraces(userId) });
}
