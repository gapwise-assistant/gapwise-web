import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { discardContextSource, ingestContextSource, restoreContextSource } from '@/lib/context/ingestion';

describe('context ingestion', () => {
  it('ingests a PDF excerpt with source metadata and derived node provenance', async () => {
    const project = createGoldenDemoProject();
    const updated = await ingestContextSource(
      project,
      {
        filename: 'customer-research.pdf',
        type: 'pdf',
        mimeType: 'application/pdf',
        sizeBytes: 42_000,
        storageUrl: 'local-demo://customer-research.pdf',
        content: 'Must validate the founder persona before the demo script is finalized.',
      },
      DEFAULT_USER_PROFILE
    );

    const source = updated.sources.find((item) => item.filename === 'customer-research.pdf');
    expect(source).toMatchObject({
      type: 'pdf',
      processing_status: 'completed',
      mime_type: 'application/pdf',
      size_bytes: 42_000,
      origin: 'user',
    });
    expect(source?.derived_node_ids).toHaveLength(1);
    expect(updated.nodes.find((node) => node.id === source?.derived_node_ids[0])?.source_refs).toEqual([
      source?.id,
    ]);
  });

  it('captures voice notes as source-backed preference context', async () => {
    const project = createGoldenDemoProject();
    const updated = await ingestContextSource(
      project,
      {
        filename: 'priority-voice-note.m4a',
        type: 'voice',
        mimeType: 'audio/mp4',
        content: 'Financial stability is my top priority for the next three months.',
      },
      DEFAULT_USER_PROFILE
    );

    const source = updated.sources.at(-1);
    const node = updated.nodes.find((item) => item.id === source?.derived_node_ids[0]);
    expect(source?.type).toBe('voice');
    expect(node?.type).toBe('PREFERENCE');
    expect(node?.source_refs).toContain(source?.id);
  });

  it('moves a source to discarded context and can restore it without deleting provenance', async () => {
    const project = await ingestContextSource(
      createGoldenDemoProject(),
      {
        filename: 'screenshot.png',
        type: 'image',
        mimeType: 'image/png',
        content: 'Screenshot shows latency risk in the live demo path.',
      },
      DEFAULT_USER_PROFILE
    );
    const source = project.sources.at(-1);
    const nodeId = source?.derived_node_ids[0];

    const discarded = discardContextSource(project, source?.id ?? '', DEFAULT_USER_PROFILE);

    expect(discarded.sources.find((item) => item.id === source?.id)?.discarded_at).toBeTruthy();
    expect(discarded.nodes.find((node) => node.id === nodeId)?.status).toBe('OPEN');

    const restored = restoreContextSource(discarded, source?.id ?? '', DEFAULT_USER_PROFILE);
    expect(restored.sources.find((item) => item.id === source?.id)?.discarded_at).toBeUndefined();
    expect(restored.nodes.find((node) => node.id === nodeId)?.source_refs).toContain(source?.id);
  });
});
