import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { createDurableMemory, shouldPromoteToDurableMemory } from '@/lib/memory/policy';
import { forgetMemory } from '@/lib/memory/store';

describe('Context Pack retrieval and durable memory policy', () => {
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
