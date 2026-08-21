import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { discardContextSource, ingestContextSource, restoreContextSource } from '@/lib/context/ingestion';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { canonicalOpenQuestions } from '@/lib/questions/canonical';

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

  it('records when a completed or failed processing attempt ended', async () => {
    const completed = await ingestContextSource(createGoldenDemoProject(), {
      sourceId: 'processed-source',
      filename: 'processed-note.txt',
      type: 'text',
      content: 'The pilot has a fixed September decision deadline.',
    }, DEFAULT_USER_PROFILE);
    const completedSource = completed.sources.find((source) => source.id === 'processed-source');
    expect(completedSource?.processing_status).toBe('completed');
    expect(completedSource?.processed_at).toBeTruthy();
    expect(Number.isNaN(new Date(completedSource?.processed_at ?? '').getTime())).toBe(false);

    const failed = await ingestContextSource(createGoldenDemoProject(), {
      sourceId: 'failed-source',
      filename: 'failed-upload.pdf',
      type: 'pdf',
      content: '',
      processingStatus: 'failed',
      errorMessage: 'No extractable content.',
    }, DEFAULT_USER_PROFILE);
    const failedSource = failed.sources.find((source) => source.id === 'failed-source');
    expect(failedSource?.processing_status).toBe('failed');
    expect(failedSource?.processed_at).toBeTruthy();
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

  it('merges near-duplicate unknown questions while keeping distinct questions separate', async () => {
    const first = await ingestContextSource(createProjectFromInput({ name: 'ClinicFlow', goal: 'Make the pilot decision.' }, '2026-08-20T12:00:00Z'), {
      sourceId: 'question-source-a',
      filename: 'audit-note.md',
      type: 'text',
      content: 'The vendor audit trail needs review.',
      derivedNodes: [{
        id: 'unknown_audit_a',
        type: 'UNKNOWN',
        text: 'Does the vendor audit log distinguish patient edits, coordinator edits, and clinician approval?',
        confidence: 0.55,
        impact: 0.8,
      }],
    }, DEFAULT_USER_PROFILE);
    const merged = await ingestContextSource(first, {
      sourceId: 'question-source-b',
      filename: 'steering-note.md',
      type: 'text',
      content: 'Confirm the audit distinction before launch.',
      derivedNodes: [{
        id: 'unknown_audit_b',
        type: 'UNKNOWN',
        text: 'Confirm that the vendor audit log distinguishes patient edits, coordinator edits, and clinician approval.',
        confidence: 0.8,
        impact: 0.9,
      }],
    }, DEFAULT_USER_PROFILE);

    const auditQuestions = merged.nodes.filter((node) => node.type === 'UNKNOWN' && /audit log/i.test(node.text));
    expect(auditQuestions).toHaveLength(1);
    expect(auditQuestions[0]?.source_refs).toEqual(expect.arrayContaining(['question-source-a', 'question-source-b']));

    const distinct = await ingestContextSource(merged, {
      sourceId: 'question-source-c',
      filename: 'consent-note.md',
      type: 'text',
      content: 'Legal approval is still missing.',
      derivedNodes: [{
        id: 'unknown_sms_c',
        type: 'UNKNOWN',
        text: 'Is the SMS consent language approved for PHI-related intake?',
        confidence: 0.8,
        impact: 0.9,
      }],
    }, DEFAULT_USER_PROFILE);
    expect(distinct.nodes.filter((node) => node.type === 'UNKNOWN')).toHaveLength(2);
  });

  it('keeps one canonical question per PC-build uncertainty across repeated source wording', async () => {
    let project = createProjectFromInput({ name: 'Quiet 1440p Workstation Build', goal: 'Build a quiet PC within budget.' }, '2026-08-20T09:00:00Z');
    project = await ingestContextSource(project, {
      sourceId: 'pc-build-brief',
      filename: '01 Build Brief',
      type: 'text',
      content: 'PC build brief',
      derivedNodes: [
        { type: 'UNKNOWN', text: 'Which GPU is the better fit for 1440p gaming, Blender, and local AI work?', confidence: 0.8, impact: 0.9 },
        { type: 'UNKNOWN', text: 'Can the existing 650 W power supply safely run the selected GPU?', confidence: 0.8, impact: 0.9 },
        { type: 'UNKNOWN', text: 'Will the selected graphics card and CPU cooler fit while keeping temperatures and noise acceptable?', confidence: 0.8, impact: 0.9 },
        { type: 'UNKNOWN', text: 'Is 32 GB of memory enough for Blender scenes and local AI experiments?', confidence: 0.8, impact: 0.8 },
        { type: 'UNKNOWN', text: 'Can the final configuration stay under the $1,600 all-in budget after tax and shipping?', confidence: 0.8, impact: 0.9 },
        { type: 'UNKNOWN', text: 'Has the retailer confirmed that the motherboard BIOS supports the selected CPU?', confidence: 0.8, impact: 0.8 },
        { type: 'UNKNOWN', text: 'Does the build need built-in Wi-Fi?', confidence: 0.8, impact: 0.6 },
      ],
    }, DEFAULT_USER_PROFILE);
    project = await ingestContextSource(project, {
      sourceId: 'pc-retailer-quote',
      filename: '02 Retailer Quotes',
      type: 'text',
      content: 'Retailer quote checks',
      derivedNodes: [
        { type: 'UNKNOWN', text: 'Is the old 650 W PSU safe for the chosen GPU?', confidence: 0.9, impact: 0.9 },
        { type: 'UNKNOWN', text: 'Can the RTX 5070 and CPU cooler fit without unacceptable heat or noise?', confidence: 0.9, impact: 0.9 },
        { type: 'UNKNOWN', text: 'Does the $1,472 balanced quote remain below $1,600 after tax and shipping?', confidence: 0.9, impact: 0.85 },
        { type: 'UNKNOWN', text: 'Is 32 GB enough for the largest Blender scene plus a local model?', confidence: 0.9, impact: 0.8 },
      ],
    }, DEFAULT_USER_PROFILE);

    expect(canonicalOpenQuestions(project)).toHaveLength(7);
    expect(project.nodes.filter((node) => node.type === 'UNKNOWN').length).toBeGreaterThanOrEqual(7);
    expect(project.nodes.find((node) => /650 W power supply/i.test(node.text))?.question_aliases).toContain('Is the old 650 W PSU safe for the chosen GPU?');
  });

  it('turns a negative BIOS status statement into evidence for the existing BIOS question', async () => {
    const project = createProjectFromInput({ name: 'Quiet PC', goal: 'Build a quiet PC within budget.' }, '2026-08-20T09:00:00Z');
    project.nodes.push({
      id: 'bios_question',
      type: 'UNKNOWN',
      text: 'Has the retailer confirmed that the motherboard BIOS supports the selected CPU?',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.8,
      source_refs: ['pc-build-brief'],
      created_by: 'agent',
      created_at: '2026-08-20T09:00:00Z',
      updated_at: '2026-08-20T09:00:00Z',
    });

    const updated = await ingestContextSource(project, {
      sourceId: 'pc-retailer-quote',
      filename: '02 Retailer Quotes',
      type: 'text',
      content: 'The retailer has not confirmed the motherboard BIOS version.',
    }, DEFAULT_USER_PROFILE);

    expect(updated.nodes.filter((node) => node.type === 'UNKNOWN' && /bios/i.test(node.text))).toHaveLength(1);
    expect(updated.nodes.find((node) => node.id === 'bios_question')?.source_refs).toEqual(expect.arrayContaining(['pc-build-brief', 'pc-retailer-quote']));
  });

  it('does not treat a structural dependency as direct evidence for its target', async () => {
    const project = createProjectFromInput({ name: 'Quiet PC', goal: 'Build a quiet PC within budget.' }, '2026-08-20T09:00:00Z');
    project.nodes.push({
      id: 'budget_question',
      type: 'UNKNOWN',
      text: 'Can the final configuration stay under $1,600 after tax and shipping?',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.9,
      source_refs: ['brief'],
      created_by: 'agent',
      created_at: '2026-08-20T09:00:00Z',
      updated_at: '2026-08-20T09:00:00Z',
    });

    const updated = await ingestContextSource(project, {
      sourceId: 'os-notes',
      filename: '03 Operating System Notes',
      type: 'text',
      content: 'The operating-system decision remains open.',
      derivedNodes: [{
        id: 'os_question',
        type: 'UNKNOWN',
        text: 'Do I need Windows Pro for Hyper-V and Remote Desktop?',
        confidence: 0.8,
        impact: 0.7,
        relationship: 'depends_on',
        relatedNodeIds: ['budget_question'],
      }],
    }, DEFAULT_USER_PROFILE);

    expect(updated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'os_question', target: 'budget_question', type: 'depends_on' }),
    ]));
    expect(updated.nodes.find((node) => node.id === 'budget_question')?.source_refs).not.toContain('os-notes');
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

  it('preserves every explicit ClinicFlow launch question and links them to the pending decision', async () => {
    let project = createProjectFromInput({ name: 'ClinicFlow', goal: 'Make a safe pilot decision.', deadline: '2026-09-04' }, '2026-08-20T12:00:00Z');
    project = await ingestContextSource(project, {
      sourceId: 'clinic-brief',
      filename: '01 Pilot Brief',
      type: 'text',
      content: [
        'The pending go/no-go decision must be made by September 4.',
        'The go/no-go decision is explicitly blocked by four unresolved inputs:',
        '- Who has final clinical accountability and legal authority to correct medication or allergy information?',
        '- Can the offline queue retry without creating duplicate EHR records?',
        '- Is the SMS consent language approved for PHI-related intake?',
        '- Can one coordinator safely handle exception review during the Monday peak?',
      ].join('\n'),
    }, DEFAULT_USER_PROFILE);

    const questions = project.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN');
    expect(questions.map((node) => node.text)).toEqual(expect.arrayContaining([
      'Who has final clinical accountability and legal authority to correct medication or allergy information?',
      'Can the offline queue retry without creating duplicate EHR records?',
      'Is the SMS consent language approved for PHI-related intake?',
      'Can one coordinator safely handle exception review during the Monday peak?',
    ]));
    expect(questions).toHaveLength(4);
    expect(project.edges.filter((edge) => edge.type === 'blocks')).toHaveLength(4);

    project = await ingestContextSource(project, {
      sourceId: 'clinic-steering',
      filename: '02 Steering Update',
      type: 'text',
      content: [
        'What remains unresolved:',
        '- Dr. Chen has not accepted clinical accountability.',
        '- The vendor has not demonstrated idempotent retry behavior.',
        '- Legal has not approved the SMS consent text.',
      ].join('\n'),
    }, DEFAULT_USER_PROFILE);

    expect(project.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN')).toHaveLength(4);
    expect(project.nodes.find((node) => /clinical accountability/i.test(node.text))?.source_refs)
      .toEqual(expect.arrayContaining(['clinic-brief', 'clinic-steering']));
    expect(project.nodes.find((node) => /offline queue retry/i.test(node.text))?.source_refs)
      .toEqual(expect.arrayContaining(['clinic-brief', 'clinic-steering']));
    expect(project.nodes.find((node) => /SMS consent/i.test(node.text))?.source_refs)
      .toEqual(expect.arrayContaining(['clinic-brief', 'clinic-steering']));
  });

  it('uses conclusive local evidence to resolve the matching retry question without resolving negative blockers', async () => {
    let project = createProjectFromInput({ name: 'ClinicFlow', goal: 'Make a safe pilot decision.' }, '2026-08-20T12:00:00Z');
    project = await ingestContextSource(project, {
      sourceId: 'retry-question-source',
      filename: 'pilot-brief.md',
      type: 'text',
      content: 'Can the offline queue retry without creating duplicate EHR records? Is the SMS consent language approved for PHI-related intake?',
    }, DEFAULT_USER_PROFILE);
    project = await ingestContextSource(project, {
      sourceId: 'retry-result-source',
      filename: 'offline-retry-test.md',
      type: 'text',
      content: 'The 20-record offline retry test produced three duplicate EHR records. The connector has no stable idempotency key.',
    }, DEFAULT_USER_PROFILE);

    expect(project.nodes.find((node) => /offline queue retry/i.test(node.text))?.status).toBe('RESOLVED');
    expect(project.nodes.find((node) => /SMS consent/i.test(node.text))?.status).toBe('OPEN');
    expect(project.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: expect.stringContaining('node'), type: 'resolves' }),
    ]));
  });
});
