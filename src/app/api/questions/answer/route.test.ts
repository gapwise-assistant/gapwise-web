import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { answerQuestion, editAnsweredQuestion, reopenAnsweredQuestion } from '@/lib/questions/answerQuestion';
import { PATCH, POST } from './route';
import { saveFeedback } from '@/lib/tools/feedbackTools';

vi.mock('@/lib/questions/answerQuestion', () => ({ answerQuestion: vi.fn(), editAnsweredQuestion: vi.fn(), reopenAnsweredQuestion: vi.fn() }));
vi.mock('@/lib/tools/feedbackTools', () => ({ saveFeedback: vi.fn() }));

function request(body: unknown): Request {
  return new Request('http://localhost/api/questions/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/questions/answer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the updated user-scoped context', async () => {
    const context = createGoldenDemoProject();
    vi.mocked(answerQuestion).mockResolvedValue({
      ownerType: 'project',
      projectId: context.id,
      context,
      resolvedNodeId: 'unknown_target_user',
      createdNodeId: 'node_answer',
    });

    const response = await POST(request({
      userId: 'demo-user',
      nodeId: 'unknown_target_user',
      projectId: context.id,
      answer: 'The demo is for independent hackathon builders.',
    }));

    expect(response.status).toBe(200);
    expect(answerQuestion).toHaveBeenCalledWith(expect.objectContaining({ userId: 'demo-user' }));
    await expect(response.json()).resolves.toMatchObject({
      message: 'Understanding updated. This question is now resolved.',
      resolvedNodeId: 'unknown_target_user',
    });
  });

  it('rejects empty answers before touching storage', async () => {
    const response = await POST(request({ userId: 'demo-user', nodeId: 'unknown_target_user', answer: ' ' }));
    expect(response.status).toBe(400);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('updates an existing answered question through PATCH', async () => {
    const context = createGoldenDemoProject();
    vi.mocked(editAnsweredQuestion).mockResolvedValue({
      ownerType: 'project',
      projectId: context.id,
      context,
      historyTimestamp: '2026-08-11T10:00:00.000Z',
    });

    const response = await PATCH(request({
      userId: 'demo-user',
      projectId: context.id,
      historyTimestamp: '2026-08-11T10:00:00.000Z',
      question: 'What is the primary user?',
      previousAnswer: 'Independent builders.',
      answer: 'Technical founders.',
    }));

    expect(response.status).toBe(200);
    expect(editAnsweredQuestion).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user',
      answer: 'Technical founders.',
    }));
    await expect(response.json()).resolves.toMatchObject({
      message: 'Answer updated. Gapwise understanding was refreshed.',
    });
  });

  it('reopens a resolved question through PATCH', async () => {
    const context = createGoldenDemoProject();
    vi.mocked(reopenAnsweredQuestion).mockResolvedValue({
      ownerType: 'project',
      projectId: context.id,
      context,
      historyTimestamp: '2026-08-11T10:00:00.000Z',
    });

    const response = await PATCH(new Request('http://localhost/api/questions/answer', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'reopen',
        userId: 'demo-user',
        projectId: context.id,
        historyTimestamp: '2026-08-11T10:00:00.000Z',
        question: 'What is the primary user?',
        previousAnswer: 'Independent builders.',
      }),
    }));

    expect(response.status).toBe(200);
    expect(reopenAnsweredQuestion).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user',
      previousAnswer: 'Independent builders.',
    }));
    await expect(response.json()).resolves.toMatchObject({
      message: 'Response cancelled. The question is open again.',
    });
  });

  it('persists an answer as question feedback when requested by the demo flow', async () => {
    const context = createGoldenDemoProject();
    vi.mocked(answerQuestion).mockResolvedValue({
      ownerType: 'project',
      projectId: context.id,
      context,
      resolvedNodeId: 'unknown_target_user',
      createdNodeId: 'node_answer',
    });

    const response = await POST(request({
      userId: 'demo-user',
      nodeId: 'unknown_target_user',
      projectId: context.id,
      answer: 'Yes, this remains acceptable.',
      feedback: {
        id: 'career_demo_feedback_unknown_target_user',
        rating: 'helpful',
        answer: 'Yes, this remains acceptable.',
      },
    }));

    expect(response.status).toBe(200);
    expect(saveFeedback).toHaveBeenCalledWith('demo-user', expect.objectContaining({
      id: 'career_demo_feedback_unknown_target_user',
      question_id: 'unknown_target_user',
      answer: 'Yes, this remains acceptable.',
    }));
  });
});
