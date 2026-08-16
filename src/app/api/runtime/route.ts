import { NextResponse } from 'next/server';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { isLocalhostRequest } from '@/lib/runtime/localAuth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return NextResponse.json({
    demoMode: process.env.NODE_ENV !== 'production' && isDemoMode(),
    localAuth: isLocalhostRequest(request),
  });
}
