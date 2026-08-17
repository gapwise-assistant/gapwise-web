import { NextResponse } from 'next/server';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { isLocalhostRequest } from '@/lib/runtime/localAuth';
import { getConfiguredGeminiModel } from '@/lib/google/genai';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isDemoMode()) {
    try {
      // Preflight the live model selection without making a network/model call.
      getConfiguredGeminiModel();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gemini model configuration is invalid.';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  return NextResponse.json({
    demoMode: process.env.NODE_ENV !== 'production' && isDemoMode(),
    localAuth: isLocalhostRequest(request),
  });
}
