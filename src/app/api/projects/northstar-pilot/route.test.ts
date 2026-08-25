import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { loadNorthstarPilotDemoForUser } from '@/lib/demo/bootstrap';
import { POST } from './route';

vi.mock('@/lib/demo/bootstrap', () => ({
  loadNorthstarPilotDemoForUser: vi.fn(),
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/northstar-pilot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/northstar-pilot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts the Northstar pilot replay for the authenticated user', async () => {
    const project = createProjectFromInput({
      name: 'Launch the Northstar Logistics pilot',
      goal: 'Start the pilot on time.',
    });
    vi.mocked(loadNorthstarPilotDemoForUser).mockResolvedValue({
      project,
      projects: [project],
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
      memories: [],
      created: true,
    });

    const response = await POST(request({ userId: 'firebase-user' }));

    expect(response.status).toBe(200);
    expect(loadNorthstarPilotDemoForUser).toHaveBeenCalledWith('firebase-user');
    await expect(response.json()).resolves.toMatchObject({ created: true, activeProjectId: project.id });
  });
});
