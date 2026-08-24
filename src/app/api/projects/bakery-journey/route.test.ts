import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { loadBakeryJourneyDemoForUser } from '@/lib/demo/bootstrap';
import { POST } from './route';

vi.mock('@/lib/demo/bootstrap', () => ({
  loadBakeryJourneyDemoForUser: vi.fn(),
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/bakery-journey', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/bakery-journey', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts the replay for the authenticated user', async () => {
    const project = createProjectFromInput({ name: 'Launch a weekend bakery pop-up', goal: 'Validate the bakery.' });
    vi.mocked(loadBakeryJourneyDemoForUser).mockResolvedValue({
      project,
      projects: [project],
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
      memories: [],
      created: true,
    });

    const response = await POST(request({ userId: 'firebase-user' }));

    expect(response.status).toBe(200);
    expect(loadBakeryJourneyDemoForUser).toHaveBeenCalledWith('firebase-user');
    await expect(response.json()).resolves.toMatchObject({ created: true, activeProjectId: project.id });
  });
});
