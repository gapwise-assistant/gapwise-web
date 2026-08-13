import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { listProjects, loadProjectState, saveProject, setActiveProjectId, setAppScope } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const createProjectSchema = z.object({
  userId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  description: z.string().trim().optional(),
  deadline: z.string().trim().optional(),
});

const updateActiveProjectSchema = z.object({
  userId: z.string().trim().min(1),
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
    return NextResponse.json({ error: 'Invalid project request.', issues: error.issues }, { status: 400 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Project request failed.', code: 'UNAVAILABLE' },
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
    const state = await loadProjectState(userId);
    return NextResponse.json(state);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createProjectSchema.parse(await request.json());
    const project = createProjectFromInput(body);
    await saveProject(body.userId, project);
    const scope = { type: 'project' as const, projectId: project.id };
    await setAppScope(body.userId, scope);
    const projects = await listProjects(body.userId);
    return NextResponse.json({ project, projects, activeProjectId: project.id, scope }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = updateActiveProjectSchema.parse(await request.json());
    const projects = await listProjects(body.userId);
    const requestedScope = body.scope ?? { type: 'project' as const, projectId: body.activeProjectId! };
    if (requestedScope.type === 'everything') {
      await setAppScope(body.userId, requestedScope);
      return NextResponse.json({ scope: requestedScope, projects });
    }
    const scopedProject = projects.find((project) => project.id === requestedScope.projectId);
    if (!scopedProject) throw new StorageError('Project does not exist for this user.', 'VALIDATION_ERROR');
    await setAppScope(body.userId, requestedScope);
    await setActiveProjectId(body.userId, requestedScope.projectId);
    return NextResponse.json({ scope: requestedScope, activeProjectId: requestedScope.projectId, project: scopedProject, projects });
  } catch (error) {
    return jsonError(error);
  }
}
