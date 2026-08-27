import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { createDurableMemory, shouldPromoteToDurableMemory } from '@/lib/memory/policy';
import { forgetMemory } from '@/lib/memory/store';

describe('Context Pack retrieval and durable memory policy', () => {
  it('does not expose a satisfied open action as an upcoming commitment', () => {
    const project = createGoldenDemoProject();
    const target = {
      ...project.nodes.find((node) => node.type === 'DECISION')!,
      id: 'resolved-outcome-for-context',
      status: 'RESOLVED' as const,
    };
    const staleAction = {
      id: 'stale-context-action',
      type: 'NEXT_ACTION' as const,
      text: 'Confirm the resolved operating model.',
      status: 'OPEN' as const,
      confidence: 0.9,
      impact: 0.9,
      source_refs: [],
      created_by: 'agent' as const,
      created_at: project.created_at,
      updated_at: project.updated_at,
    };
    project.nodes = [project.nodes.find((node) => node.type === 'GOAL')!, target, staleAction];
    project.edges = [{
      id: 'stale-context-satisfaction',
      source: staleAction.id,
      target: target.id,
      type: 'satisfies',
    }];

    const pack = buildContextPack({
      userId: 'context-user',
      query: 'operating model',
      project,
      profile: DEFAULT_USER_PROFILE,
    });

    expect(pack.upcomingCommitments.some((node) => node.id === staleAction.id)).toBe(false);
  });

  it('retrieves relevant evidence and excludes irrelevant source flooding', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_recruiter',
      filename: 'recruiter-email.txt',
      type: 'text',
      content: 'A recruiter asked whether the user is open to a better-paying AI role.',
      extracted_at: '2026-08-10T12:00:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });
    project.sources.push({
      id: 'src_recipe',
      filename: 'recipe.txt',
      type: 'text',
      content: 'A sourdough recipe with flour, water, salt, and fermentation timing.',
      extracted_at: '2026-08-10T12:05:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });

    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'What am I neglecting about recruiter financial stability?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });

    expect(pack.relevantEvidence.some((evidence) => evidence.source_id === 'src_recruiter')).toBe(true);
    expect(pack.relevantEvidence.some((evidence) => evidence.source_id === 'src_recipe')).toBe(false);
  });

  it('excludes the current Ask message, generated source, and source-only graph nodes', () => {
    const project = createGoldenDemoProject();
    const currentSourceId = 'ask_chat_current_message';
    const currentMessageId = 'message_current';
    project.sources.push({
      id: currentSourceId,
      filename: 'Ask current message.txt',
      type: 'note',
      content: 'The current message contains the MiniDV question and should not support its own answer.',
      extracted_at: '2026-08-21T10:00:00Z',
      derived_node_ids: ['node_only_from_current_message'],
      processing_status: 'completed',
      origin: 'user',
    });
    project.nodes.push({
      id: 'node_only_from_current_message',
      type: 'UNKNOWN',
      text: 'What is the MiniDV format?',
      status: 'OPEN',
      confidence: 1,
      impact: 0.5,
      source_refs: [currentSourceId],
      created_by: 'user',
      created_at: '2026-08-21T10:00:00Z',
      updated_at: '2026-08-21T10:00:00Z',
    });

    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'What is the MiniDV format?',
      project,
      profile: DEFAULT_USER_PROFILE,
      excludeMessageId: currentMessageId,
      excludeSourceId: currentSourceId,
      conversationMessages: [
        {
          id: currentMessageId,
          chatId: 'chat',
          userId: 'demo-user',
          role: 'user',
          text: 'What is the MiniDV format?',
          sources: [],
          createdAt: '2026-08-21T10:00:00Z',
        },
        {
          id: 'message_previous',
          chatId: 'chat',
          userId: 'demo-user',
          role: 'user',
          text: 'Earlier project planning notes.',
          sources: [],
          createdAt: '2026-08-20T10:00:00Z',
        },
      ],
    });

    expect(pack.relevantConversationExcerpts?.some((item) => item.messageId === currentMessageId)).toBe(false);
    expect(pack.relevantEvidence.some((item) => item.source_id === currentSourceId)).toBe(false);
    expect(pack.provenanceSources.some((item) => item.source_id === currentSourceId)).toBe(false);
    expect(pack.unresolvedGaps.some((node) => node.id === 'node_only_from_current_message')).toBe(false);
    expect(pack.includedContextIds).not.toContain(currentSourceId);
    expect(pack.includedContextIds).not.toContain('node_only_from_current_message');
  });

  it('prioritizes the newest evidence that resolved a project gap and excludes unrelated memories', () => {
    const project = createGoldenDemoProject();
    project.id = 'project_clinicflow';
    project.title = 'ClinicFlow — Manual AI Walkthrough';
    project.goal = 'Decide whether and how to launch a safe outpatient intake pilot.';
    project.nodes = [
      {
        id: 'decision_launch',
        type: 'DECISION',
        text: 'Choose a full launch, read-only pilot, delay, or workflow research.',
        status: 'OPEN',
        confidence: 1,
        impact: 0.95,
        source_refs: ['src_pilot'],
        created_by: 'agent',
        created_at: '2026-08-20T10:00:00Z',
        updated_at: '2026-08-20T10:00:00Z',
      },
      {
        id: 'unknown_offline_retry',
        type: 'UNKNOWN',
        text: 'Can offline retries occur without creating duplicate EHR records?',
        status: 'RESOLVED',
        confidence: 1,
        impact: 0.95,
        source_refs: ['src_pilot', 'src_steering', 'src_retry_results'],
        why_it_matters: [
          'Resolved by newer evidence from clinicflow-offline-retry-test-results.md: retries create duplicate EHR records.',
        ],
        created_by: 'agent',
        created_at: '2026-08-20T10:00:00Z',
        updated_at: '2026-08-20T12:00:00Z',
      },
      {
        id: 'unknown_sms_consent',
        type: 'UNKNOWN',
        text: 'Is the SMS consent language approved for PHI-related intake?',
        status: 'OPEN',
        confidence: 1,
        impact: 0.9,
        source_refs: ['src_pilot', 'src_steering'],
        created_by: 'agent',
        created_at: '2026-08-20T10:00:00Z',
        updated_at: '2026-08-20T11:00:00Z',
      },
    ];
    project.edges = [
      { id: 'edge_retry_launch', source: 'unknown_offline_retry', target: 'decision_launch', type: 'blocks' },
      { id: 'edge_sms_launch', source: 'unknown_sms_consent', target: 'decision_launch', type: 'blocks' },
    ];
    project.sources = [
      {
        id: 'src_pilot',
        filename: 'clinicflow-pilot-brief',
        type: 'text',
        content: 'The launch decision is blocked by offline retry safety and SMS consent approval.',
        extraction_summary: 'The pilot brief lists duplicate EHR records and SMS consent as unresolved.',
        extracted_at: '2026-08-20T10:00:00Z',
        derived_node_ids: ['decision_launch', 'unknown_offline_retry', 'unknown_sms_consent'],
        processing_status: 'completed',
      },
      {
        id: 'src_steering',
        filename: 'clinicflow-steering-update.md',
        type: 'text',
        content: 'Run the offline retry test, then obtain legal approval for SMS consent.',
        extraction_summary: 'The steering sequence puts retry testing before SMS consent approval.',
        extracted_at: '2026-08-20T11:00:00Z',
        derived_node_ids: ['unknown_offline_retry', 'unknown_sms_consent'],
        processing_status: 'completed',
      },
      {
        id: 'src_retry_results',
        filename: 'clinicflow-offline-retry-test-results.md',
        type: 'text',
        content: 'The 20-record offline retry test created three duplicate EHR records. Use read-only integration or delay.',
        extraction_summary: 'Offline retries created duplicate EHR records, resolving the retry uncertainty and ruling out automated writes.',
        extracted_at: '2026-08-20T12:00:00Z',
        derived_node_ids: ['unknown_offline_retry'],
        processing_status: 'completed',
      },
    ];

    const careerMemory = createDurableMemory('I prefer to avoid frontend-heavy career roles.')!;
    const duplicateCareerMemory = { ...careerMemory, id: 'duplicate_career_memory' };
    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'The offline retry test is now complete. Explain what changed, which uncertainty is answered, and why SMS consent is next. Cite only ClinicFlow sources. Do not use career memories or other projects.',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: [careerMemory, duplicateCareerMemory],
      scope: { type: 'project', projectId: project.id },
    });

    expect(pack.relevantEvidence.map((source) => source.source_id)).toEqual([
      'src_retry_results',
      'src_steering',
      'src_pilot',
    ]);
    expect(pack.provenanceSources[0].source_id).toBe('src_retry_results');
    expect(pack.recentlyResolvedGaps.map((node) => node.id)).toContain('unknown_offline_retry');
    expect(pack.unresolvedGaps.map((node) => node.id)).toContain('unknown_sms_consent');
    expect(pack.userPreferences).toEqual([]);
    expect(pack.includedContextIds).not.toContain(careerMemory.id);
    expect(pack.includedContextIds).not.toContain(duplicateCareerMemory.id);
  });

  it('retrieves a direct personal answer even when it is unrelated to the project goal', () => {
    const project = createGoldenDemoProject();
    project.title = 'Green pencils';
    project.goal = 'Choose the best green pencils for sketching.';
    project.sources = [{
      id: 'src_birthday',
      filename: 'personal-note.txt',
      type: 'text',
      content: 'My birthday is tomorrow.',
      extracted_at: '2026-08-13T12:00:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
      relevance: 'possibly_not_relevant',
    }];

    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'When is my birthday?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });

    expect(pack.relevantEvidence[0]).toMatchObject({
      source_id: 'src_birthday',
      filename: 'personal-note.txt',
    });
    expect(pack.relevantEvidence[0].excerpt).toContain('My birthday is tomorrow.');
  });

  it('returns provenance sources for selected graph statements', () => {
    const project = createGoldenDemoProject();
    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'How prominent should the interactive visual Clarity Graph be?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });

    expect(pack.provenanceSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: 'src_2',
          supports: expect.arrayContaining([
            expect.stringContaining('interactive visual Clarity Graph'),
          ]),
        }),
      ])
    );
  });

  it('uses newest PDF first when the query asks for the latest PDF', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_testpdf',
      filename: 'testpdf',
      type: 'pdf',
      content: 'Short upload placeholder.',
      extracted_at: '2026-08-11T22:00:00Z',
      derived_node_ids: ['node_testpdf_verify'],
      processing_status: 'completed',
      mime_type: 'application/pdf',
      storage_url: 'gs://gapwise-505217-context/users/demo-user/sources/src_testpdf/testpdf',
      extraction_summary: 'The user is trying to verify the Gapswise PDF upload feature.',
      processed_at: '2026-08-11T22:01:00Z',
    });

    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'What does my latest PDF say I am trying to verify?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });

    expect(pack.relevantEvidence[0]).toMatchObject({
      source_id: 'src_testpdf',
      filename: 'testpdf',
      derived_node_ids: ['node_testpdf_verify'],
    });
    expect(pack.relevantEvidence[0].excerpt).toContain('verify the Gapswise PDF upload feature');
    expect(pack.relevantEvidence.some((evidence) => evidence.source_id === 'src_1')).toBe(false);
  });

  it('preserves semantic ranking for non-temporal source queries', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_new_unrelated',
      filename: 'new-unrelated-note.txt',
      type: 'text',
      content: 'A very recent note about lunch and unrelated errands.',
      extracted_at: '2026-08-11T22:30:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });

    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'What are the hackathon requirements?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });

    expect(pack.relevantEvidence[0].source_id).toBe('src_1');
    expect(pack.relevantEvidence.some((evidence) => evidence.source_id === 'src_new_unrelated')).toBe(false);
  });

  it('excludes discarded context from reasoning while keeping it stored', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_discarded_note',
      filename: 'discarded-trip-note.txt',
      type: 'text',
      content: 'The trip budget is 5000 pesos.',
      extracted_at: '2026-08-12T22:00:00Z',
      derived_node_ids: ['node_discarded_budget'],
      processing_status: 'completed',
      discarded_at: '2026-08-13T10:00:00Z',
    });
    project.nodes.push({
      id: 'node_discarded_budget',
      type: 'UNKNOWN',
      text: 'What is the trip budget?',
      status: 'OPEN',
      confidence: 0.8,
      impact: 0.9,
      source_refs: ['src_discarded_note'],
      created_by: 'agent',
      created_at: '2026-08-12T22:00:00Z',
      updated_at: '2026-08-12T22:00:00Z',
    });

    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'What is the trip budget?',
      project,
      profile: DEFAULT_USER_PROFILE,
      includeBroadContext: true,
    });

    expect(project.sources.some((source) => source.id === 'src_discarded_note')).toBe(true);
    expect(pack.unresolvedGaps.some((node) => node.id === 'node_discarded_budget')).toBe(false);
    expect(pack.relevantEvidence.some((source) => source.source_id === 'src_discarded_note')).toBe(false);
    expect(pack.includedContextIds).not.toContain('src_discarded_note');
  });

  it('includes recent supplied context for broad Ask suggestions without changing normal retrieval', () => {
    const project = createGoldenDemoProject();
    project.sources = [
      {
        id: 'src_japanese_pink',
        filename: 'japanese pink things',
        type: 'text',
        content: 'I need to know if green things might be better than pink things, and i dont know what are pink things',
        extracted_at: '2026-08-12T21:09:25.466Z',
        derived_node_ids: ['node_japanese_pink_known'],
        processing_status: 'completed',
      },
    ];

    const normalPack = buildContextPack({
      userId: 'demo-user',
      query: 'What important questions should I consider next?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });
    const suggestionsPack = buildContextPack({
      userId: 'demo-user',
      query: 'What important questions should I consider next?',
      project,
      profile: DEFAULT_USER_PROFILE,
      includeBroadContext: true,
    });

    expect(normalPack.relevantEvidence).toHaveLength(0);
    expect(suggestionsPack.relevantEvidence[0]).toMatchObject({
      source_id: 'src_japanese_pink',
      filename: 'japanese pink things',
    });
    expect(suggestionsPack.relevantEvidence[0].excerpt).toContain('I need to know');
    expect(suggestionsPack.relevantEvidence[0].excerpt).toContain('green things');
  });

  it('builds graph context only when graph reasoning is requested', () => {
    const project = createGoldenDemoProject();

    const normalPack = buildContextPack({
      userId: 'demo-user',
      query: 'What is the most important consequence?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });
    const graphPack = buildContextPack({
      userId: 'demo-user',
      query: 'What is the most important consequence?',
      project,
      profile: DEFAULT_USER_PROFILE,
      graphReasoning: true,
    });

    expect(normalPack.graphContext).toBeUndefined();
    expect(graphPack.graphContext).toMatchObject({ projectGoal: project.goal });
    expect(graphPack.graphContext?.nodes.length).toBeLessThanOrEqual(16);
    expect(graphPack.projectReasoningContext).toMatchObject({ mode: 'reasoning' });
    expect(graphPack.projectReasoningContext?.seedNodes.length).toBeLessThanOrEqual(5);
  });

  it('does not promote transient statements to durable memory', () => {
    const decision = shouldPromoteToDurableMemory('Today I feel tired and distracted.');
    expect(decision.promote).toBe(false);
  });

  it('promotes explicit priorities to durable memory', () => {
    const memory = createDurableMemory('Financial stability is my top priority for the next 3 months.');
    expect(memory).toMatchObject({
      category: 'current_priorities',
      source: 'explicit',
    });
    expect(memory?.expires_at).toBeTruthy();
  });

  it('excludes forgotten memories from the next Context Pack', () => {
    const memory = createDurableMemory('Remember that concise answers are my preference.');
    expect(memory).toBeTruthy();
    const forgotten = forgetMemory([memory!], memory!.id);

    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'How should you answer me?',
      project: createGoldenDemoProject(),
      profile: DEFAULT_USER_PROFILE,
      durableMemories: forgotten,
    });

    expect(pack.userPreferences.some((item) => item.id === memory!.id)).toBe(false);
    expect(pack.includedContextIds).not.toContain(memory!.id);
  });

  it('adds connected Google Calendar events to upcoming commitments', async () => {
    const pack = await buildContextPackForUser(
      {
        userId: 'demo-user',
        query: 'What is coming up?',
        project: createGoldenDemoProject(),
        profile: DEFAULT_USER_PROFILE,
      },
      {
        now: new Date('2026-08-11T20:00:00Z'),
        listMemories: async () => [],
        hasCalendarTokens: async () => true,
        listCalendarEvents: async () => [
          {
            id: 'cal_event_1',
            summary: 'Calendar planning meeting',
            description: 'Discuss Gapswise Calendar integration.',
            start: '2026-08-12T10:00:00Z',
            end: '2026-08-12T10:30:00Z',
            location: 'Remote',
          },
        ],
      }
    );

    const commitment = pack.upcomingCommitments.find((node) => node.id === 'gcal_commitment_cal_event_1');
    expect(commitment).toMatchObject({
      type: 'NEXT_ACTION',
      status: 'OPEN',
      source_refs: ['gcal_cal_event_1'],
      created_by: 'agent',
    });
    expect(commitment?.text).toContain('Calendar planning meeting');
    expect(commitment?.text).toContain('Starts 2026-08-12T10:00:00Z');
    expect(commitment?.text).toContain('Remote');
    expect(commitment?.why_it_matters).toEqual(
      expect.arrayContaining(['Source: Google Calendar', 'Event ID: cal_event_1'])
    );
    expect(pack.includedContextIds).toContain('gcal_commitment_cal_event_1');
  });

  it('orders Calendar commitments soonest first and does not include birthday flooding', async () => {
    const pack = await buildContextPackForUser(
      {
        userId: 'demo-user',
        query: 'What is coming up?',
        project: createGoldenDemoProject(),
        profile: DEFAULT_USER_PROFILE,
      },
      {
        now: new Date('2026-08-11T20:00:00Z'),
        listMemories: async () => [],
        hasCalendarTokens: async () => true,
        listCalendarEvents: async () => [
          {
            id: 'soon',
            summary: 'Tomorrow planning',
            start: '2026-08-12T10:00:00Z',
            end: '2026-08-12T10:30:00Z',
          },
          {
            id: 'later',
            summary: 'Next week review',
            start: '2026-08-18T10:00:00Z',
            end: '2026-08-18T10:30:00Z',
          },
        ],
      }
    );

    const calendarCommitments = pack.upcomingCommitments.filter((node) => node.id.startsWith('gcal_commitment_'));
    expect(calendarCommitments.map((node) => node.id)).toEqual([
      'gcal_commitment_soon',
      'gcal_commitment_later',
    ]);
    expect(calendarCommitments.some((node) => /birthday/i.test(node.text))).toBe(false);
  });

  it('keeps only Calendar commitments relevant to a focused project', async () => {
    const project = createGoldenDemoProject();
    const pack = await buildContextPackForUser(
      {
        userId: 'demo-user',
        query: 'What is coming up?',
        project,
        profile: DEFAULT_USER_PROFILE,
        scope: { type: 'project', projectId: project.id },
      },
      {
        now: new Date('2026-08-11T20:00:00Z'),
        listMemories: async () => [],
        hasCalendarTokens: async () => true,
        listCalendarEvents: async () => [
          {
            id: 'gapswise_review',
            summary: 'Gapswise demo review',
            start: '2026-08-12T10:00:00Z',
            end: '2026-08-12T10:30:00Z',
          },
          {
            id: 'dentist',
            summary: 'Dentist appointment',
            start: '2026-08-12T12:00:00Z',
            end: '2026-08-12T13:00:00Z',
          },
        ],
      }
    );

    const calendarIds = pack.upcomingCommitments
      .filter((node) => node.id.startsWith('gcal_commitment_'))
      .map((node) => node.id);
    expect(calendarIds).toContain('gcal_commitment_gapswise_review');
    expect(calendarIds).not.toContain('gcal_commitment_dentist');
  });

  it('keeps Context Pack working when Calendar is disconnected', async () => {
    const pack = await buildContextPackForUser(
      {
        userId: 'demo-user',
        query: 'What is coming up?',
        project: createGoldenDemoProject(),
        profile: DEFAULT_USER_PROFILE,
      },
      {
        listMemories: async () => [],
        hasCalendarTokens: async () => false,
        listCalendarEvents: async () => {
          throw new Error('Should not fetch disconnected Calendar');
        },
      }
    );

    expect(pack.upcomingCommitments.some((node) => node.id.startsWith('gcal_commitment_'))).toBe(false);
    expect(pack.activeGoals.length).toBeGreaterThan(0);
  });

  it('degrades gracefully when Calendar token refresh or retrieval fails', async () => {
    const pack = await buildContextPackForUser(
      {
        userId: 'demo-user',
        query: 'What is coming up?',
        project: createGoldenDemoProject(),
        profile: DEFAULT_USER_PROFILE,
      },
      {
        listMemories: async () => [],
        hasCalendarTokens: async () => true,
        listCalendarEvents: async () => {
          throw new Error('Refresh failed');
        },
      }
    );

    expect(pack.upcomingCommitments.some((node) => node.id.startsWith('gcal_commitment_'))).toBe(false);
    expect(pack.unresolvedGaps.length).toBeGreaterThan(0);
  });

  it('includes ongoing and future Calendar events but excludes ended events before mapping commitments', () => {
    const nodes = calendarEventsToCommitmentNodes(
      [
        {
          id: 'ongoing_event',
          summary: 'Ongoing event',
          start: '2026-08-11T19:30:00Z',
          end: '2026-08-11T20:30:00Z',
        },
        {
          id: 'ended_event',
          summary: 'Ended event',
          start: '2026-08-11T19:00:00Z',
          end: '2026-08-11T19:50:00Z',
        },
        {
          id: 'future_event',
          summary: 'Future event',
          start: '2026-08-12T10:00:00Z',
          end: '2026-08-12T10:30:00Z',
        },
      ],
      new Date('2026-08-11T20:00:00Z')
    );

    expect(nodes.map((node) => node.id)).toEqual([
      'gcal_commitment_ongoing_event',
      'gcal_commitment_future_event',
    ]);
  });
});
