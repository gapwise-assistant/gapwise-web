import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadHarborHotelsCheckpointForUser } from '@/lib/demo/bootstrap';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json().catch(() => ({})));
    const userId = await requireAuthenticatedUserId(request, body.userId);
    return NextResponse.json(await loadHarborHotelsCheckpointForUser(userId, 'middle'));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Harbor Hotels middle checkpoint failed.',
    }, { status: 500 });
  }
}
