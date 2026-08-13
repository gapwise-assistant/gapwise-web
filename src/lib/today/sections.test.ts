import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { buildComingUp, buildTodayQuestions } from '@/lib/today/sections';
import { AttentionCandidate, DailyBrief } from '@/types/attention';
import { ContextPack } from '@/types/contextPack';

function briefWithContextPack(contextPack: ContextPack): DailyBrief {
  const recommendation: AttentionCandidate = {
    id: 'rec_test',
    kind: 'gap',
    title: 'Test recommendation',
    reason: 'Test reason',
    next_action: 'Test action',
    source_node_ids: [],
    source_ids: [],
    context_pack: contextPack,
    factors: {
      goal_alignment: 1,
      impact: 1,
      urgency: 1,
      actionability: 1,
      evidence_confidence: 1,
      unresolved_risk: 0,
      momentum: 1,
      estimated_effort: 0,
    },
    score: 0.9,
    status: 'active',
  };
  return {
    id: 'brief_test',
    userId: 'demo-user',
    period: '2026-08-11',
    generated_at: '2026-08-11T20:00:00Z',
    recommendations: [recommendation],
  };
}

describe('Today sections', () => {
  it('surfaces at most three deterministic questions with provenance', () => {
    const project = createGoldenDemoProject();
    project.nodes.push({
      id: 'unknown_extra',
      type: 'UNKNOWN',
      text: 'What extra thing is still unclear?',
      status: 'OPEN',
      confidence: 0.3,
      impact: 0.7,
      source_refs: ['src_2'],
      created_by: 'agent',
      created_at: '2026-08-11T10:00:00Z',
      updated_at: '2026-08-11T10:00:00Z',
    });
    const contextPack = buildContextPack({
      userId: 'demo-user',
      query: 'What should I answer?',
      project,
      profile: DEFAULT_USER_PROFILE,
    });

    const questions = buildTodayQuestions({
      project,
      brief: briefWithContextPack(contextPack),
      now: new Date('2026-08-11T20:00:00Z'),
    });

    expect(questions.length).toBeLessThanOrEqual(3);
    expect(questions[0].question).toContain('primary target persona');
    expect(questions[0].provenance).toMatch(/src_|Graph node/);
  });

  it('adds a Calendar preparation question from Context Pack commitments', () => {
    const project = createGoldenDemoProject();
    const now = new Date('2026-08-11T20:00:00Z');
    const contextPack = buildContextPack({
      userId: 'demo-user',
      query: 'What is coming up?',
      project,
      profile: DEFAULT_USER_PROFILE,
      limits: { unresolvedGaps: 0, contradictions: 0 },
      calendarCommitments: calendarEventsToCommitmentNodes([
        {
          id: 'cal_presentation',
          summary: 'Tomorrow presentation',
          start: '2026-08-12T10:00:00Z',
          end: '2026-08-12T10:30:00Z',
        },
      ], now),
    });

    const questions = buildTodayQuestions({
      project,
      brief: briefWithContextPack(contextPack),
      now,
    });

    expect(questions).toEqual([
      expect.objectContaining({
        question: 'Are you prepared for Tomorrow presentation?',
        provenance: expect.stringContaining('Source: Google Calendar'),
      }),
    ]);
  });

  it('builds a compact Coming up list from Calendar Context Pack commitments', () => {
    const project = createGoldenDemoProject();
    const now = new Date('2026-08-11T20:00:00Z');
    const contextPack = buildContextPack({
      userId: 'demo-user',
      query: 'What is coming up?',
      project,
      profile: DEFAULT_USER_PROFILE,
      calendarCommitments: calendarEventsToCommitmentNodes([
        {
          id: 'cal_soon',
          summary: 'Gapswise calendar test',
          start: '2026-08-11T21:00:00Z',
          end: '2026-08-11T21:30:00Z',
        },
        {
          id: 'cal_ended',
          summary: 'Ended event',
          start: '2026-08-11T18:00:00Z',
          end: '2026-08-11T19:00:00Z',
        },
      ], now),
    });

    const comingUp = buildComingUp(briefWithContextPack(contextPack), now);

    expect(comingUp).toEqual([
      expect.objectContaining({
        title: 'Gapswise calendar test',
        provenance: 'Source: Google Calendar',
      }),
    ]);
  });
});
