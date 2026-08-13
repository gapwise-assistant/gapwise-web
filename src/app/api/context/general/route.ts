import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadGeneralContext, saveGeneralContext } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { Project } from '@/types/clarity';

export const runtime = 'nodejs';

const saveSchema = z.object({
  userId: z.string().trim().min(1),
  context: z.object({}).passthrough(),
});

function jsonError(error: unknown) {
  const status = error instanceof StorageError && error.code === 'UNAUTHENTICATED' ? 401 : 400;
  return NextResponse.json({ error: error instanceof Error ? error.message : 'General context request failed.' }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId')?.trim();
    if (!userId) throw new StorageError('Missing userId.', 'UNAUTHENTICATED');
    return NextResponse.json({ context: await loadGeneralContext(userId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = saveSchema.parse(await request.json());
    const context = await saveGeneralContext(body.userId, body.context as unknown as Project);
    return NextResponse.json({ context });
  } catch (error) {
    return jsonError(error);
  }
}
