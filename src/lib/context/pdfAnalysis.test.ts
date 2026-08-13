import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { analyzePdfFromGcs, processPdfSource } from '@/lib/context/pdfAnalysis';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { DEFAULT_USER_PROFILE } from '@/lib/store';
import { Project } from '@/types/clarity';

function projectWithPdfSource(): Project {
  const project = createGoldenDemoProject();
  project.sources.push({
    id: 'src_pdf',
    filename: 'strategy.pdf',
    type: 'pdf',
    content: '',
    extracted_at: '2026-08-11T20:00:00Z',
    derived_node_ids: [],
    processing_status: 'pending',
    storage_url: 'gs://gapwise-505217-context/users/demo-user/sources/src_pdf/strategy.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1234,
    hash: 'hash_pdf_1',
    origin: 'user',
  });
  return project;
}

function mockGenAI(payload: unknown) {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify(payload),
        modelVersion: 'gemini-test-version',
      }),
    },
  } as any;
}

function markPdfSourceExtracted(project: Project): Project {
  const sourceIndex = project.sources.findIndex((source) => source.id === 'src_pdf');
  project.sources[sourceIndex] = {
    ...project.sources[sourceIndex],
    processing_status: 'completed',
    extraction_summary: 'Already extracted.',
    model_used: 'gemini-test-version',
    extraction_hash: 'hash_pdf_1',
  };
  return project;
}

