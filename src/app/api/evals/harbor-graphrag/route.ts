import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { runHarborGraphRagJourney } from '@/lib/evals/harborGraphRagJourney';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().regex(/^harbor-graphrag-eval-[A-Za-z0-9_-]+$/),
  runId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/),
  confirmLiveAiCost: z.literal(true),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success || parsed.data.userId !== `harbor-graphrag-eval-${parsed.data.runId}`) {
    return NextResponse.json({ error: 'Invalid Harbor GraphRAG evaluation identity or confirmation.' }, { status: 400 });
  }

  try {
    // This endpoint is deliberately restricted to localhost for the CLI's
    // local evaluation workflow. Deployed callers must still authenticate,
    // but the runner will continue to enforce the dedicated user identity.
    if (!isLocalhostRequest(request)) {
      const authenticatedUserId = await requireAuthenticatedUserId(request, parsed.data.userId);
      if (authenticatedUserId !== parsed.data.userId) {
        return NextResponse.json({ error: 'Harbor evaluation identity mismatch.' }, { status: 403 });
      }
    }
    const report = await runHarborGraphRagJourney(parsed.data);
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Harbor GraphRAG evaluation failed.',
    }, { status: 400 });
  }
}

