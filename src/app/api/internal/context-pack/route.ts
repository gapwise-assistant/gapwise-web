import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadDurableMemories, loadUserMemoryProfile } from '@/lib/memory/serverStore';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { loadProjectForScope } from '@/lib/storage';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const contextPackRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1, 'query is required'),
  projectId: z.string().trim().min(1).optional(),
  chatId: z.string().trim().min(1).optional(),
  includeBroadContext: z.boolean().optional(),
  excludeMessageId: z.string().trim().min(1).optional(),
  excludeSourceId: z.string().trim().min(1).optional(),
  graphReasoning: z.boolean().optional(),
  reasoningMode: z.enum(['factual', 'reasoning', 'impact', 'decision', 'focus']).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = contextPackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid context pack request.',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, parsed.data.userId);
  } catch (error) {
    const status = error instanceof StorageError && error.code === 'PERMISSION_DENIED' ? 403 : 401;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status });
  }

  const { project, scope } = await loadProjectForScope(userId, parsed.data.projectId);
  const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
  const durableMemories = await loadDurableMemories(userId, profile);
  const contextPack = await buildContextPackForUser({
    userId,
    query: parsed.data.query,
    project,
    profile,
    durableMemories,
    scope,
    includeBroadContext: parsed.data.includeBroadContext,
    excludeMessageId: parsed.data.excludeMessageId,
    excludeSourceId: parsed.data.excludeSourceId,
    graphReasoning: parsed.data.graphReasoning,
    reasoningMode: parsed.data.reasoningMode,
  });

  return NextResponse.json({ contextPack });
}
