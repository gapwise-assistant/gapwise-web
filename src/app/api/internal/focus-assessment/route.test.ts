import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getStorageProvider, loadProjectForScope } from '@/lib/storage';
import { focusAssessmentCacheId, focusProjectStateVersion, getCachedFocusAssessment } from '@/lib/focus/focusCache';
import { createBakeryDemoProject } from '@/lib/demo/bakery';

vi.mock('@/lib/auth/server', () => ({ requireAuthenticatedUserId: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn(), loadProjectForScope: vi.fn() }));
vi.mock('@/lib/focus/focusCache', () => ({
  focusAssessmentCacheId: vi.fn(),
  focusProjectStateVersion: vi.fn(),
  getCachedFocusAssessment: vi.fn(),
}));

describe('GET /api/internal/focus-assessment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads an existing focus assessment without generating a new one', async () => {
    const project = createBakeryDemoProject();
    const assessment = {
      kind: 'decision',
      title: 'Choose the bakery location',
      actionNodeId: 'bakery_location_decision',
      sourceNodeIds: ['bakery_location_decision'],
      sourceIds: ['bakery_launch_planning_notes'],
      score: 0.91,
      confidence: 0.8,
    } as const;
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('focus-user');
    vi.mocked(loadProjectForScope).mockResolvedValue({ project, scope: { type: 'project', projectId: project.id } });
    vi.mocked(focusProjectStateVersion).mockResolvedValue('project-state-version');
    vi.mocked(focusAssessmentCacheId).mockReturnValue('focus-cache-id');
    const getFocusAssessment = vi.fn().mockResolvedValue({ assessment });
    vi.mocked(getStorageProvider).mockReturnValue({ getFocusAssessment } as unknown as ReturnType<typeof getStorageProvider>);

    const response = await GET(new NextRequest(`http://localhost/api/internal/focus-assessment?userId=focus-user&projectId=${project.id}`));

    expect(response.status).toBe(200);
    expect(getFocusAssessment).toHaveBeenCalledWith('focus-user', 'focus-cache-id');
    expect(getCachedFocusAssessment).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ focusAssessment: assessment, cached: true });
  });
});
