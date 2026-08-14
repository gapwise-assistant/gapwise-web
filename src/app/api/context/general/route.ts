import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadGeneralContext, saveGeneralContext } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { Project } from '@/types/clarity';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

export const runtime = 'nodejs';

const saveSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  context: z.object({}).passthrough(),
});

function jsonError(error: unknown) {
  const status = error instanceof StorageError && error.code === 'UNAUTHENTICATED' ? 401 : 400;
  return NextResponse.json({ error: error instanceof Error ? error.message : 'General context request failed.' }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireAuthenticatedUserId(request, request.nextUrl.searchParams.get('userId')?.trim());
    return NextResponse.json({ context: await loadGeneralContext(userId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = saveSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const context = await saveGeneralContext(userId, body.context as unknown as Project);
    return NextResponse.json({ context });
  } catch (error) {
    return jsonError(error);
  }
}
