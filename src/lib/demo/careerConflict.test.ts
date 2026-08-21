import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CAREER_CONFLICT_JOB_SOURCE_ID,
  CAREER_CONFLICT_QUESTION_ID,
  answerCareerConflictDemo,
  createCareerConflictDemoState,
  detectCareerConflict,
  readCareerConflictJobDocument,
  careerRoleDisposition,
} from '@/lib/demo/careerConflict';
import { generateDailyBrief, clearBriefStoreForTests } from '@/lib/attention/generateBrief';
import { MockStorageProvider } from '@/lib/storage/mock';
import { buildNeedsAttention } from '@/lib/projects/projectOverview';
import { demoCareerConflictCalendarEvents } from '@/lib/demo/localFixtures';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';

const tempDirs: string[] = [];
const originalDemoMode = process.env.GAPSWISE_DEMO_MODE;

afterEach(async () => {
  if (originalDemoMode === undefined) delete process.env.GAPSWISE_DEMO_MODE;
  else process.env.GAPSWISE_DEMO_MODE = originalDemoMode;
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('career conflict demo workflow', () => {
  beforeEach(() => clearBriefStoreForTests());

  it('seeds a detailed career dossier with connected context, decisions, risks, and unresolved questions', () => {
    const state = createCareerConflictDemoState();
    const question = state.project.nodes.find((node) => node.id === CAREER_CONFLICT_QUESTION_ID);

    expect(state.memories.map((memory) => memory.text)).toEqual(expect.arrayContaining([
      'Financial stability is my top priority.',
      'I prefer to avoid frontend-heavy roles.',
      'I want meaningful backend or applied AI ownership in my next role.',
    ]));
    expect(state.project.sources.length).toBeGreaterThanOrEqual(10);
    expect(state.project.nodes.length).toBeGreaterThanOrEqual(30);
    expect(state.project.edges.length).toBeGreaterThanOrEqual(25);
    expect(state.project.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN')).toHaveLength(7);
    expect(state.project.nodes.filter((node) => node.type === 'DECISION')).toHaveLength(3);
    expect(state.project.nodes.filter((node) => node.type === 'RISK')).toHaveLength(2);
    expect(state.project.sources.find((source) => source.id === CAREER_CONFLICT_JOB_SOURCE_ID)?.content).toMatch(/primarily frontend/i);
    expect(state.project.nodes.some((node) => node.text.includes('upcoming recruiter call'))).toBe(true);
    expect(question).toMatchObject({ type: 'UNKNOWN', status: 'OPEN' });
    expect(state.project.active_question?.node_id).toBe(CAREER_CONFLICT_QUESTION_ID);
    expect(state.project.active_question?.guidance).toMatchObject({
      generatedBy: 'deterministic',
      focus: 'Decide whether the Northstar Product Engineer role is worth pursuing.',
      nextStep: expect.stringMatching(/frontend-heavy period.*recruiter call/i),
      whatCouldChange: expect.stringMatching(/Northstar interview loop/i),
    });
    expect(detectCareerConflict(readCareerConflictJobDocument(), state.memories)).toBe(true);
  });

  it('includes a Google Meet soon enough to become an actionable briefing item in any app mode', async () => {
    process.env.GAPSWISE_DEMO_MODE = 'false';
    const now = new Date('2026-08-16T12:00:00.000Z');
    const events = demoCareerConflictCalendarEvents(now);
    const state = createCareerConflictDemoState();
    const hasCalendarTokens = vi.fn(async () => true);
    const listCalendarEvents = vi.fn(async () => []);
    const contextPack = await buildContextPackForUser({
      userId: 'demo-user',
      query: 'What needs my attention today?',
      project: state.project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: state.memories,
    }, {
      now,
      hasCalendarTokens,
      listCalendarEvents,
    });
    const brief = generateDailyBrief({
      userId: 'demo-user',
      project: state.project,
      memories: state.memories,
      contextPack,
      period: '2026-08-16',
      force: true,
      now,
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: 'demo_career_coach_prep',
      summary: 'Career decision prep with Alex',
      location: 'Google Meet',
    });
    expect(new Date(events[0].start!).getTime() - now.getTime()).toBe(90 * 60 * 1000);
    expect(new Date(events[1].start!).getTime() - now.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(hasCalendarTokens).not.toHaveBeenCalled();
    expect(listCalendarEvents).not.toHaveBeenCalled();
    expect(brief.recommendations.some((recommendation) =>
      recommendation.id === 'rec_calendar_gcal_commitment_demo_career_coach_prep'
    )).toBe(true);
    expect(brief.recommendations.filter((recommendation) => recommendation.id.startsWith('rec_calendar_gcal_commitment_demo_career_'))).toHaveLength(2);
  });

  it('asks the role-fit question before recommending a recruiter action', () => {
    const state = createCareerConflictDemoState();
    const brief = generateDailyBrief({
      userId: 'demo-user',
      project: state.project,
      memories: state.memories,
      period: '2026-08-16',
      force: true,
    });

    expect(brief.recommendations[0]).toMatchObject({
      id: `rec_gap_${CAREER_CONFLICT_QUESTION_ID}`,
      title: 'Decide whether the frontend-heavy role fits your priorities',
    });
  });

  it('summarizes the blocker while keeping the review action tied to the question node', () => {
    expect(buildNeedsAttention(createCareerConflictDemoState().project)).toEqual({
      nodeId: CAREER_CONFLICT_QUESTION_ID,
      title: "The frontend-heavy role's fit with your priorities is still unresolved.",
      detail: 'This is currently blocking the decision about the recruiter call.',
    });
  });

  it('persists an affirmative answer as feedback and changes the next recommendation', () => {
    const initial = createCareerConflictDemoState();
    const answered = answerCareerConflictDemo(initial, 'Yes, the role remains acceptable because financial stability matters most.');
    const brief = generateDailyBrief({
      userId: 'demo-user',
      project: answered.project,
      memories: answered.memories,
      period: '2026-08-16',
      force: true,
    });

    expect(answered.project.nodes.find((node) => node.id === CAREER_CONFLICT_QUESTION_ID)?.status).toBe('RESOLVED');
    expect(answered.feedbackEvents[0]).toMatchObject({
      targetId: CAREER_CONFLICT_QUESTION_ID,
      explanation: expect.stringContaining('remains acceptable'),
      metadata: { role_acceptable: true },
    });
    expect(answered.memories.find((memory) => memory.id === 'career_demo_answer_acceptable')?.text).toContain('willing to consider');
    expect(brief.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_src_career_recruiter_call')).toBe(true);
    expect(brief.recommendations.some((recommendation) => recommendation.id === `rec_gap_${CAREER_CONFLICT_QUESTION_ID}`)).toBe(false);
  });

  it('turns a negative answer into a decline recommendation', () => {
    const answered = answerCareerConflictDemo(createCareerConflictDemoState(), 'No, this role is not acceptable.');
    const brief = generateDailyBrief({
      userId: 'demo-user',
      project: answered.project,
      memories: answered.memories,
      period: '2026-08-16',
      force: true,
    });

    expect(careerRoleDisposition('No, this role is not acceptable.')).toBe('not_acceptable');
    expect(answered.memories.find((memory) => memory.id === 'career_demo_answer_not_acceptable')).toBeTruthy();
    expect(brief.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_decline_src_career_recruiter_call')).toBe(true);
    expect(brief.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_src_career_recruiter_call')).toBe(false);
  });

  it('recreates the exact initial dataset for a repeatable reset', () => {
    expect(JSON.stringify(createCareerConflictDemoState())).toBe(JSON.stringify(createCareerConflictDemoState()));
  });

  it('keeps the changed answer and recommendation after reloading persistent demo storage', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gapwise-career-demo-'));
    tempDirs.push(directory);
    const storage = new MockStorageProvider(path.join(directory, 'career-demo.json'));
    const initial = createCareerConflictDemoState();
    await storage.saveProject('demo-user', initial.project);
    await storage.replaceMemories('demo-user', initial.memories);

    const answered = answerCareerConflictDemo(initial, 'Yes, I will consider it for financial stability.');
    await storage.saveProject('demo-user', answered.project);
    await storage.replaceMemories('demo-user', answered.memories);

    const restarted = new MockStorageProvider(path.join(directory, 'career-demo.json'));
    const persistedProject = await restarted.getProject('demo-user', initial.project.id);
    const persistedMemories = await restarted.getMemories('demo-user');
    const nextBrief = generateDailyBrief({
      userId: 'demo-user',
      project: persistedProject!,
      memories: persistedMemories,
      period: '2026-08-16',
      force: true,
    });

    expect(persistedProject?.nodes.find((node) => node.id === CAREER_CONFLICT_QUESTION_ID)?.status).toBe('RESOLVED');
    expect(persistedMemories.some((memory) => memory.id === 'career_demo_answer_acceptable')).toBe(true);
    expect(nextBrief.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_src_career_recruiter_call')).toBe(true);
  });
});
