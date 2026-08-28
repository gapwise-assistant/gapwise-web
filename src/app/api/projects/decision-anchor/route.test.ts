import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { anchorProjectDecision } from '@/lib/decisions/anchoring';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { listProjects, saveProject } from '@/lib/storage';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { POST } from './route';

vi.mock('@/lib/storage', () => ({
  listProjects: vi.fn(),
  saveProject: vi.fn(),
  getStorageProvider: vi.fn(() => ({
    getUserMemoryProfile: vi.fn(async () => null),
  })),
}));
vi.mock('@/lib/agents/gapRuntime', () => ({
  refreshProjectGapRuntime: vi.fn(),
}));

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/projects/decision-anchor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/projects/decision-anchor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAPSWISE_DEMO_MODE = 'false';
  });

  it('anchors selected questions and refreshes the Gap Agent runtime', async () => {
    const base = createProjectFromInput({ name: 'ClinicFlow', goal: 'Improve intake.' });
    const withQuestion = {
      ...base,
      nodes: [...base.nodes, {
        id: 'unknown_safety',
        type: 'UNKNOWN' as const,
        text: 'Is the intake routing safe enough?',
        status: 'OPEN' as const,
        confidence: 0.4,
        impact: 0.9,
        source_refs: [],
        created_by: 'user' as const,
        created_at: base.created_at,
        updated_at: base.updated_at,
      }],
    };
    const anchored = anchorProjectDecision(withQuestion, 'Should ClinicFlow launch the pilot?', ['unknown_safety'], DEFAULT_USER_PROFILE);
    vi.mocked(listProjects).mockResolvedValue([withQuestion]);
    vi.mocked(refreshProjectGapRuntime).mockResolvedValue({ project: anchored, runtime: null });

    const response = await POST(jsonRequest({
      userId: 'demo-user',
      projectId: withQuestion.id,
      title: 'Should ClinicFlow launch the pilot?',
      questionNodeIds: ['unknown_safety'],
    }));

    expect(response.status).toBe(200);
    expect(refreshProjectGapRuntime).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user',
      project: expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ type: 'DECISION', status: 'OPEN' })]),
      }),
    }));
    expect(saveProject).toHaveBeenCalledWith('demo-user', anchored);
    await expect(response.json()).resolves.toMatchObject({
      project: expect.objectContaining({ active_question: expect.objectContaining({ node_id: 'unknown_safety' }) }),
      runtime: null,
    });
  });
});
