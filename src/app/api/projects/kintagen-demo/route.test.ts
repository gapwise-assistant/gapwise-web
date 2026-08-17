import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createKintaGenDemoProject } from '@/lib/demo/kintagen';
import { loadKintaGenDemoForUser } from '@/lib/demo/bootstrap';
import { POST } from './route';

vi.mock('@/lib/demo/bootstrap', () => ({ loadKintaGenDemoForUser: vi.fn() }));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/kintagen-demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/projects/kintagen-demo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the KintaGen scientific AI assistant project', async () => {
    const project = createKintaGenDemoProject();
    vi.mocked(loadKintaGenDemoForUser).mockResolvedValue({ project, projects: [project], activeProjectId: project.id, scope: { type: 'project', projectId: project.id }, memories: [], created: true });
    const response = await POST(request({ userId: 'firebase-user' }));
    expect(response.status).toBe(200);
    expect(loadKintaGenDemoForUser).toHaveBeenCalledWith('firebase-user');
    await expect(response.json()).resolves.toMatchObject({ created: true, activeProjectId: project.id, project: { title: 'KintaGen — Scientific AI Assistant' } });
  });
});
