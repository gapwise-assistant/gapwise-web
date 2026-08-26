import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { createHarborHistoryDemoForUser } from '@/lib/demo/harborHistory';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  fresh: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({ error: 'Harbor history demos are available only on localhost.' }, { status: 404 });
  }

  try {
    const body = requestSchema.parse(await request.json().catch(() => ({})));
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const result = await createHarborHistoryDemoForUser({ userId, fresh: body.fresh });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'The Harbor history demo could not be created.',
    }, { status: 500 });
  }
}
