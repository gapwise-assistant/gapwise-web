import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { askGapswiseLocally } from '@/lib/ask/localDemoAdapter';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

export const runtime = 'nodejs';

const askRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1),
  sessionId: z.string().trim().optional(),
  projectId: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid Ask request.', issues: parsed.error.issues }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, parsed.data.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }

  const askInput = { ...parsed.data, userId };

  try {
    const result = isDemoMode()
      ? await askGapswiseLocally(askInput)
      : await askGapswise(askInput);
    return NextResponse.json(result);
  } catch (error) {
    if (isDemoMode()) {
      return NextResponse.json(
        { error: error instanceof Error ? `Local demo Ask failed: ${error.message}` : 'Local demo Ask failed.' },
        { status: 500 }
      );
    }
    const message = error instanceof AskAgentError
      ? error.message
      : 'Gapswise agent is unavailable right now.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
