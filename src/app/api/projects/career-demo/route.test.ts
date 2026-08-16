import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCareerConflictDemoProject } from '@/lib/demo/careerConflict';
import { loadCareerConflictDemoForUser } from '@/lib/demo/bootstrap';
import { POST } from './route';

vi.mock('@/lib/demo/bootstrap', () => ({
  loadCareerConflictDemoForUser: vi.fn(),
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/career-demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/career-demo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the repeatable career conflict demo into the authenticated user scope', async () => {
    const project = createCareerConflictDemoProject();
    vi.mocked(loadCareerConflictDemoForUser).mockResolvedValue({
      project,
      projects: [project],
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
      memories: [],
      created: true,
    });

    const response = await POST(request({ userId: 'firebase-user' }));

    expect(response.status).toBe(200);
    expect(loadCareerConflictDemoForUser).toHaveBeenCalledWith('firebase-user');
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
    });
  });
});
