import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { loadProjectForScope } from '@/lib/storage';

export const runtime = 'nodejs';

const contextPackRequestSchema = z.object({
  userId: z.string().trim().min(1, 'userId is required'),
  query: z.string().trim().min(1, 'query is required'),
  projectId: z.string().trim().min(1).optional(),
  includeBroadContext: z.boolean().optional(),
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

  const { project, scope } = await loadProjectForScope(parsed.data.userId, parsed.data.projectId);
  const contextPack = await buildContextPackForUser({
    userId: parsed.data.userId,
    query: parsed.data.query,
    project,
    profile: DEFAULT_USER_PROFILE,
    scope,
    includeBroadContext: parsed.data.includeBroadContext,
  });

  return NextResponse.json({ contextPack });
}
