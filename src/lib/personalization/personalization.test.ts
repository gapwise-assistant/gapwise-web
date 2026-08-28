import { describe, expect, it, beforeEach } from 'vitest';
import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { generateDailyBrief, clearBriefStoreForTests } from '@/lib/attention/generateBrief';
import { createDurableMemory } from '@/lib/memory/policy';
import { applyCorrectionToMemories, createFeedbackEvent } from '@/lib/personalization/applyFeedback';
import { runPartnerAgent } from '@/lib/agents/partnerAgent';
import { buildPromptProfile } from '@/lib/personalization/promptProfile';
import { AttentionAgentOutput, GapAgentOutput } from '@/lib/agents/schemas';

describe('feedback-driven personalization', () => {
  beforeEach(() => clearBriefStoreForTests());

  it('builds different prompt behavior from saved preferences and excludes forgotten memories', () => {
    const memory = createDurableMemory('Remember that I prefer decisions supported by measurements.')!;
    const forgottenMemory = createDurableMemory('Remember that I keep archived project notes.')!;
    const forgotten = { ...forgottenMemory, status: 'forgotten' as const, forgotten_at: '2026-08-10T12:00:00Z' };
    const concise = buildPromptProfile(DEFAULT_USER_PROFILE, [memory, forgotten]);
    const detailed = buildPromptProfile({
      ...DEFAULT_USER_PROFILE,
      answer_density: 'detailed',
      question_frequency: 'high',
      challenge_level: 'low',
      evidence_preference: 'strict_data',
    }, [memory, forgotten]);

    expect(concise.memoryReasons).toEqual([expect.objectContaining({ id: memory.id })]);
    expect(concise.memoryReasons).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: forgotten.id })]));
    expect(detailed.answerDensity).not.toBe(concise.answerDensity);
    expect(detailed.questionPriorityThreshold).not.toBe(concise.questionPriorityThreshold);
    expect(detailed.challengeInstruction).not.toBe(concise.challengeInstruction);
    expect(detailed.citationLimit).not.toBe(concise.citationLimit);
  });

  it('priority change from startup growth to financial stability reranks Today', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_recruiter',
      filename: 'recruiter-email.txt',
      type: 'text',
      content: 'Recruiter asked about a better-paying AI role with stronger compensation.',
      extracted_at: '2026-08-10T12:00:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });

    const before = generateDailyBrief({ userId: 'demo-user', project, memories: [], period: '2026-08-10', force: true });
    const memories = applyCorrectionToMemories({
      memories: [],
      explanation: 'Financial stability is my top priority for the next 3 months.',
    });
    const after = generateDailyBrief({ userId: 'demo-user', project, memories, period: '2026-08-10', force: true });

    expect(before.recommendations[0].id).not.toBe('rec_recruiter_src_recruiter');
    expect(after.recommendations[0].id).toBe('rec_recruiter_src_recruiter');
  });

  it('frontend role preference correction persists and suppresses future frontend recommendations', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_frontend',
      filename: 'frontend-recruiter.txt',
      type: 'text',
      content: 'Recruiter sent a frontend role with better pay.',
      extracted_at: '2026-08-10T12:00:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });
    const memories = applyCorrectionToMemories({
      memories: [createDurableMemory('Financial stability is my top priority for the next 3 months.')!],
      explanation: 'I do not want frontend jobs.',
    });

    const brief = generateDailyBrief({ userId: 'demo-user', project, memories, period: '2026-08-10', force: true });

    expect(brief.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_src_frontend')).toBe(false);
  });

  it('not now suppresses an item temporarily and then expires', () => {
    const project = createGoldenDemoProject();
    project.sources.push({
      id: 'src_recruiter',
      filename: 'recruiter-email.txt',
      type: 'text',
      content: 'Recruiter asked about a better-paying AI role with stronger compensation.',
      extracted_at: '2026-08-10T12:00:00Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });
    const feedback = createFeedbackEvent({
      userId: 'demo-user',
      targetType: 'recommendation',
      targetId: 'rec_recruiter_src_recruiter',
      rating: 'not_now',
      suppressDays: 3,
    });
    const activeSuppression = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [createDurableMemory('Financial stability is my top priority for the next 3 months.')!],
      feedbackEvents: [feedback],
      period: '2026-08-10',
      force: true,
    });
    const expiredSuppression = generateDailyBrief({
      userId: 'demo-user',
      project,
      memories: [createDurableMemory('Financial stability is my top priority for the next 3 months.')!],
      feedbackEvents: [{ ...feedback, suppress_until: '2020-01-01T00:00:00Z' }],
      period: '2026-08-10',
      force: true,
    });

    expect(activeSuppression.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_src_recruiter')).toBe(false);
    expect(expiredSuppression.recommendations.some((recommendation) => recommendation.id === 'rec_recruiter_src_recruiter')).toBe(true);
  });

  it('supports minute-level snooze suppression for reminder actions', () => {
    const before = Date.now();
    const feedback = createFeedbackEvent({
      userId: 'demo-user',
      targetType: 'recommendation',
      targetId: 'rec_calendar_demo',
      rating: 'not_now',
      suppressMinutes: 15,
    });
    const after = Date.now();
    const suppressUntil = new Date(feedback.suppress_until!).getTime();

    expect(suppressUntil).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
    expect(suppressUntil).toBeLessThanOrEqual(after + 15 * 60 * 1000);
  });

  it('question frequency threshold changes Partner Agent behavior', () => {
    const gapOutput: GapAgentOutput = {
      selectedGapNodeId: 'gap_low',
      question: 'Should I ask a medium-priority question?',
      priority: 0.62,
      retrievalAnswered: false,
      reasons: ['Medium priority'],
    };
    const attentionOutput: AttentionAgentOutput = {
      recommendations: [
        {
          id: 'rec_1',
          title: 'Do the action instead',
          rationale: 'Lower interruption profile',
          score: 0.6,
          sourceNodeIds: ['gap_low'],
          nextAction: 'Continue without interrupting.',
        },
      ],
    };

    const moderate = runPartnerAgent(createGoldenDemoProject(), DEFAULT_USER_PROFILE, gapOutput, attentionOutput);
    const low = runPartnerAgent(
      createGoldenDemoProject(),
      { ...DEFAULT_USER_PROFILE, question_frequency: 'low' },
      gapOutput,
      attentionOutput
    );

    expect(moderate.mode).toBe('ask_question');
    expect(low.mode).toBe('recommend_action');
  });
});
