import { NextResponse } from 'next/server';
import { isDemoMode } from '@/lib/runtime/demoMode';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ demoMode: process.env.NODE_ENV !== 'production' && isDemoMode() });
}
