import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('career conflict demo workflow', () => {
  beforeEach(() => clearBriefStoreForTests());

  it('seeds a readable job document, user goal/preference, recruiter call, and unresolved conflict question', () => {
    const state = createCareerConflictDemoState();
    const question = state.project.nodes.find((node) => node.id === CAREER_CONFLICT_QUESTION_ID);

    expect(state.memories.map((memory) => memory.text)).toEqual([
      'Financial stability is my top priority.',
      'I prefer to avoid frontend-heavy roles.',
    ]);
    expect(state.project.sources.find((source) => source.id === CAREER_CONFLICT_JOB_SOURCE_ID)?.content).toMatch(/primarily frontend/i);
    expect(state.project.nodes.some((node) => node.text.includes('upcoming recruiter call'))).toBe(true);
    expect(question).toMatchObject({ type: 'UNKNOWN', status: 'OPEN' });
    expect(detectCareerConflict(readCareerConflictJobDocument(), state.memories)).toBe(true);
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
