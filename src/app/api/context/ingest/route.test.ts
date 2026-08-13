import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { listProjects, saveProject } from '@/lib/storage';
import { uploadContextSourcePdf } from '@/lib/storage/gcsAssets';
import { POST } from './route';

vi.mock('@/lib/context/contextAnalysis', () => ({
  processContextSource: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  listProjects: vi.fn(),
  loadGeneralContext: vi.fn(),
  saveGeneralContext: vi.fn(),
  saveProject: vi.fn(),
}));
vi.mock('@/lib/storage/gcsAssets', () => ({
  uploadContextSourcePdf: vi.fn(),
}));

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/context/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/context/ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAPSWISE_DEMO_MODE = 'false';
  });

  it('loads the requested user project, persists AI graph updates, and returns new questions', async () => {
    const project = createProjectFromInput({ name: 'Japan trip', goal: 'Plan a 10 day Japan trip.' });
    const updated = {
      ...project,
      sources: [{
        id: 'src_note', filename: 'japan.txt', type: 'text' as const, content: 'I need a budget.',
        extracted_at: '2026-08-13T12:00:00.000Z', derived_node_ids: ['unknown_budget'], processing_status: 'completed' as const,
      }],
      nodes: [{
        id: 'unknown_budget', type: 'UNKNOWN' as const, text: 'What is the trip budget?', status: 'OPEN' as const,
        confidence: 0.7, impact: 0.9, source_refs: ['src_note'], created_by: 'agent' as const,
        created_at: '2026-08-13T12:00:00.000Z', updated_at: '2026-08-13T12:00:00.000Z',
      }],
      active_question: {
        node_id: 'unknown_budget', question: 'What is the trip budget?', uncertainty: 0.3, downstream_impact: 0.9,
        dependency_count: 0, urgency: 0.6, answerability: 0.8, user_relevance: 0.9, interruption_cost: 0.05,
        priority: 0.8, reasons: ['Blocks primary project goal execution'], blocked_decision_ids: [],
      },
    };
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(processContextSource).mockResolvedValue({ project: updated, skipped: false, modelUsed: 'gemini-test' });

    const response = await POST(jsonRequest({
      userId: 'demo-user', projectId: project.id, sourceId: 'src_note', filename: 'japan.txt',
      type: 'text', content: 'I need to know the trip budget.', profile: DEFAULT_USER_PROFILE,
    }));

    expect(response.status).toBe(200);
    expect(processContextSource).toHaveBeenCalledWith(
      project,
      expect.objectContaining({ sourceId: 'src_note', type: 'text', content: 'I need to know the trip budget.' }),
      expect.objectContaining({ challenge_level: DEFAULT_USER_PROFILE.challenge_level }),
      expect.objectContaining({ forceReprocess: false })
    );
    expect(saveProject).toHaveBeenCalledWith('demo-user', updated);
    await expect(response.json()).resolves.toMatchObject({
      project: expect.objectContaining({
        active_question: expect.objectContaining({ node_id: 'unknown_budget' }),
        nodes: [expect.objectContaining({ type: 'UNKNOWN', source_refs: ['src_note'] })],
      }),
      modelUsed: 'gemini-test',
    });
  });

  it('uploads a PDF before one context analysis call using its gs:// URI', async () => {
    const project = createProjectFromInput({ name: 'PDF project', goal: 'Understand the uploaded document.' });
    const updated = { ...project, sources: [], nodes: project.nodes };
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(uploadContextSourcePdf).mockResolvedValue({
      bucket: 'gapwise-505217-context',
      objectName: 'users/demo-user/sources/src_pdf/file.pdf',
      storageUrl: 'gs://gapwise-505217-context/users/demo-user/sources/src_pdf/file.pdf',
    });
    vi.mocked(processContextSource).mockResolvedValue({ project: updated, skipped: false, modelUsed: 'gemini-test' });

    const form = new FormData();
    form.set('userId', 'demo-user');
    form.set('projectId', project.id);
    form.set('sourceId', 'src_pdf');
    form.set('filename', 'file.pdf');
    form.set('type', 'pdf');
    form.set('content', 'Document description');
    form.set('profile', JSON.stringify(DEFAULT_USER_PROFILE));
    form.set('file', new File(['pdf bytes'], 'file.pdf', { type: 'application/pdf' }));

    const response = await POST(new Request('http://localhost/api/context/ingest', { method: 'POST', body: form }));

    expect(response.status).toBe(200);
    expect(uploadContextSourcePdf).toHaveBeenCalledWith(expect.objectContaining({ userId: 'demo-user', sourceId: 'src_pdf' }));
    expect(processContextSource).toHaveBeenCalledWith(
      project,
      expect.objectContaining({
        type: 'pdf',
        storageUrl: 'gs://gapwise-505217-context/users/demo-user/sources/src_pdf/file.pdf',
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('does not allow a user to ingest into another user project', async () => {
    const project = createProjectFromInput({ name: 'Private', goal: 'Private goal.' });
    vi.mocked(listProjects).mockImplementation(async (userId) => userId === 'demo-user' ? [project] : []);

    const response = await POST(jsonRequest({
      userId: 'other-user', projectId: project.id, sourceId: 'src_private', filename: 'private.txt',
      type: 'text', content: 'Should not cross the user boundary.',
    }));

    expect(response.status).toBe(403);
    expect(processContextSource).not.toHaveBeenCalled();
    expect(saveProject).not.toHaveBeenCalled();
  });
});
