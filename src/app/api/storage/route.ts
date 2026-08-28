import { NextRequest, NextResponse } from 'next/server';
import { getStorageProvider, loadProject, resetDemoProject, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import type { Project } from '@/types/clarity';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';

export const runtime = 'nodejs';

function snapshotTrigger(before: Project | null, after: Project): { type: 'decision_confirmed' | 'decision_edited' | 'gap_resolved' | 'action_completed' | 'focus_changed'; nodeId?: string; historyEventId?: string } | null {
  if (!before) return null;
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  for (const node of after.nodes) {
    const previous = beforeById.get(node.id);
    if (!previous) continue;
    if (node.type === 'DECISION' && previous.status === 'OPEN' && node.status === 'RESOLVED') {
      return { type: 'decision_confirmed', nodeId: node.id, historyEventId: latestHistoryEventId(after, 'decision_resolved', node.id) };
    }
    if (node.type === 'DECISION' && node.status === 'RESOLVED' && previous.decision_outcome !== node.decision_outcome) {
      return { type: 'decision_edited', nodeId: node.id, historyEventId: latestHistoryEventId(after, 'decision_resolved', node.id) };
    }
    if ((node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && previous.status === 'OPEN' && node.status === 'RESOLVED') {
      return { type: 'gap_resolved', nodeId: node.id, historyEventId: latestHistoryEventId(after, 'gap_resolved', node.id) };
    }
    if (node.type === 'NEXT_ACTION' && previous.status === 'OPEN' && node.status === 'RESOLVED') {
      return { type: 'action_completed', nodeId: node.id, historyEventId: latestHistoryEventId(after, 'action_completed', node.id) };
    }
  }
  const beforeFocus = before.active_question?.node_id;
  const afterFocus = after.active_question?.node_id;
  return beforeFocus !== afterFocus
    ? { type: 'focus_changed', nodeId: afterFocus, historyEventId: latestHistoryEventId(after, 'focus_changed') }
    : null;
}

function latestHistoryEventId(
  project: Project,
  type: NonNullable<Project['historyEvents']>[number]['type'],
  nodeId?: string,
): string | undefined {
  return [...(project.historyEvents ?? [])]
    .reverse()
    .find((event) => event.type === type && (!nodeId || event.primaryNodeId === nodeId))?.id;
}

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

  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Storage request failed.', code: 'UNAVAILABLE' },
    { status: 500 }
  );
}

async function readUserId(request: NextRequest): Promise<string> {
  const userId = request.nextUrl.searchParams.get('userId')?.trim();
  return requireAuthenticatedUserId(request, userId);
}

export async function GET(request: NextRequest) {
  try {
    const userId = await readUserId(request);
    const project = await loadProject(userId);
    return NextResponse.json({ project });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { userId?: string; action?: string; project?: unknown };
    const userId = await requireAuthenticatedUserId(request, body.userId?.trim());

    if (body.action === 'RESET') {
      const project = await resetDemoProject(userId);
      return NextResponse.json({ project });
    }

    if (!body.project || typeof body.project !== 'object') {
      throw new StorageError('Missing workspace payload.', 'VALIDATION_ERROR');
    }

    const requestedProject = body.project as Parameters<typeof saveProject>[1];
    const before = await getStorageProvider().getProject(userId, requestedProject.id);
    const project = await saveProject(userId, requestedProject);
    const trigger = snapshotTrigger(before, project);
    if (trigger) {
      try {
        await createProjectSnapshot({
          userId,
          projectId: project.id,
          trigger,
          label: trigger.type.replaceAll('_', ' '),
        });
      } catch (snapshotError) {
        console.warn('[Project snapshots] project mutation snapshot unavailable', snapshotError);
      }
    }
    return NextResponse.json({ project });
  } catch (error) {
    return jsonError(error);
  }
}
