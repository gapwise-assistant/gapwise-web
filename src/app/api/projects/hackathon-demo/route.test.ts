import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHackathonDemoProject } from '@/lib/demo/hackathon';
import { loadHackathonDemoForUser } from '@/lib/demo/bootstrap';
import { POST } from './route';

vi.mock('@/lib/demo/bootstrap', () => ({
  loadHackathonDemoForUser: vi.fn(),
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/hackathon-demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/hackathon-demo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the non-meta HarborHelp hackathon project', async () => {
    const project = createHackathonDemoProject();
    vi.mocked(loadHackathonDemoForUser).mockResolvedValue({
      project,
      projects: [project],
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
      memories: [],
      created: true,
    });

    const response = await POST(request({ userId: 'firebase-user' }));

    expect(response.status).toBe(200);
    expect(loadHackathonDemoForUser).toHaveBeenCalledWith('firebase-user');
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      activeProjectId: project.id,
      project: { title: 'HarborHelp — Community Food Rescue' },
    });
  });
});
