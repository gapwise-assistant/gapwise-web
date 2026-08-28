import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { listProjects, loadProjectState, saveProject, setActiveProjectId, setAppScope } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { isLocalhostRequest } from '@/lib/runtime/demoMode';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { resolveScope } from '@/lib/scope/projectScope';
import { loadUserMemoryProfile } from '@/lib/memory/serverStore';
import { refreshAskSuggestionsForProject } from '@/lib/ask/suggestionsRefresh';

export const runtime = 'nodejs';

const createProjectSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  description: z.string().trim().optional(),
  deadline: z.string().trim().optional(),
});

const updateActiveProjectSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  activeProjectId: z.string().trim().min(1).optional(),
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('everything') }),
    z.object({ type: z.literal('project'), projectId: z.string().trim().min(1) }),
  ]).optional(),
}).refine((body) => body.scope || body.activeProjectId, {
  message: 'scope or activeProjectId is required',
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
    return NextResponse.json({ error: 'Invalid workspace request.', issues: error.issues }, { status: 400 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Workspace request failed.', code: 'UNAVAILABLE' },
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
    const state = await loadProjectState(userId);
    return NextResponse.json(state);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createProjectSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    let project = createProjectFromInput(body);
    if (body.description) {
      // Persist the goal-only state first so the creation snapshot is a true
      // starting point, then process the optional initial context as its own
      // immutable transition.
      await saveProject(userId, project);
      try {
        await createProjectSnapshot({
          userId,
          projectId: project.id,
          trigger: { type: 'project_created' },
          label: 'Project created',
          summary: 'The project and its initial goal were created.',
        });
      } catch (error) {
        console.warn('[Project snapshots] creation snapshot unavailable', error);
      }
      const processed = await processContextSource(project, {
        sourceId: `${project.id}_initial_context`,
        filename: 'Initial context',
        content: body.description,
        type: 'note',
        origin: 'user',
      }, profile, {
        captureProcessingLog: isLocalhostRequest(request),
      });
      project = processed.project;
    }
    await saveProject(userId, project);
    await refreshAskSuggestionsForProject({ userId, project });
    if (!body.description) {
      try {
        await createProjectSnapshot({
          userId,
          projectId: project.id,
          trigger: { type: 'project_created' },
          label: 'Project created',
          summary: 'The project and its initial goal were created.',
        });
      } catch (error) {
        console.warn('[Project snapshots] creation snapshot unavailable', error);
      }
    }
    if (body.description && project.sources.some((source) => source.id === `${project.id}_initial_context`)) {
      try {
        await createProjectSnapshot({
          userId,
          projectId: project.id,
          trigger: {
            type: 'context_processed',
            sourceId: `${project.id}_initial_context`,
            historyEventId: project.historyEvents?.at(-1)?.id,
          },
          label: 'Initial context processed',
            summary: 'The initial context was processed into the workspace understanding.',
        });
      } catch (error) {
        console.warn('[Project snapshots] context snapshot unavailable', error);
      }
    }
    const scope = { type: 'project' as const, projectId: project.id };
    await setAppScope(userId, scope);
    const projects = await listProjects(userId);
    return NextResponse.json({ project, projects, activeProjectId: project.id, scope }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = updateActiveProjectSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const projects = await listProjects(userId);
    const requestedProjectId = body.activeProjectId
      ?? (body.scope?.type === 'project' ? body.scope.projectId : undefined);
    const scopedProject = requestedProjectId
      ? projects.find((project) => project.id === requestedProjectId && project.status !== 'archived')
      : undefined;
    const normalizedScope = scopedProject
      ? { type: 'project' as const, projectId: scopedProject.id }
      : resolveScope(body.scope, projects);

    if (!normalizedScope) {
      throw new StorageError('No active workspace is available.', 'VALIDATION_ERROR');
    }

    const selectedProject = projects.find((project) => project.id === normalizedScope.projectId);
    if (!selectedProject || selectedProject.status === 'archived') {
      throw new StorageError('Workspace does not exist for this user.', 'VALIDATION_ERROR');
    }

    // Legacy `{ type: 'everything' }` requests are normalized to a concrete
    // project instead of being persisted as a new aggregate scope.
    await setAppScope(userId, normalizedScope);
    await setActiveProjectId(userId, normalizedScope.projectId);
    return NextResponse.json({ scope: normalizedScope, activeProjectId: normalizedScope.projectId, project: selectedProject, projects });
  } catch (error) {
    return jsonError(error);
  }
}