describe('PDF Context Source analysis', () => {
  const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;
  afterEach(() => {
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  });

  it('blocks Gemini before an injected client can run in demo mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'true';
    const genAI = mockGenAI({ summary: 'Must not run', nodes: [] });
    await expect(analyzePdfFromGcs({
      sourceId: 'src_pdf', storageUrl: 'gs://bucket/file.pdf', genAI, model: 'gemini-test',
    })).rejects.toThrow(/disabled/);
    expect(genAI.models.generateContent).not.toHaveBeenCalled();
  });
  it('adds successful structured extraction to the source and project graph', async () => {
    const genAI = mockGenAI({
      summary: 'The PDF says the user wants to learn Google ADK this week.',
      nodes: [
        {
          type: 'GOAL',
          text: 'Learn Google ADK this week',
          confidence: 0.91,
        },
        {
          type: 'NEXT_ACTION',
          text: 'Schedule a Google ADK study block',
          confidence: 0.73,
        },
      ],
    });

    const result = await processPdfSource(projectWithPdfSource(), 'src_pdf', {
      genAI,
      model: 'gemini-test',
    });

    const source = result.project.sources.find((item) => item.id === 'src_pdf');
    expect(result.skipped).toBe(false);
    expect(source).toMatchObject({
      processing_status: 'completed',
      extraction_summary: 'The PDF says the user wants to learn Google ADK this week.',
      model_used: 'gemini-test-version',
      extraction_hash: 'hash_pdf_1',
    });
    expect(source?.processed_at).toBeTruthy();
    expect(source?.derived_node_ids).toHaveLength(2);
    expect(result.project.nodes.filter((node) => source?.derived_node_ids.includes(node.id))).toHaveLength(2);
  });

  it('makes a successful PDF extraction retrievable through Context Pack', async () => {
    const genAI = mockGenAI({
      summary: 'Gapswise PDF upload test confirms server-side PDF analysis is working.',
      nodes: [
        {
          type: 'KNOWN',
          text: 'Gapswise PDF upload test is present in the uploaded PDF',
          confidence: 0.95,
        },
      ],
    });

    const result = await processPdfSource(projectWithPdfSource(), 'src_pdf', {
      genAI,
      model: 'gemini-test',
    });
    const source = result.project.sources.find((item) => item.id === 'src_pdf');
    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'PDF upload test',
      project: result.project,
      profile: DEFAULT_USER_PROFILE,
    });

    expect(source).toMatchObject({
      processing_status: 'completed',
      storage_url: 'gs://gapwise-505217-context/users/demo-user/sources/src_pdf/strategy.pdf',
      mime_type: 'application/pdf',
      extraction_summary: 'Gapswise PDF upload test confirms server-side PDF analysis is working.',
      extraction_hash: 'hash_pdf_1',
    });
    expect(source?.derived_node_ids).toHaveLength(1);
    expect(pack.relevantEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: 'src_pdf',
          filename: 'strategy.pdf',
          excerpt: expect.stringContaining('PDF upload test'),
          derived_node_ids: source?.derived_node_ids,
        }),
      ])
    );
  });

  it('preserves provenance from every derived node back to the PDF source', async () => {
    const genAI = mockGenAI({
      summary: 'A concise summary.',
      nodes: [{ type: 'EVIDENCE', text: 'Evidence from the PDF.', confidence: 0.8 }],
    });

    const result = await processPdfSource(projectWithPdfSource(), 'src_pdf', {
      genAI,
      model: 'gemini-test',
    });
    const source = result.project.sources.find((item) => item.id === 'src_pdf');
    const node = result.project.nodes.find((item) => item.id === source?.derived_node_ids[0]);

    expect(node?.source_refs).toEqual(['src_pdf']);
  });

  it('asks Gemini for the existing Gapswise node type enum', async () => {
    const genAI = mockGenAI({
      summary: 'A concise summary.',
      nodes: [{ type: 'known', text: 'Lowercase valid types are normalized.', confidence: 0.8 }],
    });

    await analyzePdfFromGcs({
      sourceId: 'src_pdf',
      storageUrl: 'gs://gapwise-505217-context/users/demo-user/sources/src_pdf/strategy.pdf',
      mimeType: 'application/pdf',
      genAI,
      model: 'gemini-test',
    });

    expect(genAI.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          responseSchema: expect.objectContaining({
            properties: expect.objectContaining({
              nodes: expect.objectContaining({
                items: expect.objectContaining({
                  properties: expect.objectContaining({
                    type: expect.objectContaining({
                      enum: expect.arrayContaining(['KNOWN', 'GOAL', 'UNKNOWN', 'NEXT_ACTION']),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      })
    );
  });

  it('skips duplicate processing when hash and successful extraction already match', async () => {
    const project = markPdfSourceExtracted(projectWithPdfSource());
    const genAI = mockGenAI({ summary: 'Should not run.', nodes: [] });

    const result = await processPdfSource(project, 'src_pdf', {
      genAI,
      model: 'gemini-test',
    });

    expect(result.skipped).toBe(true);
    expect(genAI.models.generateContent).not.toHaveBeenCalled();
  });

  it('marks the source failed when the model call fails', async () => {
    const genAI = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error('Vertex unavailable')),
      },
    } as any;

    const result = await processPdfSource(projectWithPdfSource(), 'src_pdf', {
      genAI,
      model: 'gemini-test',
    });

    const source = result.project.sources.find((item) => item.id === 'src_pdf');
    expect(result.error).toContain('Vertex unavailable');
    expect(source?.processing_status).toBe('failed');
    expect(source?.error_message).toContain('Vertex unavailable');
  });

  it('force reprocesses even when a successful extraction exists', async () => {
    const project = markPdfSourceExtracted(projectWithPdfSource());
    const genAI = mockGenAI({
      summary: 'Reprocessed summary.',
      nodes: [{ type: 'KNOWN', text: 'Fresh extraction.', confidence: 0.77 }],
    });

    const result = await processPdfSource(project, 'src_pdf', {
      genAI,
      model: 'gemini-test',
      forceReprocess: true,
    });

    expect(result.skipped).toBe(false);
    expect(genAI.models.generateContent).toHaveBeenCalledTimes(1);
    expect(result.project.sources.find((item) => item.id === 'src_pdf')?.extraction_summary).toBe('Reprocessed summary.');
  });
});
