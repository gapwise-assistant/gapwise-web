import { NextResponse } from 'next/server';
import { listTraces } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getAgentModelPolicy } from '@/lib/agents/modelPolicy';
import { isDemoMode } from '@/lib/runtime/demoMode';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const userId = await requireAuthenticatedUserId(request, url.searchParams.get('userId') ?? undefined);
    const execution = isDemoMode() ? 'not_used' : 'would_use';
    const agentPolicy = Object.values(getAgentModelPolicy()).map((config) => ({
      agentName: `${config.role[0].toUpperCase()}${config.role.slice(1)} Agent`,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      maxOutputTokens: config.maxOutputTokens,
      execution,
    }));
    return NextResponse.json({ traces: listTraces(userId), agentPolicy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }
}
