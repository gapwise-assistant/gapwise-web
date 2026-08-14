import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoldenDemoForUser } from '@/lib/demo/bootstrap';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { POST } from './route';

vi.mock('@/lib/demo/bootstrap', () => ({
  loadGoldenDemoForUser: vi.fn(),
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/demo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the Golden Demo into the authenticated user scope', async () => {
    const project = createGoldenDemoProject();
    vi.mocked(loadGoldenDemoForUser).mockResolvedValue({
      project,
      projects: [project],
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
      created: true,
    });

    const response = await POST(request({ userId: 'firebase-user' }));

    expect(response.status).toBe(200);
    expect(loadGoldenDemoForUser).toHaveBeenCalledWith('firebase-user');
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
    });
  });

  it('returns an idempotent result when the user already loaded the demo', async () => {
    const project = createGoldenDemoProject();
    vi.mocked(loadGoldenDemoForUser).mockResolvedValue({
      project,
      projects: [project],
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
      created: false,
    });

    const response = await POST(request({ userId: 'firebase-user' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ created: false });
  });
});
