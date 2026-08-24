import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createBakeryDemoProject } from '@/lib/demo/bakery';
import { loadBakeryDemoForUser } from '@/lib/demo/bootstrap';
import { POST } from './route';

vi.mock('@/lib/demo/bootstrap', () => ({
  loadBakeryDemoForUser: vi.fn(),
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/bakery-demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/bakery-demo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the resettable weekend bakery pop-up project', async () => {
    const project = createBakeryDemoProject();
    vi.mocked(loadBakeryDemoForUser).mockResolvedValue({
      project,
      projects: [project],
      activeProjectId: project.id,
      scope: { type: 'project', projectId: project.id },
      memories: [],
      created: true,
    });

    const response = await POST(request({ userId: 'firebase-user' }));

    expect(response.status).toBe(200);
    expect(loadBakeryDemoForUser).toHaveBeenCalledWith('firebase-user');
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      activeProjectId: project.id,
      project: { title: 'Launch a weekend bakery pop-up' },
    });
  });
});
