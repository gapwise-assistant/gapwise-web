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
        questionClassification: 'PARAPHRASE',
        canonicalQuestionId: 'unknown_audit_a',
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

  it('merges equivalent and refining decisions into one canonical decision', async () => {
    const project = createProjectFromInput({ name: 'Workshop', goal: 'Run the workshop.' }, '2026-08-20T09:00:00Z');
    const first = await ingestContextSource(project, {
      sourceId: 'decision-source-a',
      filename: 'decision-a.txt',
      type: 'text',
      content: 'The venue choice is open.',
      derivedNodes: [{
        id: 'decision-venue',
        type: 'DECISION',
        text: 'Choose the workshop venue.',
        status: 'OPEN',
        confidence: 0.8,
        impact: 0.9,
      }],
    }, DEFAULT_USER_PROFILE);

    const updated = await ingestContextSource(first, {
      sourceId: 'decision-source-b',
      filename: 'decision-b.txt',
      type: 'text',
      content: 'The venue choice is now more specific.',
      derivedNodes: [{
        type: 'DECISION',
        text: 'Choose the accessible community venue for the workshop.',
        status: 'OPEN',
        confidence: 0.95,
        impact: 0.95,
        questionClassification: 'REFINES_EXISTING',
        canonicalNodeId: 'decision-venue',
      }],
    }, DEFAULT_USER_PROFILE);

    const decisions = updated.nodes.filter((node) => node.type === 'DECISION');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      id: 'decision-venue',
      text: 'Choose the accessible community venue for the workshop.',
      reconciliation_classification: 'REFINES_EXISTING',
    });
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
    const canonicalId = (text: string) => project.nodes.find((node) => node.text === text)?.id;
    project = await ingestContextSource(project, {
      sourceId: 'pc-retailer-quote',
      filename: '02 Retailer Quotes',
      type: 'text',
      content: 'Retailer quote checks',
      derivedNodes: [
        { type: 'UNKNOWN', text: 'Is the old 650 W PSU safe for the chosen GPU?', confidence: 0.9, impact: 0.9, questionClassification: 'PARAPHRASE', canonicalQuestionId: canonicalId('Can the existing 650 W power supply safely run the selected GPU?') },
        { type: 'UNKNOWN', text: 'Can the RTX 5070 and CPU cooler fit without unacceptable heat or noise?', confidence: 0.9, impact: 0.9, questionClassification: 'PARAPHRASE', canonicalQuestionId: canonicalId('Will the selected graphics card and CPU cooler fit while keeping temperatures and noise acceptable?') },
        { type: 'UNKNOWN', text: 'Does the $1,472 balanced quote remain below $1,600 after tax and shipping?', confidence: 0.9, impact: 0.85, questionClassification: 'PARAPHRASE', canonicalQuestionId: canonicalId('Can the final configuration stay under the $1,600 all-in budget after tax and shipping?') },
        { type: 'UNKNOWN', text: 'Is 32 GB enough for the largest Blender scene plus a local model?', confidence: 0.9, impact: 0.8, questionClassification: 'PARAPHRASE', canonicalQuestionId: canonicalId('Is 32 GB of memory enough for Blender scenes and local AI experiments?') },
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

  it('does not let an unfinished action resolve a question or unrelated evidence inform a decision', async () => {
    const project = createProjectFromInput({ name: 'Release plan', goal: 'Ship a reliable release.' }, '2026-08-20T09:00:00Z');
    const updated = await ingestContextSource(project, {
      sourceId: 'relationship-note',
      filename: 'relationship-note.txt',
      type: 'text',
      content: 'The note contains unrelated details.',
      derivedNodes: [
        {
          type: 'NEXT_ACTION',
          text: 'Test the integration before launch.',
          confidence: 0.9,
          impact: 0.8,
          relationship: 'resolves',
          relatedNodeIds: ['new:1'],
        },
        {
          type: 'UNKNOWN',
          text: 'What is the integration status?',
          confidence: 0.8,
          impact: 0.8,
        },
        {
          type: 'EVIDENCE',
          text: 'The sample contains an unrelated contact detail.',
          confidence: 0.9,
          impact: 0.7,
        },
        {
          type: 'DECISION',
          text: 'Choose the release timing.',
          confidence: 0.9,
          impact: 0.8,
          status: 'OPEN',
        },
      ],
      relationships: [{ sourceNodeIndex: 2, targetNodeId: 'new:3', type: 'informs', confidence: 0.95 }],
    }, DEFAULT_USER_PROFILE);

    expect(updated.nodes.find((node) => node.text === 'What is the integration status?')?.status).toBe('OPEN');
    expect(updated.edges.some((edge) => edge.type === 'resolves')).toBe(false);
    expect(updated.edges.some((edge) => edge.type === 'informs')).toBe(false);
  });

  it('persists satisfies for an intended action without resolving its target', async () => {
    const project = createProjectFromInput({ name: 'Venue plan', goal: 'Choose and book a suitable venue.' }, '2026-08-20T09:00:00Z');
    const updated = await ingestContextSource(project, {
      sourceId: 'satisfies-note',
      filename: 'satisfies-note.txt',
      type: 'text',
      content: 'The next action is to select the venue for the workshop.',
      derivedNodes: [
        {
          type: 'NEXT_ACTION',
          text: 'Select the workshop venue.',
          confidence: 0.9,
          impact: 0.8,
          relationship: 'satisfies',
          relatedNodeIds: ['new:1'],
        },
        {
          type: 'DECISION',
          text: 'Choose the workshop venue.',
          confidence: 0.9,
          impact: 0.9,
          status: 'OPEN',
        },
      ],
    }, DEFAULT_USER_PROFILE);

    const action = updated.nodes.find((node) => node.text === 'Select the workshop venue.');
    const decision = updated.nodes.find((node) => node.text === 'Choose the workshop venue.');
    expect(updated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: action?.id, target: decision?.id, type: 'satisfies' }),
    ]));
    expect(action?.status).toBe('OPEN');
    expect(decision?.status).toBe('OPEN');
    expect(decision?.why_it_matters ?? []).not.toContain(expect.stringContaining('Resolved by newer evidence'));
  });

  it('rejects resolves from an unfinished action even when the target is a decision', async () => {
    const project = createProjectFromInput({ name: 'Venue plan', goal: 'Choose and book a suitable venue.' }, '2026-08-20T09:00:00Z');
    const updated = await ingestContextSource(project, {
      sourceId: 'invalid-resolves-note',
      filename: 'invalid-resolves-note.txt',
      type: 'text',
      content: 'The next action is to select the venue for the workshop.',
      derivedNodes: [
        {
          type: 'NEXT_ACTION',
          text: 'Select the workshop venue.',
          confidence: 0.9,
          impact: 0.8,
          relationship: 'resolves',
          relatedNodeIds: ['new:1'],
        },
        {
          type: 'DECISION',
          text: 'Choose the workshop venue.',
          confidence: 0.9,
          impact: 0.9,
          status: 'OPEN',
        },
      ],
    }, DEFAULT_USER_PROFILE);

    expect(updated.edges.some((edge) => edge.type === 'resolves')).toBe(false);
  });

  it('does not let negative evidence resolve an open question even when the model supplies resolves', async () => {
    const project = createProjectFromInput({ name: 'Release check', goal: 'Verify the release path.' }, '2026-08-20T09:00:00Z');
    project.nodes.push({
      id: 'release_question',
      type: 'UNKNOWN',
      text: 'Does the corrected request resolve the failure?',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-20T09:00:00Z',
      updated_at: '2026-08-20T09:00:00Z',
    });

    const updated = await ingestContextSource(project, {
      sourceId: 'negative-result',
      filename: 'negative-result.txt',
      type: 'text',
      content: 'I have not tested the corrected request.',
      derivedNodes: [{
        type: 'EVIDENCE',
        text: 'I have not tested the corrected request.',
        confidence: 0.95,
        impact: 0.9,
        relationship: 'resolves',
        relatedNodeIds: ['release_question'],
      }],
    }, DEFAULT_USER_PROFILE);

    expect(updated.nodes.find((node) => node.id === 'release_question')?.status).toBe('OPEN');
    expect(updated.edges.some((edge) => edge.type === 'resolves')).toBe(false);
  });

  it.each([
    'The corrected request returned 201 and created the expected record.',
    'The completed request failed with a recorded authentication error.',
  ])('accepts a conclusive result statement for resolution: %s', async (resultText) => {
    const project = createProjectFromInput({ name: 'Release check', goal: 'Verify the release path.' }, '2026-08-20T09:00:00Z');
    project.nodes.push({
      id: 'release_question',
      type: 'UNKNOWN',
      text: 'Does the corrected request resolve the failure?',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-20T09:00:00Z',
      updated_at: '2026-08-20T09:00:00Z',
    });

    const updated = await ingestContextSource(project, {
      sourceId: 'conclusive-result',
      filename: 'conclusive-result.txt',
      type: 'text',
      content: resultText,
      derivedNodes: [{
        type: 'EVIDENCE',
        text: resultText,
        confidence: 0.95,
        impact: 0.9,
        relationship: 'resolves',
        relatedNodeIds: ['release_question'],
      }],
    }, DEFAULT_USER_PROFILE);

    expect(updated.nodes.find((node) => node.id === 'release_question')?.status).toBe('RESOLVED');
    expect(updated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.any(String), target: 'release_question', type: 'resolves' }),
    ]));
  });

  it('closes an open decision when a valid completed outcome resolves it', async () => {
    const project = createProjectFromInput({ name: 'Workshop plan', goal: 'Choose a safe workshop format.' }, '2026-08-20T09:00:00Z');
    project.nodes.push({
      id: 'format_decision',
      type: 'DECISION',
      text: 'Choose the workshop format.',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent',
      created_at: '2026-08-20T09:00:00Z',
      updated_at: '2026-08-20T09:00:00Z',
    });

    const updated = await ingestContextSource(project, {
      sourceId: 'format-result',
      filename: 'format-result.txt',
      type: 'text',
      content: 'The completed pilot confirmed that the small-group format worked.',
      derivedNodes: [{
        type: 'EVIDENCE',
        text: 'The completed pilot confirmed that the small-group format worked.',
        confidence: 0.95,
        impact: 0.9,
        relationship: 'resolves',
        relatedNodeIds: ['format_decision'],
      }],
    }, DEFAULT_USER_PROFILE);

    expect(updated.nodes.find((node) => node.id === 'format_decision')?.status).toBe('RESOLVED');
    expect(updated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'format_decision', type: 'resolves' }),
    ]));
  });

  it('does not pair an ambiguous failure with an arbitrary unfinished action in fallback mode', async () => {
    const project = createProjectFromInput({ name: 'Release check', goal: 'Prepare a reliable demo.' }, '2026-08-20T09:00:00Z');
    const updated = await ingestContextSource(project, {
      sourceId: 'ambiguous-failure',
      filename: 'ambiguous-failure.txt',
      type: 'text',
      content: 'The endpoint is failing. I have not replaced the sample label. I have not tested the corrected configuration.',
    }, DEFAULT_USER_PROFILE);

    expect(updated.nodes.some((node) => node.type === 'UNKNOWN' && /resolve the endpoint failure/i.test(node.text))).toBe(false);
    expect(updated.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Replace the sample label.' }),
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Test the corrected configuration.' }),
    ]));
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

  it('preserves an explicitly open decision without linking same-source unknowns automatically', async () => {
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
    expect(updated.edges).not.toEqual(expect.arrayContaining([
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
    expect(questionEdges).toHaveLength(0);
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

  it('preserves every explicit ClinicFlow launch question without linking them automatically', async () => {
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
    expect(project.edges.filter((edge) => edge.type === 'blocks')).toHaveLength(0);

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
      derivedNodes: [
        { type: 'UNKNOWN', text: 'Dr. Chen has not accepted clinical accountability.', confidence: 0.8, impact: 0.8, questionClassification: 'PARAPHRASE', canonicalQuestionId: project.nodes.find((node) => /clinical accountability/i.test(node.text))?.id },
        { type: 'UNKNOWN', text: 'The vendor has not demonstrated idempotent retry behavior.', confidence: 0.8, impact: 0.8, questionClassification: 'PARAPHRASE', canonicalQuestionId: project.nodes.find((node) => /offline queue retry/i.test(node.text))?.id },
        { type: 'UNKNOWN', text: 'Legal has not approved the SMS consent text.', confidence: 0.8, impact: 0.8, questionClassification: 'PARAPHRASE', canonicalQuestionId: project.nodes.find((node) => /SMS consent/i.test(node.text))?.id },
      ],
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

  it('captures pending status prose as a generic confirmation question without domain rules', async () => {
    const project = createProjectFromInput({
      name: 'Upcoming appointment',
      goal: 'Complete the upcoming appointment with the required preparation confirmed.',
      deadline: '2026-09-10',
    }, '2026-08-20T12:00:00Z');
    const updated = await ingestContextSource(project, {
      sourceId: 'appointment-note',
      filename: 'appointment-note.txt',
      type: 'text',
      content: [
        'My appointment is scheduled for September 10, but the final time conflicts with another commitment.',
        'My insurance company told me the procedure authorization is still being reviewed.',
        'Transport is uncertain. The responsible team has not confirmed the required preparation.',
      ].join(' '),
    }, DEFAULT_USER_PROFILE);

    const questions = updated.nodes.filter((node) => node.type === 'UNKNOWN' && node.source_refs.includes('appointment-note'));
    expect(questions.map((node) => node.text)).toEqual(expect.arrayContaining([
      'What current status is recorded for procedure authorization?',
      'Has the responsible team confirmed the required preparation?',
    ]));
    expect(questions.some((node) => /authorization|preparation/i.test(node.text))).toBe(true);
    expect(questions.some((node) => /insurance|appointment|transport/i.test(node.text))).toBe(true);
    expect(questions.some((node) => /insurance company told me/i.test(node.text))).toBe(false);
  });

  it('keeps a pending external confirmation separate from user-controlled work', async () => {
    const project = createProjectFromInput({
      name: 'Release readiness',
      goal: 'Ship the release with the required confirmation recorded.',
    }, '2026-08-20T12:00:00Z');
    const updated = await ingestContextSource(project, {
      sourceId: 'approval-note',
      filename: 'approval-note.txt',
      type: 'text',
      content: 'The reviewing office told me the final approval is still being reviewed.',
    }, DEFAULT_USER_PROFILE);

    const questions = updated.nodes.filter((node) => node.type === 'UNKNOWN' && node.source_refs.includes('approval-note'));
    expect(questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'What current status is recorded for final approval?' }),
    ]));
    expect(questions.some((node) => /reviewing office told me/i.test(node.text))).toBe(false);
  });

  it('turns a missing conditional fallback into a generic open question', async () => {
    const project = createProjectFromInput({
      name: 'Demo app',
      goal: 'Present a reliable working demo.',
    }, '2026-08-20T12:00:00Z');
    const updated = await ingestContextSource(project, {
      sourceId: 'demo-risk-source',
      filename: 'demo-risk.txt',
      type: 'text',
      content: 'If matching takes longer than five seconds, we do not have a fallback screen.',
    }, DEFAULT_USER_PROFILE);

    expect(updated.nodes.map((node) => node.text)).toContain(
      'What fallback is available if matching takes longer than five seconds?'
    );
  });

  it('keeps a first-person unresolved action as evidence and unfinished work', async () => {
    const project = createProjectFromInput({
      name: 'Demo app',
      goal: 'Present a reliable working demo.',
    }, '2026-08-20T12:00:00Z');
    const updated = await ingestContextSource(project, {
      sourceId: 'credential-note',
      filename: 'credential-note.txt',
      type: 'text',
      content: 'I have not tested both values from the same project.',
    }, DEFAULT_USER_PROFILE);

    expect(updated.nodes.some((node) => node.type === 'UNKNOWN' && /have i tested/i.test(node.text))).toBe(false);
    expect(updated.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'NEXT_ACTION', text: 'Test both values from the same project.' }),
      expect.objectContaining({ type: 'EVIDENCE', text: 'I have not tested both values from the same project.' }),
    ]));
  });
});
