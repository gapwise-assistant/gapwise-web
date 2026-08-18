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

  it('preserves an explicitly open decision and links same-source unknowns to it', async () => {
    const project = createGoldenDemoProject();
    const updated = await ingestContextSource(project, {
      sourceId: 'clinic-decision-source',
      filename: 'clinic-decision.md',
      type: 'text',
      content: 'OPEN DECISION: Should ClinicFlow launch the pilot? The decision is blocked by safety and adoption evidence.',
      derivedNodes: [
        {
          type: 'DECISION',
          text: 'Should ClinicFlow launch the pilot?',
          status: 'OPEN',
          confidence: 0.9,
          impact: 0.95,
        },
        {
          type: 'UNKNOWN',
          text: 'Is the intake routing safe enough?',
          confidence: 0.4,
          impact: 0.9,
        },
      ],
    }, DEFAULT_USER_PROFILE);

    const decision = updated.nodes.find((node) => node.type === 'DECISION' && node.source_refs.includes('clinic-decision-source'));
    const question = updated.nodes.find((node) => node.type === 'UNKNOWN' && node.source_refs.includes('clinic-decision-source'));
    expect(decision?.status).toBe('OPEN');
    expect(updated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: question?.id, target: decision?.id, type: 'blocks' }),
    ]));
  });

  it('does not create a complete cross-product when a source contains multiple decisions', async () => {
    const updated = await ingestContextSource(createGoldenDemoProject(), {
      sourceId: 'multi-decision-source',
      filename: 'multi-decision.md',
      type: 'text',
      content: 'OPEN DECISION: Should the pilot launch? Two decisions remain open and each question belongs to one choice.',
      derivedNodes: [
        { type: 'DECISION', text: 'Should the pilot launch?', status: 'OPEN', confidence: 0.9, impact: 0.9 },
        { type: 'DECISION', text: 'Should billing integration ship?', status: 'OPEN', confidence: 0.9, impact: 0.9 },
        { type: 'UNKNOWN', text: 'Is the pilot launch safe?', confidence: 0.4, impact: 0.8 },
        { type: 'UNKNOWN', text: 'Is the billing integration ready?', confidence: 0.4, impact: 0.8 },
      ],
    }, DEFAULT_USER_PROFILE);
    const decisions = updated.nodes.filter((node) => node.type === 'DECISION' && node.source_refs.includes('multi-decision-source'));
    const questionIds = updated.nodes.filter((node) => node.type === 'UNKNOWN' && node.source_refs.includes('multi-decision-source')).map((node) => node.id);
    const questionEdges = updated.edges.filter((edge) => questionIds.includes(edge.source) && (edge.type === 'blocks' || edge.type === 'informs'));
    expect(decisions).toHaveLength(2);
    expect(questionEdges).toHaveLength(2);
    expect(new Set(questionEdges.map((edge) => edge.source)).size).toBe(2);
  });

  it('does not mark every decision in a source open when only one decision is explicit', async () => {
    const updated = await ingestContextSource(createGoldenDemoProject(), {
      sourceId: 'one-open-decision-source',
      filename: 'decision-history.md',
      type: 'text',
      content: 'OPEN DECISION: Should the pilot launch? A previous billing decision was already made.',
      derivedNodes: [
        { type: 'DECISION', text: 'Should the pilot launch?', confidence: 0.9, impact: 0.9 },
        { type: 'DECISION', text: 'The billing integration decision was already made.', confidence: 0.9, impact: 0.7 },
      ],
    }, DEFAULT_USER_PROFILE);
    const decisions = updated.nodes.filter((node) => node.source_refs.includes('one-open-decision-source') && node.type === 'DECISION');
    expect(decisions.find((node) => node.text.startsWith('Should the pilot'))?.status).toBe('OPEN');
    expect(decisions.find((node) => node.text.startsWith('The billing'))?.status).toBe('RESOLVED');
  });
});
