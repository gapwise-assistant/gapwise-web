import { createGoldenDemoProject } from '@/lib/demo/seed';
import { loadProjectForScope } from '@/lib/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/storage', () => ({
  loadProjectForScope: vi.fn(),
  getStorageProvider: vi.fn(() => ({
    getMemories: vi.fn(async () => []),
    replaceMemories: vi.fn(async () => {}),
  })),
}));

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/internal/context-pack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/internal/context-pack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadProjectForScope).mockResolvedValue({ project: createGoldenDemoProject(), scope: { type: 'everything' } });
  });

  it('returns a Context Pack built from the existing retrieval implementation', async () => {
    const response = await POST(
      jsonRequest({
        userId: 'demo-user',
        query: 'What am I neglecting?',
      })
    );

    expect(response.status).toBe(200);
    expect(loadProjectForScope).toHaveBeenCalledWith('demo-user', undefined);

    const body = await response.json();
    expect(body.contextPack).toMatchObject({
      query: 'What am I neglecting?',
    });
    expect(body.contextPack.activeGoals.length).toBeGreaterThan(0);
    expect(body.contextPack.unresolvedGaps.length).toBeGreaterThan(0);
    expect(Array.isArray(body.contextPack.relevantEvidence)).toBe(true);
    expect(Array.isArray(body.contextPack.userPreferences)).toBe(true);
    expect(Array.isArray(body.contextPack.upcomingCommitments)).toBe(true);
    expect(body.contextPack.recentDecisions.length).toBeGreaterThan(0);
    expect(body.contextPack.contradictions.length).toBeGreaterThan(0);
    expect(body.contextPack.includedContextIds).toEqual(
      expect.arrayContaining(['node_goal', 'unknown_target_user'])
    );
  });

  it('rejects invalid input', async () => {
    const response = await POST(jsonRequest({ userId: 'demo-user', query: '' }));

    expect(response.status).toBe(400);
    expect(loadProjectForScope).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.error).toBe('Invalid context pack request.');
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'query' })])
    );
  });

  it('passes project scope into retrieval', async () => {
    const project = createGoldenDemoProject();
    vi.mocked(loadProjectForScope).mockResolvedValue({
      project,
      scope: { type: 'project', projectId: project.id },
    });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      projectId: project.id,
      query: 'What should I focus on?',
    }));

    expect(response.status).toBe(200);
    expect(loadProjectForScope).toHaveBeenCalledWith('demo-user', project.id);
  });
});
