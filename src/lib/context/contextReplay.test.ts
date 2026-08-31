import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { validateContextAttachment } from '@/lib/context/contextAttachments';
import { projectToCollections, collectionsToProject } from '@/lib/storage/projectMapper';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { Project } from '@/types/clarity';

const png1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

function deterministicContextAgent() {
  return {
    models: {
      generateContent: vi.fn().mockImplementation(async (request: { contents?: Array<{ parts?: Array<{ text?: string }> }> }) => {
        const prompt = request.contents?.[0]?.parts?.find((part) => part.text)?.text ?? '';
        if (prompt.includes('Classify only the supplied directed pairs.')) {
          return { text: JSON.stringify({ classifications: [] }), modelVersion: 'fixture-context-agent' };
        }
        const filename = prompt.match(/New source filename: ([^\n]+)/)?.[1] ?? 'source';
        return {
          text: JSON.stringify({
            summary: `Captured ${filename}.`,
            relevance: 'relevant',
            operations: [{
              op: 'ADD_CONTEXT',
              nodeType: 'KNOWN',
              text: `Captured information from ${filename}.`,
              confidence: 0.95,
              impact: 0.65,
            }],
            relationships: [],
          }),
          modelVersion: 'fixture-context-agent',
        };
      }),
    },
  } as any;
}

describe('deterministic multimodal Context replay', () => {
  const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

  afterEach(() => {
    if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
    else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  });

  it('replays text, note, PDF, image, and voice through analysis and save/reload boundaries', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    let project: Project = createProjectFromInput({
      name: 'Cross-modal replay',
      goal: 'Understand every supplied project source.',
    }, '2026-08-31T12:00:00.000Z');
    const genAI = deterministicContextAgent();
    const sources = [
      { sourceId: 'src_text', filename: 'brief.txt', type: 'text' as const, content: 'The launch target is October 10.' },
      { sourceId: 'src_note', filename: 'note.md', type: 'note' as const, content: 'The owner prefers a short weekly review.' },
      { sourceId: 'src_pdf', filename: 'brief.pdf', type: 'pdf' as const, content: '', mimeType: 'application/pdf', storageUrl: 'gs://fixture/users/test-user/sources/src_pdf/brief.pdf', sizeBytes: 15 },
      { sourceId: 'src_image', filename: 'whiteboard.png', type: 'image' as const, content: '', mimeType: 'image/png', storageUrl: 'gs://fixture/users/test-user/sources/src_image/whiteboard.png', sizeBytes: png1x1.length },
      { sourceId: 'src_voice', filename: 'memo.webm', type: 'voice' as const, content: 'Optional transcript context.', mimeType: 'audio/webm', storageUrl: 'gs://fixture/users/test-user/sources/src_voice/memo.webm', sizeBytes: 4 },
    ];

    validateContextAttachment({ type: 'pdf', filename: 'brief.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.7\n%%EOF') });
    validateContextAttachment({ type: 'image', filename: 'whiteboard.png', mimeType: 'image/png', bytes: png1x1 });
    validateContextAttachment({ type: 'voice', filename: 'memo.webm', mimeType: 'audio/webm', bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) });

    for (const source of sources) {
      const before = project;
      const result = await processContextSource(project, {
        ...source,
        hash: `hash-${source.sourceId}`,
      }, DEFAULT_USER_PROFILE, { genAI });
      expect(result.error).toBeUndefined();
      expect(result.skipped).toBe(false);
      expect(result.project.sources.find((item) => item.id === source.sourceId)).toMatchObject({
        type: source.type,
        processing_status: 'completed',
        ...(source.storageUrl ? { storage_url: source.storageUrl } : {}),
      });
      expect(result.project.historyEvents?.filter((event) => event.sourceId === source.sourceId)).toHaveLength(1);

      const collections = projectToCollections('test-user', result.project);
      project = collectionsToProject(collections, result.project.id)!;
      expect(project.id).toBe(before.id);
      expect(project.sources.find((item) => item.id === source.sourceId)?.processing_status).toBe('completed');
      expect(project.nodes.some((node) => node.source_refs.includes(source.sourceId))).toBe(true);
    }

    expect(project.sources).toHaveLength(sources.length);
    expect(project.historyEvents?.filter((event) => event.type === 'context_added')).toHaveLength(sources.length);
    expect(project.edges).toEqual([]);
    expect(genAI.models.generateContent).toHaveBeenCalled();
  });
});
