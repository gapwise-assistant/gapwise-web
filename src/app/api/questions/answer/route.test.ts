import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { answerQuestion, editAnsweredQuestion, reopenAnsweredQuestion } from '@/lib/questions/answerQuestion';
import { PATCH, POST } from './route';
import { saveFeedback } from '@/lib/tools/feedbackTools';
import { validateProjectResolution, resolutionHistoryMetadata, validationWarningResponse } from '@/lib/resolutions/resolutionValidation';

vi.mock('@/lib/questions/answerQuestion', () => ({ answerQuestion: vi.fn(), editAnsweredQuestion: vi.fn(), reopenAnsweredQuestion: vi.fn() }));
vi.mock('@/lib/tools/feedbackTools', () => ({ saveFeedback: vi.fn() }));
vi.mock('@/lib/resolutions/resolutionValidation', () => ({
  validateProjectResolution: vi.fn(),
  resolutionHistoryMetadata: vi.fn(),
  validationWarningResponse: vi.fn(),
}));

function request(body: unknown): Request {
  return new Request('http://localhost/api/questions/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/questions/answer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateProjectResolution).mockResolvedValue({
      validation: {
        verdict: 'sufficient',
        reason: 'The response is specific enough.',
        missingInformation: [],
        confidence: 1,
      },
      fingerprint: 'validation-test',
      project: {} as never,
      node: {} as never,
    });
    vi.mocked(resolutionHistoryMetadata).mockReturnValue({
      verdict: 'sufficient',
      overridden: false,
    });
    vi.mocked(validationWarningResponse).mockImplementation((validation, fingerprint) => ({
      error: 'This response may not fully resolve the item.',
      code: 'RESOLUTION_VALIDATION_WARNING',
      resolutionValidation: validation,
      validationFingerprint: fingerprint,
    }));
  });

  it('does not mutate an answerable question until a warning is explicitly overridden', async () => {
    vi.mocked(validateProjectResolution).mockResolvedValue({
      validation: {
        verdict: 'warning',
        reason: 'The response is still ambiguous.',
        missingInformation: ['State the selected option.'],
        confidence: 0.9,
      },
      fingerprint: 'warning-fingerprint',
      project: {} as never,
      node: {} as never,
    });

    const response = await POST(request({
      userId: 'demo-user',
      nodeId: 'unknown_target_user',
      projectId: 'hackathon_demo',
      answer: 'Maybe this one.',
    }));

    expect(response.status).toBe(409);
    expect(answerQuestion).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'RESOLUTION_VALIDATION_WARNING',
      validationFingerprint: 'warning-fingerprint',
    });
  });

  it('passes an explicit Save anyway override into the existing answer workflow', async () => {
    const context = createGoldenDemoProject();
    vi.mocked(validateProjectResolution).mockResolvedValue({
      validation: {
        verdict: 'warning',
        reason: 'The response is still ambiguous.',
        missingInformation: ['State the selected option.'],
        confidence: 0.9,
      },
      fingerprint: 'warning-fingerprint',
      project: {} as never,
      node: {} as never,
    });
    vi.mocked(resolutionHistoryMetadata).mockReturnValue({
      verdict: 'warning',
      overridden: true,
      reason: 'The response is still ambiguous.',
      confidence: 0.9,
    });
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
      answer: 'Maybe this one.',
      validationFingerprint: 'warning-fingerprint',
      validationOverride: true,
    }));

    expect(response.status).toBe(200);
    expect(answerQuestion).toHaveBeenCalledWith(expect.objectContaining({
      resolutionValidation: {
        verdict: 'warning',
        overridden: true,
        reason: 'The response is still ambiguous.',
        confidence: 0.9,
      },
    }));
  });

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
      nodeId: 'unknown_target_user',
      question: 'What is the primary user?',
      previousAnswer: 'Independent builders.',
      answer: 'Technical founders.',
    }));

    expect(response.status).toBe(200);
    expect(editAnsweredQuestion).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'demo-user',
      nodeId: 'unknown_target_user',
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
