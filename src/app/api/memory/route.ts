import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadDurableMemories, replaceDurableMemories } from '@/lib/memory/serverStore';
import { StorageError } from '@/lib/storage/types';
import { DurableMemory } from '@/types/contextPack';

export const runtime = 'nodejs';

const memorySchema = z.object({
  id: z.string().min(1),
  userId: z.string().optional(),
  category: z.enum(['career', 'communication', 'learning', 'current_priorities', 'custom']),
  text: z.string().min(1),
  source: z.enum(['explicit', 'repeated_fact', 'user_confirmed', 'seed']),
  source_refs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  status: z.enum(['active', 'forgotten']).optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  last_confirmed_at: z.string().optional(),
  lastConfirmedAt: z.string().optional(),
  expires_at: z.string().optional(),
  forgotten_at: z.string().optional(),
  why_remembered: z.string().min(1),
  provenance: z.string().optional(),
});

const replaceRequestSchema = z.object({
  userId: z.string().trim().min(1),
  memories: z.array(memorySchema),
});

function jsonError(error: unknown) {
  if (error instanceof StorageError) {
    const status =
      error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'PERMISSION_DENIED'
          ? 403
          : error.code === 'VALIDATION_ERROR'
            ? 400
            : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid memory request.', issues: error.issues }, { status: 400 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Memory request failed.', code: 'UNAVAILABLE' },
    { status: 500 }
  );
}

function readUserId(request: NextRequest): string {
  const userId = request.nextUrl.searchParams.get('userId')?.trim();
  if (!userId) {
    throw new StorageError('Missing userId.', 'UNAUTHENTICATED');
  }
  return userId;
}

export async function GET(request: NextRequest) {
  try {
    const userId = readUserId(request);
    const memories = await loadDurableMemories(userId, DEFAULT_USER_PROFILE);
    return NextResponse.json({ memories });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = replaceRequestSchema.parse(await request.json());
    const memories = await replaceDurableMemories(body.userId, body.memories as DurableMemory[]);
    return NextResponse.json({ memories });
  } catch (error) {
    return jsonError(error);
  }
}
