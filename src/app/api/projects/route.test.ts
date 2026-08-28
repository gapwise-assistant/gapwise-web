import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { listProjects, loadProjectState, saveProject, setActiveProjectId, setAppScope } from '@/lib/storage';
import { GET, PATCH, POST } from './route';

vi.mock('@/lib/storage', () => ({
  listProjects: vi.fn(),
  loadProjectState: vi.fn(),
  saveProject: vi.fn(),
  setActiveProjectId: vi.fn(),
  setAppScope: vi.fn(),
  getStorageProvider: vi.fn(() => ({
    getUserMemoryProfile: vi.fn(async () => null),
  })),
}));

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists projects for the requested user', async () => {
    const project = createGoldenDemoProject();
    vi.mocked(loadProjectState).mockResolvedValue({ projects: [project], activeProjectId: project.id, scope: { type: 'project', projectId: project.id } });

    const response = await GET(new NextRequest('http://localhost/api/projects?userId=demo-user'));

    expect(response.status).toBe(200);
    expect(loadProjectState).toHaveBeenCalledWith('demo-user');
    await expect(response.json()).resolves.toMatchObject({
      projects: [expect.objectContaining({ id: project.id })],
      activeProjectId: project.id,
    });
  });

  it('returns an empty workspace state for a new authenticated user', async () => {
    vi.mocked(loadProjectState).mockResolvedValue({
      projects: [],
      activeProjectId: null,
      scope: null,
    });

    const response = await GET(new NextRequest('http://localhost/api/projects?userId=new-user'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projects: [],
      activeProjectId: null,
      scope: null,
    });
  });

  it('creates a project and persists it through storage', async () => {
    vi.mocked(saveProject).mockImplementation(async (_userId, project) => project);
    vi.mocked(setAppScope).mockResolvedValue(undefined);
    vi.mocked(listProjects).mockImplementation(async () => [createGoldenDemoProject()]);

    const response = await POST(
      jsonRequest({
        userId: 'demo-user',
        name: 'Find a new job',
        goal: 'Find a higher-paying backend/AI role by November.',
        deadline: '2026-11-01',
      })
    );

    expect(response.status).toBe(201);
    expect(saveProject).toHaveBeenCalledWith(
      'demo-user',
      expect.objectContaining({
        title: 'Find a new job',
        goal: 'Find a higher-paying backend/AI role by November.',
      })
    );
    expect(setAppScope).toHaveBeenCalledWith('demo-user', {
      type: 'project',
      projectId: expect.stringMatching(/^project_find-a-new-job_/),
    });
    const body = await response.json();
    expect(body.activeProjectId).toBe(body.project.id);
    expect(body.project.nodes).toEqual([
      expect.objectContaining({
        type: 'GOAL',
        text: 'Find a higher-paying backend/AI role by November.',
      }),
    ]);
  });

  it('persists the optional initial context and leaves an empty deadline unset', async () => {
    const previousDemoMode = process.env.GAPSWISE_DEMO_MODE;
    process.env.GAPSWISE_DEMO_MODE = 'true';
    try {
      vi.mocked(saveProject).mockImplementation(async (_userId, project) => project);
      vi.mocked(setAppScope).mockResolvedValue(undefined);
      vi.mocked(listProjects).mockImplementation(async () => [createGoldenDemoProject()]);

      const response = await POST(
        jsonRequest({
          userId: 'demo-user',
          name: 'Reunite demo',
          goal: 'Present a reliable working demo.',
          description: 'The upload path is failing and the demo needs a fallback.',
          deadline: '',
        })
      );

      expect(response.status).toBe(201);
      const savedProject = vi.mocked(saveProject).mock.calls.at(-1)?.[1];
      expect(savedProject?.deadline).toBeUndefined();
      expect(savedProject?.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          filename: 'Initial context',
          content: 'The upload path is failing and the demo needs a fallback.',
          origin: 'user',
        }),
      ]));
    } finally {
      if (previousDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
      else process.env.GAPSWISE_DEMO_MODE = previousDemoMode;
    }
  });

  it('rejects missing required project fields', async () => {
    const response = await POST(jsonRequest({ userId: 'demo-user', name: '' }));

    expect(response.status).toBe(400);
    expect(saveProject).not.toHaveBeenCalled();
  });

  it('updates the active project for the requested user', async () => {
    const first = createGoldenDemoProject();
    const second = { ...createGoldenDemoProject(), id: 'project_two', title: 'Job Search' };
    vi.mocked(listProjects).mockResolvedValue([first, second]);
    vi.mocked(setActiveProjectId).mockResolvedValue(undefined);
    vi.mocked(setAppScope).mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest('http://localhost/api/projects', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'demo-user', activeProjectId: 'project_two' }),
      })
    );

    expect(response.status).toBe(200);
    expect(setActiveProjectId).toHaveBeenCalledWith('demo-user', 'project_two');
    expect(setAppScope).toHaveBeenCalledWith('demo-user', { type: 'project', projectId: 'project_two' });
    await expect(response.json()).resolves.toMatchObject({
      activeProjectId: 'project_two',
      project: expect.objectContaining({ title: 'Job Search' }),
    });
  });

  it('normalizes a legacy Everything request to the first active workspace', async () => {
    const project = createGoldenDemoProject();
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(setAppScope).mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest('http://localhost/api/projects', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'demo-user', scope: { type: 'everything' } }),
      })
    );

    expect(response.status).toBe(200);
    expect(setAppScope).toHaveBeenCalledWith('demo-user', { type: 'project', projectId: project.id });
    await expect(response.json()).resolves.toMatchObject({
      scope: { type: 'project', projectId: project.id },
      activeProjectId: project.id,
    });
  });
});
