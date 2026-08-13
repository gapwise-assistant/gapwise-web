import { describe, expect, it, beforeEach } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { generateDailyBrief, clearBriefStoreForTests, updateRecommendationStatus } from '@/lib/attention/generateBrief';
import { createDurableMemory } from '@/lib/memory/policy';
import { Project } from '@/types/clarity';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { SafeCalendarEvent } from '@/types/google';

function incomeMemory() {
  return createDurableMemory('Financial stability is my top priority for the next 3 months.')!;
}

function addSource(project: Project, id: string, filename: string, content: string) {
  project.sources.push({
    id,
    filename,
    type: 'text',
    content,
    extracted_at: '2026-08-10T12:00:00Z',
    derived_node_ids: [],
    processing_status: 'completed',
  });
}

function contextPackWithCalendar(project: Project, events: SafeCalendarEvent[], now: Date) {
  return buildContextPack({
    userId: 'demo-user',
    query: 'What needs my attention today?',
    project,
    profile: {
      answer_density: 'concise',
      question_frequency: 'moderate',
      challenge_level: 'high',
      evidence_preference: 'research_first',
      brainstorm_style: 'diverge_then_converge',
      uncertainty_style: 'explicit',
    },
    calendarCommitments: calendarEventsToCommitmentNodes(events, now, 10),
  });
}

