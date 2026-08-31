import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { listProjects, saveProject } from '@/lib/storage';
import { uploadContextSourceAsset } from '@/lib/storage/gcsAssets';
import { POST } from './route';

vi.mock('@/lib/context/contextAnalysis', () => ({
  processContextSource: vi.fn(),
}));
vi.mock('@/lib/agents/gapRuntime', () => ({
  refreshProjectGapRuntime: vi.fn(),
}));
vi.mock('@/lib/history/projectSnapshots', () => ({
  createProjectSnapshot: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  getStorageProvider: vi.fn(() => ({
    getUserMemoryProfile: vi.fn().mockResolvedValue(null),
  })),
  listProjects: vi.fn(),
  loadGeneralContext: vi.fn(),
  saveGeneralContext: vi.fn(),
  saveProject: vi.fn(),
}));
vi.mock('@/lib/storage/gcsAssets', () => ({
  uploadContextSourceAsset: vi.fn(),
  parseGsUrl: (storageUrl: string) => {
    const withoutScheme = storageUrl.slice('gs://'.length);
    const slashIndex = withoutScheme.indexOf('/');
    return {
      bucket: withoutScheme.slice(0, slashIndex),
      objectName: withoutScheme.slice(slashIndex + 1),
    };
  },
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
    process.env.CLOUD_STORAGE_BUCKET = 'gapwise-505217-context';
    vi.mocked(refreshProjectGapRuntime).mockImplementation(async ({ project }: { project: ReturnType<typeof createProjectFromInput> }) => ({
      project,
      runtime: null,
    }));
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
    expect(processContextSource).toHaveBeenCalledWith(
      project,
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ captureProcessingLog: true })
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
    vi.mocked(uploadContextSourceAsset).mockResolvedValue({
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
    form.set('file', new File(['%PDF-1.7\n%%EOF'], 'file.pdf', { type: 'application/pdf' }));

    const response = await POST(new Request('http://localhost/api/context/ingest', { method: 'POST', body: form }));

    expect(response.status).toBe(200);
    expect(uploadContextSourceAsset).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user',
      sourceId: 'src_pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7\n%%EOF'),
    }));
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

  it('uploads image and voice attachments with their actual bytes and MIME types', async () => {
    const project = createProjectFromInput({ name: 'Media project', goal: 'Understand uploaded media.' });
    const updated = { ...project, sources: [], nodes: project.nodes };
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(uploadContextSourceAsset).mockImplementation(async ({ sourceId, filename, contentType }: { sourceId: string; filename: string; contentType: string }) => ({
      bucket: 'gapwise-505217-context',
      objectName: `users/demo-user/sources/${sourceId}/${filename}`,
      storageUrl: `gs://gapwise-505217-context/users/demo-user/sources/${sourceId}/${filename}`,
    }));
    vi.mocked(processContextSource).mockResolvedValue({ project: updated, skipped: false, modelUsed: 'gemini-test' });

    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const imageForm = new FormData();
    imageForm.set('userId', 'demo-user');
    imageForm.set('projectId', project.id);
    imageForm.set('sourceId', 'src_image');
    imageForm.set('filename', 'brief.png');
    imageForm.set('type', 'image');
    imageForm.set('profile', JSON.stringify(DEFAULT_USER_PROFILE));
    imageForm.set('file', new File([png], 'brief.png', { type: 'image/png' }));

    expect((await POST(new Request('http://localhost/api/context/ingest', { method: 'POST', body: imageForm }))).status).toBe(200);
    expect(uploadContextSourceAsset).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'src_image', contentType: 'image/png', bytes: png,
    }));
    expect(processContextSource).toHaveBeenCalledWith(
      project,
      expect.objectContaining({ type: 'image', mimeType: 'image/png', storageUrl: expect.stringContaining('/src_image/brief.png') }),
      expect.any(Object),
      expect.any(Object),
    );

    vi.clearAllMocks();
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(uploadContextSourceAsset).mockResolvedValue({
      bucket: 'gapwise-505217-context',
      objectName: 'users/demo-user/sources/src_voice/note.webm',
      storageUrl: 'gs://gapwise-505217-context/users/demo-user/sources/src_voice/note.webm',
    });
    vi.mocked(processContextSource).mockResolvedValue({ project: updated, skipped: false, modelUsed: 'gemini-test' });
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
    const voiceForm = new FormData();
    voiceForm.set('userId', 'demo-user');
    voiceForm.set('projectId', project.id);
    voiceForm.set('sourceId', 'src_voice');
    voiceForm.set('filename', 'note.webm');
    voiceForm.set('type', 'voice');
    voiceForm.set('profile', JSON.stringify(DEFAULT_USER_PROFILE));
    voiceForm.set('file', new File([webm], 'note.webm', { type: 'audio/webm' }));

    expect((await POST(new Request('http://localhost/api/context/ingest', { method: 'POST', body: voiceForm }))).status).toBe(200);
    expect(uploadContextSourceAsset).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'src_voice', contentType: 'audio/webm', bytes: webm,
    }));
    expect(processContextSource).toHaveBeenCalledWith(
      project,
      expect.objectContaining({ type: 'voice', mimeType: 'audio/webm', storageUrl: expect.stringContaining('/src_voice/note.webm') }),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('rejects corrupt media before upload or Context Agent processing', async () => {
    const project = createProjectFromInput({ name: 'Validation project', goal: 'Validate attachments.' });
    vi.mocked(listProjects).mockResolvedValue([project]);
    const form = new FormData();
    form.set('userId', 'demo-user');
    form.set('projectId', project.id);
    form.set('sourceId', 'src_bad_image');
    form.set('filename', 'brief.png');
    form.set('type', 'image');
    form.set('profile', JSON.stringify(DEFAULT_USER_PROFILE));
    form.set('file', new File(['not an image'], 'brief.png', { type: 'image/png' }));

    const response = await POST(new Request('http://localhost/api/context/ingest', { method: 'POST', body: form }));

    expect(response.status).toBe(400);
    expect(uploadContextSourceAsset).not.toHaveBeenCalled();
    expect(processContextSource).not.toHaveBeenCalled();
  });

  it('decodes an attached text file when no supporting text is supplied', async () => {
    const project = createProjectFromInput({ name: 'Text upload project', goal: 'Read a text attachment.' });
    const updated = { ...project, sources: [], nodes: project.nodes };
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(uploadContextSourceAsset).mockResolvedValue({
      bucket: 'gapwise-505217-context',
      objectName: 'users/demo-user/sources/src_markdown/notes.md',
      storageUrl: 'gs://gapwise-505217-context/users/demo-user/sources/src_markdown/notes.md',
    });
    vi.mocked(processContextSource).mockResolvedValue({ project: updated, skipped: false, modelUsed: 'gemini-test' });
    const form = new FormData();
    form.set('userId', 'demo-user');
    form.set('projectId', project.id);
    form.set('sourceId', 'src_markdown');
    form.set('filename', 'notes.md');
    form.set('type', 'text');
    form.set('profile', JSON.stringify(DEFAULT_USER_PROFILE));
    form.set('file', new File(['The actual markdown attachment.'], 'notes.md', { type: 'text/markdown' }));

    expect((await POST(new Request('http://localhost/api/context/ingest', { method: 'POST', body: form }))).status).toBe(200);
    expect(processContextSource).toHaveBeenCalledWith(
      project,
      expect.objectContaining({ type: 'text', content: 'The actual markdown attachment.' }),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('rejects an arbitrary non-connector storage URL', async () => {
    const project = createProjectFromInput({ name: 'Storage project', goal: 'Keep uploaded assets private.' });
    vi.mocked(listProjects).mockResolvedValue([project]);

    const response = await POST(jsonRequest({
      userId: 'demo-user', projectId: project.id, sourceId: 'src_external', filename: 'notes.txt',
      type: 'text', content: 'External asset reference.', storageUrl: 'https://attacker.example/file.txt',
    }));

    expect(response.status).toBe(400);
    expect(processContextSource).not.toHaveBeenCalled();
    expect(saveProject).not.toHaveBeenCalled();
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

  it('does not reuse an older history event when the source produces no new context event', async () => {
    const project = createProjectFromInput({ name: 'Calendar project', goal: 'Keep calendar context separate.' });
    project.historyEvents = [{
      id: 'older-event',
      projectId: project.id,
      createdAt: '2026-08-20T12:00:00.000Z',
      type: 'context_added',
      title: 'Older source added',
      summary: 'An older source changed the project.',
      sourceId: 'older-source',
    }];
    const updated = {
      ...project,
      sources: [{
        id: 'calendar-source',
        filename: 'calendar-event.txt',
        type: 'text' as const,
        content: 'A calendar event unrelated to this workspace.',
        extracted_at: '2026-08-28T12:00:00.000Z',
        derived_node_ids: [],
        processing_status: 'completed' as const,
      }],
      historyEvents: project.historyEvents,
    };
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(processContextSource).mockResolvedValue({ project: updated, skipped: false, modelUsed: 'gemini-test' });

    const response = await POST(jsonRequest({
      userId: 'demo-user', projectId: project.id, sourceId: 'calendar-source', filename: 'calendar-event.txt',
      type: 'text', content: 'A calendar event unrelated to this workspace.', origin: 'connector',
    }));

    expect(response.status).toBe(200);
    expect(createProjectSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      trigger: {
        type: 'context_processed',
        sourceId: 'calendar-source',
      },
    }));
    expect(createProjectSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      trigger: expect.objectContaining({ historyEventId: 'older-event' }),
    }));
  });

  it('reuses a failed attachment source and object when a retry arrives with a new client ID', async () => {
    const project = createProjectFromInput({ name: 'Retry project', goal: 'Retry failed context safely.' });
    let storedProject = project;
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const failedSource = {
      id: 'src_retry',
      filename: 'retry.png',
      type: 'image' as const,
      content: 'A retryable image.',
      extracted_at: '2026-08-30T12:00:00.000Z',
      derived_node_ids: [],
      processing_status: 'failed' as const,
      storage_url: 'gs://gapwise-505217-context/users/demo-user/sources/src_retry/retry.png',
      mime_type: 'image/png',
      size_bytes: png.length,
      hash: undefined,
      error_message: 'Temporary failure',
    };
    vi.mocked(listProjects).mockImplementation(async () => [storedProject]);
    vi.mocked(saveProject).mockImplementation(async (_userId, nextProject) => {
      storedProject = nextProject;
      return nextProject;
    });
    vi.mocked(uploadContextSourceAsset).mockResolvedValue({
      bucket: 'gapwise-505217-context',
      objectName: 'users/demo-user/sources/src_retry/retry.png',
      storageUrl: failedSource.storage_url,
    });
    vi.mocked(processContextSource).mockImplementation(async (currentProject, input) => {
      if (vi.mocked(processContextSource).mock.calls.length === 1) {
        return {
          project: { ...currentProject, sources: [{ ...failedSource, hash: input.attachmentHash }] },
          skipped: false,
          error: 'Temporary model failure',
        };
      }
      return {
        project: {
          ...currentProject,
          sources: [{
            ...failedSource,
            content: input.content,
            processing_status: 'completed' as const,
            hash: input.attachmentHash,
            extraction_hash: input.hash,
            error_message: undefined,
            processed_at: '2026-08-30T12:01:00.000Z',
          }],
        },
        skipped: false,
        modelUsed: 'gemini-test',
      };
    });

    const makeRequest = (sourceId: string, content: string) => {
      const form = new FormData();
      form.set('userId', 'demo-user');
      form.set('projectId', project.id);
      form.set('sourceId', sourceId);
      form.set('filename', 'retry.png');
      form.set('type', 'image');
      form.set('content', content);
      form.set('profile', JSON.stringify(DEFAULT_USER_PROFILE));
      form.set('file', new File([png], 'retry.png', { type: 'image/png' }));
      return new Request('http://localhost/api/context/ingest', { method: 'POST', body: form });
    };

    expect((await POST(makeRequest('src_retry', 'A retryable image.'))).status).toBe(503);
    const retryResponse = await POST(makeRequest('src_retry_after_reload', 'A retryable image.'));
    expect(retryResponse.status).toBe(200);
    expect(uploadContextSourceAsset).toHaveBeenCalledTimes(1);
    expect(processContextSource).toHaveBeenCalledTimes(2);
    expect(processContextSource).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: project.id }),
      expect.objectContaining({
        sourceId: 'src_retry',
        storageUrl: failedSource.storage_url,
      }),
      expect.any(Object),
      expect.any(Object),
    );
    expect(storedProject.sources).toHaveLength(1);
    expect(storedProject.sources[0]).toMatchObject({
      id: 'src_retry',
      processing_status: 'completed',
      storage_url: failedSource.storage_url,
    });
    expect(storedProject.sources[0].error_message).toBeUndefined();
  });

  it('serializes concurrent identical submissions so only one upload and analysis run occurs', async () => {
    const project = createProjectFromInput({ name: 'Concurrent project', goal: 'Avoid duplicate uploads.' });
    let storedProject = project;
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    vi.mocked(listProjects).mockImplementation(async () => [storedProject]);
    vi.mocked(saveProject).mockImplementation(async (_userId, nextProject) => {
      storedProject = nextProject;
      return nextProject;
    });
    vi.mocked(uploadContextSourceAsset).mockResolvedValue({
      bucket: 'gapwise-505217-context',
      objectName: 'users/demo-user/sources/src_concurrent/brief.png',
      storageUrl: 'gs://gapwise-505217-context/users/demo-user/sources/src_concurrent/brief.png',
    });
    vi.mocked(processContextSource).mockImplementation(async (currentProject, input) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        project: {
          ...currentProject,
          sources: [{
            id: input.sourceId!,
            filename: input.filename,
            type: input.type,
            content: input.content,
            extracted_at: '2026-08-30T12:00:00.000Z',
            derived_node_ids: [],
            processing_status: 'completed' as const,
            storage_url: input.storageUrl,
            mime_type: input.mimeType,
            size_bytes: input.sizeBytes,
            hash: input.attachmentHash,
            extraction_hash: input.hash,
          }],
        },
        skipped: false,
        modelUsed: 'gemini-test',
      };
    });
    const makeRequest = () => {
      const form = new FormData();
      form.set('userId', 'demo-user');
      form.set('projectId', project.id);
      form.set('sourceId', 'src_concurrent');
      form.set('filename', 'brief.png');
      form.set('type', 'image');
      form.set('content', 'Same submission.');
      form.set('profile', JSON.stringify(DEFAULT_USER_PROFILE));
      form.set('file', new File([png], 'brief.png', { type: 'image/png' }));
      return new Request('http://localhost/api/context/ingest', { method: 'POST', body: form });
    };

    const [first, second] = await Promise.all([POST(makeRequest()), POST(makeRequest())]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(uploadContextSourceAsset).toHaveBeenCalledTimes(1);
    expect(processContextSource).toHaveBeenCalledTimes(1);
    expect(storedProject.sources).toHaveLength(1);
  });
});
