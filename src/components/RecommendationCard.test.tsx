import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecommendationCard, SNOOZE_OPTIONS } from '@/components/RecommendationCard';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { buildTodayFeed } from '@/lib/today/feed';
import type { AttentionCandidate } from '@/types/attention';

describe('RecommendationCard reminders', () => {
  it('exposes the requested snooze choices', () => {
    expect(SNOOZE_OPTIONS.map((option) => option.label)).toEqual([
      '15 min',
      '30 min',
      '1 hour',
      'Until 10 min before',
    ]);
  });

  it('renders a scannable timing hierarchy and compact actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T20:00:00.000Z'));
    try {
      const project = createGoldenDemoProject();
      const contextPack = buildContextPack({
        userId: 'demo-user',
        query: 'What needs my attention today?',
        project,
        profile: DEFAULT_USER_PROFILE,
        calendarCommitments: calendarEventsToCommitmentNodes([
          {
            id: 'career_prep',
            summary: 'Career decision prep with Alex',
            start: '2026-08-16T21:30:00.000Z',
            end: '2026-08-16T22:00:00.000Z',
          },
        ], new Date('2026-08-16T20:00:00.000Z')),
      });
      const recommendation: AttentionCandidate = {
        id: 'rec_calendar_gcal_commitment_career_prep',
        kind: 'commitment',
        title: 'Prepare for Career decision prep with Alex',
        reason: 'From Google Calendar.',
        next_action: 'Review what you need before Career decision prep with Alex.',
        source_node_ids: ['gcal_commitment_career_prep'],
        source_ids: ['gcal_career_prep'],
        context_pack: contextPack,
        factors: {
          goal_alignment: 0.8,
          impact: 0.8,
          urgency: 0.9,
          actionability: 0.9,
          evidence_confidence: 0.95,
          unresolved_risk: 0.3,
          momentum: 0.8,
          estimated_effort: 0.1,
        },
        score: 0.8,
        status: 'active',
      };
      const item = buildTodayFeed([recommendation], [], project)[0];
      const html = renderToStaticMarkup(
        <RecommendationCard
          {...item}
          onOpenWhy={vi.fn()}
          onFeedback={vi.fn()}
          onSnooze={vi.fn()}
        />
      );

      expect(item).toMatchObject({
        itemType: 'REMINDER',
        title: 'Career decision prep with Alex',
        calendarStart: '2026-08-16T21:30:00.000Z',
        calendarEnd: '2026-08-16T22:00:00.000Z',
        calendarSource: 'Google Calendar',
        calendarCommitmentId: 'gcal_commitment_career_prep',
      });
      expect(html).toContain('In 1h 30m');
      expect(html).toContain('Today ·');
      expect(html).toContain('Google Calendar');
      expect(html).toContain('Done');
      expect(html).toContain('Snooze');
      expect(html).toContain('aria-haspopup="menu"');
      expect(html).not.toContain('Not now');
      expect(html).not.toContain('Source: Google Calendar');
      expect(html).not.toContain('2026-08-16T21:30:00.000Z');
      expect(html).toContain('w-full max-w-[420px]');
      expect(html.indexOf('REMINDER')).toBeLessThan(html.indexOf('In 1h 30m'));
      expect(html.indexOf('In 1h 30m')).toBeLessThan(html.indexOf('Career decision prep with Alex'));
      expect(html.indexOf('Done')).toBeLessThan(html.indexOf('Snooze'));
      expect(html).not.toContain('justify-between');
    } finally {
      vi.useRealTimers();
    }
  });
});