describe('Attention Engine and Daily Brief', () => {
  beforeEach(() => clearBriefStoreForTests());

  it('ranks recruiter opportunity highly when income is a confirmed priority', () => {
    const project = createGoldenDemoProject();
    addSource(project, 'src_recruiter', 'recruiter-email.txt', 'Recruiter asked about a better-paying AI role with strong salary upside.');

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [incomeMemory()],
      period: '2026-08-10',
    });

    expect(brief.recommendations[0].id).toBe('rec_recruiter_src_recruiter');
  });

  it('does not recommend a frontend recruiter role when memory says to avoid frontend work', () => {
    const project = createGoldenDemoProject();
    addSource(project, 'src_frontend', 'frontend-recruiter.txt', 'Recruiter sent a frontend role with better pay.');
    const avoidFrontend = createDurableMemory('Remember that I prefer to avoid frontend roles for now.')!;

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [incomeMemory(), avoidFrontend],
      period: '2026-08-10',
    });

    expect(brief.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_src_frontend')).toBe(false);
  });

  it('ranks urgent meeting preparation with unresolved related gap highly', () => {
    const project = createGoldenDemoProject();
    addSource(project, 'src_meeting', 'calendar-note.txt', 'Demo meeting tomorrow requires target persona and scenario preparation.');

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-10',
    });

    expect(brief.recommendations[0].kind).toBe('preparation');
  });

  it('keeps low-urgency learning ideas from crowding out urgent goal-aligned work', () => {
    const project = createGoldenDemoProject();
    addSource(project, 'src_learning', 'learning-idea.txt', 'Someday learn a low urgency visualization library with no current deadline.');
    addSource(project, 'src_meeting', 'calendar-note.txt', 'Demo meeting tomorrow requires target persona and scenario preparation.');

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-10',
    });

    expect(brief.recommendations[0].kind).toBe('preparation');
    expect(brief.recommendations.length).toBeLessThanOrEqual(5);
  });

  it('suppresses recommendations marked already done', () => {
    const project = createGoldenDemoProject();
    addSource(project, 'src_recruiter', 'recruiter-email.txt', 'Recruiter asked about a better-paying AI role with strong salary upside.');
    updateRecommendationStatus('rec_recruiter_src_recruiter', 'done');

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [incomeMemory()],
      period: '2026-08-10',
      force: true,
    });

    expect(brief.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_src_recruiter')).toBe(false);
  });

  it('is idempotent for the same user and period unless forced', () => {
    const project = createGoldenDemoProject();
    const first = generateDailyBrief({ userId: 'demo-user', project, memories: [], period: '2026-08-10' });
    const second = generateDailyBrief({ userId: 'demo-user', project, memories: [], period: '2026-08-10' });
    const forced = generateDailyBrief({ userId: 'demo-user', project, memories: [], period: '2026-08-10', force: true });

    expect(second).toBe(first);
    expect(forced.id).toBe(first.id);
  });

  it('ranks an important Calendar meeting in 60 minutes highly', () => {
    const project = createGoldenDemoProject();
    const now = new Date('2026-08-11T20:00:00Z');
    const contextPack = contextPackWithCalendar(project, [
      {
        id: 'cal_soon',
        summary: 'Gapswise demo meeting',
        start: '2026-08-11T21:00:00Z',
        end: '2026-08-11T21:30:00Z',
      },
    ], now);

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-11',
      force: true,
      contextPack,
      now,
    });

    expect(brief.recommendations[0].id).toBe('rec_calendar_gcal_commitment_cal_soon');
    expect(brief.recommendations[0].score).toBeGreaterThan(0.75);
    expect(brief.recommendations).toHaveLength(5);
  });

  it('includes a Calendar meeting tomorrow with lower urgency than a meeting in 60 minutes', () => {
    const project = createGoldenDemoProject();
    const now = new Date('2026-08-11T20:00:00Z');
    const contextPack = contextPackWithCalendar(project, [
      {
        id: 'cal_soon',
        summary: 'Gapswise demo meeting',
        start: '2026-08-11T21:00:00Z',
        end: '2026-08-11T21:30:00Z',
      },
      {
        id: 'cal_tomorrow',
        summary: 'Planning meeting tomorrow',
        start: '2026-08-12T20:00:00Z',
        end: '2026-08-12T20:30:00Z',
      },
    ], now);

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-11',
      force: true,
      contextPack,
      now,
    });
    const soon = brief.recommendations.find((recommendation) => recommendation.id === 'rec_calendar_gcal_commitment_cal_soon');
    const tomorrow = brief.recommendations.find((recommendation) => recommendation.id === 'rec_calendar_gcal_commitment_cal_tomorrow');

    expect(tomorrow).toBeTruthy();
    expect(tomorrow!.factors.urgency).toBeLessThan(soon!.factors.urgency);
  });

  it('does not let an unrelated Calendar event 20 days away crowd out important gaps', () => {
    const project = createGoldenDemoProject();
    const now = new Date('2026-08-11T20:00:00Z');
    const contextPack = contextPackWithCalendar(project, [
      {
        id: 'cal_far',
        summary: 'Unrelated lunch',
        start: '2026-08-31T20:00:00Z',
        end: '2026-08-31T21:00:00Z',
      },
    ], now);

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-11',
      force: true,
      contextPack,
      now,
    });

    expect(brief.recommendations.some((recommendation) => recommendation.id === 'rec_calendar_gcal_commitment_cal_far')).toBe(false);
    expect(brief.recommendations.some((recommendation) => recommendation.kind === 'gap')).toBe(true);
  });

  it('still generates a brief when Calendar commitments are unavailable', () => {
    const project = createGoldenDemoProject();

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-11',
      force: true,
    });

    expect(brief.recommendations.length).toBeGreaterThan(0);
    expect(brief.recommendations.some((recommendation) => recommendation.id.startsWith('rec_calendar_'))).toBe(false);
  });

  it('preserves Google Calendar provenance for the Why drawer evidence', () => {
    const project = createGoldenDemoProject();
    const now = new Date('2026-08-11T20:00:00Z');
    const contextPack = contextPackWithCalendar(project, [
      {
        id: 'cal_source',
        summary: 'Gapswise calendar source test',
        start: '2026-08-11T21:00:00Z',
        end: '2026-08-11T21:30:00Z',
      },
    ], now);

    const brief = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [],
      period: '2026-08-11',
      force: true,
      contextPack,
      now,
    });
    const calendarRecommendation = brief.recommendations.find((recommendation) => recommendation.id === 'rec_calendar_gcal_commitment_cal_source');

    expect(calendarRecommendation?.source_ids).toEqual(['gcal_cal_source']);
    expect(calendarRecommendation?.context_pack.upcomingCommitments[0].why_it_matters).toContain('Source: Google Calendar');
    expect(calendarRecommendation?.context_pack.upcomingCommitments[0].text).toContain('Gapswise calendar source test');
  });
});
