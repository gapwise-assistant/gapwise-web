import { NextResponse } from 'next/server';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { runGapswiseOrchestrator } from '@/lib/agents/orchestrator';
import { loadProject, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { recordTrace } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const started = Date.now();
  let userId = 'unknown';
  try {
    const body = (await request.json()) as {
      userId?: string;
      input?: string;
      applyGraphUpdates?: boolean;
    };

    userId = await requireAuthenticatedUserId(request, body.userId?.trim());
    const input = body.input?.trim();
    if (!userId) throw new StorageError('Missing userId.', 'UNAUTHENTICATED');
    if (!input) throw new StorageError('Missing input.', 'VALIDATION_ERROR');

    const project = await loadProject(userId);
    const result = runGapswiseOrchestrator({
      userId,
      input,
      project,
      profile: DEFAULT_USER_PROFILE,
      applyGraphUpdates: body.applyGraphUpdates ?? false,
    });

    if (body.applyGraphUpdates) {
      await saveProject(userId, result.project);
    }

    recordTrace({
      userId,
      route: '/api/agents/turn',
      label: 'Agent turn',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      agentNames: result.trace.agentEvents.map((event) => event.agentName),
      contextIds: result.contextPack.includedContextIds,
      scores: [],
      toolCalls: ['buildContextPack', 'runGapswiseOrchestrator'],
    });

    return NextResponse.json(result);
  } catch (error) {
    recordTrace({
      userId,
      route: '/api/agents/turn',
      label: 'Agent turn failed',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      agentNames: [],
      contextIds: [],
      scores: [],
      toolCalls: [],
      error: error instanceof Error ? error.message : 'Agent turn failed.',
    });
    const message = error instanceof Error ? error.message : 'Agent turn failed.';
    return NextResponse.json({ error: message }, { status: error instanceof StorageError ? 400 : 500 });
  }
}
