import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { recordTrace } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { POST } from './route';

vi.mock('@/lib/observability/trace', () => ({
  listTraces: vi.fn(),
  recordTrace: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedUserId: vi.fn(),
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dev/traces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dev/traces', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a structured client-rendered Decision Map debug trace for the authenticated user', async () => {
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('trace-user');
    vi.mocked(recordTrace).mockReturnValue({ id: 'trace_decision_map' } as ReturnType<typeof recordTrace>);

    const response = await POST(request({
      userId: 'trace-user',
      decisionMapDebug: {
        schemaVersion: 1,
        projectId: 'project_1',
        capturedAt: '2026-08-23T10:00:00.000Z',
        render: { filter: 'all', selectedNodeId: null, focusMode: false, pathMode: false, rendererReported: true },
        rawProjectGraph: { totalNodes: 1, totalEdges: 0, nodes: [{ id: 'goal' }], edges: [] },
        semanticGraphInterpretation: {},
        currentFocusAnalysis: {},
        storyBackboneCandidates: {},
        collapseExpansionAnalysis: {},
        whyThisMattersDebug: [],
        filterVisibilityTrace: [],
        layoutDiagnostics: {},
        renderedStoryReadabilitySummary: { visibleNodes: 1, currentFocusActionNodeId: null },
      },
    }));

    expect(response.status).toBe(200);
    expect(requireAuthenticatedUserId).toHaveBeenCalled();
    expect(recordTrace).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'trace-user',
      route: '/ui/decision-map',
      label: 'Decision Map debug trace',
      contextIds: ['goal'],
    }));
    await expect(response.json()).resolves.toEqual({ id: 'trace_decision_map' });
  });
});
