import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { recordTrace } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { GET, POST } from './route';

const storage = {
  listDeveloperGenerationRuns: vi.fn(async () => [{ id: 'generation-1', projectId: 'project-1', userId: 'trace-user', generator: 'Test', status: 'completed', startedAt: '2026-08-27T10:00:00.000Z' }]),
  getDeveloperGenerationSteps: vi.fn(async () => []),
};

vi.mock('@/lib/observability/trace', () => ({
  latestDecisionMapActivity: vi.fn(),
  listTraces: vi.fn(),
  recordTrace: vi.fn(),
  updateLatestDecisionMapRenderer: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getStorageProvider: () => storage,
}));

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dev/traces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dev/traces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue('trace-user');
  });

  it('records a structured client-rendered Decision Map debug trace for the authenticated user', async () => {
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
        whyThisMattersDebug: [],
        filterVisibilityTrace: [],
        layoutDiagnostics: {},
        renderedMapReadabilitySummary: { visibleNodes: 1, currentFocusActionNodeId: null },
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

  it('rejects trace writes outside localhost', async () => {
    const response = await POST(new NextRequest('https://preview.gapwise.example/api/dev/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(404);
    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
    expect(recordTrace).not.toHaveBeenCalled();
  });

  it('rejects trace reads outside localhost', async () => {
    const response = await GET(new NextRequest('https://preview.gapwise.example/api/dev/traces?userId=trace-user'));

    expect(response.status).toBe(404);
    expect(requireAuthenticatedUserId).not.toHaveBeenCalled();
  });

  it('loads persisted generation timelines for the requested project', async () => {
    const response = await GET(new NextRequest('http://localhost/api/dev/traces?userId=trace-user&projectId=project-1'));

    expect(response.status).toBe(200);
    expect(storage.listDeveloperGenerationRuns).toHaveBeenCalledWith('trace-user', 'project-1');
    expect(storage.getDeveloperGenerationSteps).toHaveBeenCalledWith('trace-user', 'generation-1');
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      generationRuns: [{ run: expect.objectContaining({ id: 'generation-1' }), steps: [] }],
    }));
  });
});
