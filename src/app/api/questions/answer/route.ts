import { NextResponse } from 'next/server';
import { z } from 'zod';
import { answerQuestion, editAnsweredQuestion, reopenAnsweredQuestion } from '@/lib/questions/answerQuestion';
import { StorageError } from '@/lib/storage/types';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { saveFeedback } from '@/lib/tools/feedbackTools';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  nodeId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(5000),
  projectId: z.string().trim().min(1).optional(),
  feedback: z.object({
    id: z.string().trim().min(1).optional(),
    rating: z.enum(['helpful', 'irrelevant', 'already_answered', 'too_detailed', 'wrong_framing']),
    answer: z.string().trim().min(1).max(5000).optional(),
  }).optional(),
});

const editRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1),
  historyTimestamp: z.string().datetime(),
  nodeId: z.string().trim().min(1).optional(),
  question: z.string().trim().min(1).max(5000),
  previousAnswer: z.string().trim().min(1).max(5000),
  answer: z.string().trim().min(1).max(5000),
});

const reopenRequestSchema = z.object({
  action: z.literal('reopen'),
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  historyTimestamp: z.string().datetime(),
  nodeId: z.string().trim().min(1).optional(),
  question: z.string().trim().min(1).max(5000),
  previousAnswer: z.string().trim().min(1).max(5000),
});

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid answer request.', issues: error.issues }, { status: 400 });
  }
  if (error instanceof StorageError) {
    const status = error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'VALIDATION_ERROR' ? 400 : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'The answer could not be saved.' },
    { status: 500 }
  );
}

function latestResolutionHistoryEventId(
  project: Awaited<ReturnType<typeof answerQuestion>>['context'],
  type: 'gap_resolved' | 'gap_reopened' | 'answer_edited',
  nodeId?: string,
): string | undefined {
  return [...(project.historyEvents ?? [])]
    .reverse()
    .find((event) => event.type === type && (!nodeId || event.primaryNodeId === nodeId))?.id;
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const result = await answerQuestion({ ...body, userId });
    if (result.projectId) {
      try {
        await createProjectSnapshot({
          userId,
          projectId: result.projectId,
          trigger: {
            type: 'gap_resolved',
            nodeId: result.resolvedNodeId,
            ...(latestResolutionHistoryEventId(result.context, 'gap_resolved', result.resolvedNodeId)
              ? { historyEventId: latestResolutionHistoryEventId(result.context, 'gap_resolved', result.resolvedNodeId) }
              : {}),
          },
          label: 'Question resolved',
          summary: body.answer,
        });
      } catch (snapshotError) {
        console.warn('[Project snapshots] resolved question snapshot unavailable', snapshotError);
      }
    }
    if (body.feedback) {
      await saveFeedback(userId, {
        id: body.feedback.id ?? `question_feedback_${body.nodeId}`,
        question_id: body.nodeId,
        node_id: body.nodeId,
        rating: body.feedback.rating,
        answer: body.feedback.answer ?? body.answer,
        timestamp: new Date().toISOString(),
      });
    }
    return NextResponse.json({
      ...result,
      message: 'Understanding updated. This question is now resolved.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const rawBody = await request.json();
    if (rawBody && typeof rawBody === 'object' && rawBody.action === 'reopen') {
      const body = reopenRequestSchema.parse(rawBody);
      const userId = await requireAuthenticatedUserId(request, body.userId);
      const result = await reopenAnsweredQuestion({ ...body, userId });
      if (result.projectId) {
        try {
          await createProjectSnapshot({
            userId,
            projectId: result.projectId,
            trigger: {
              type: 'gap_reopened',
              nodeId: body.nodeId,
              ...(latestResolutionHistoryEventId(result.context, 'gap_reopened', body.nodeId)
                ? { historyEventId: latestResolutionHistoryEventId(result.context, 'gap_reopened', body.nodeId) }
                : {}),
            },
            label: 'Question reopened',
            summary: body.question,
          });
        } catch (snapshotError) {
          console.warn('[Project snapshots] reopened question snapshot unavailable', snapshotError);
        }
      }
      return NextResponse.json({
        ...result,
        message: 'Response cancelled. The question is open again.',
      });
    }
    const body = editRequestSchema.parse(rawBody);
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const result = await editAnsweredQuestion({ ...body, userId });
    try {
      await createProjectSnapshot({
        userId,
        projectId: result.projectId,
        trigger: {
          type: 'answer_edited',
          nodeId: body.nodeId,
          ...(latestResolutionHistoryEventId(result.context, 'answer_edited', body.nodeId)
            ? { historyEventId: latestResolutionHistoryEventId(result.context, 'answer_edited', body.nodeId) }
            : {}),
        },
        label: 'Answer edited',
        summary: body.answer,
      });
    } catch (snapshotError) {
      console.warn('[Project snapshots] edited answer snapshot unavailable', snapshotError);
    }
    return NextResponse.json({
      ...result,
      message: 'Answer updated. Gapwise understanding was refreshed.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
