import { NextResponse } from 'next/server';
import { z } from 'zod';
import { answerQuestion, editAnsweredQuestion, reopenAnsweredQuestion } from '@/lib/questions/answerQuestion';
import { StorageError } from '@/lib/storage/types';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { saveFeedback } from '@/lib/tools/feedbackTools';
import { createProjectSnapshot } from '@/lib/history/projectSnapshots';
import { scheduleAskSuggestionsRefresh } from '@/lib/ask/suggestionsScheduler';
import { listProjects } from '@/lib/storage';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import {
  resolutionHistoryMetadata,
  validateProjectResolution,
  validationWarningResponse,
} from '@/lib/resolutions/resolutionValidation';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  nodeId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(5000),
  projectId: z.string().trim().min(1).optional(),
  validationOverride: z.boolean().optional(),
  validationFingerprint: z.string().trim().min(1).max(128).optional(),
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
  validationOverride: z.boolean().optional(),
  validationFingerprint: z.string().trim().min(1).max(128).optional(),
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

async function nodeIdForEditedQuestion(userId: string, projectId: string, nodeId: string | undefined, question: string): Promise<string | undefined> {
  if (nodeId) return nodeId;
  const project = (await listProjects(userId)).find((candidate) => candidate.id === projectId);
  return project?.nodes.find((node) =>
    node.text === question
    && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
    && node.status === 'RESOLVED'
  )?.id;
}

async function validateResolutionSubmission(params: {
  userId: string;
  projectId: string;
  nodeId: string;
  proposedResponse: string;
  validationOverride?: boolean;
  validationFingerprint?: string;
}): Promise<{ metadata: ReturnType<typeof resolutionHistoryMetadata>; fingerprint: string } | NextResponse> {
  const result = await validateProjectResolution(params);
  if (params.validationFingerprint && params.validationFingerprint !== result.fingerprint) {
    return NextResponse.json(validationWarningResponse(result.validation, result.fingerprint), { status: 409 });
  }
  if (result.validation.verdict === 'warning' && !params.validationOverride) {
    return NextResponse.json(validationWarningResponse(result.validation, result.fingerprint), { status: 409 });
  }
  return {
    metadata: resolutionHistoryMetadata(result.validation, params),
    fingerprint: result.fingerprint,
  };
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const validation = await validateResolutionSubmission({
      userId,
      projectId: body.projectId ?? GENERAL_CONTEXT_ID,
      nodeId: body.nodeId,
      proposedResponse: body.answer,
      validationOverride: body.validationOverride,
      validationFingerprint: body.validationFingerprint,
    });
    if (validation instanceof NextResponse) return validation;
    const result = await answerQuestion({
      userId,
      nodeId: body.nodeId,
      answer: body.answer,
      projectId: body.projectId,
      resolutionValidation: validation.metadata,
    });
    if (result.projectId) {
      await scheduleAskSuggestionsRefresh({ userId, project: result.context });
    }
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
      if (result.projectId && result.ownerType === 'project') {
        await scheduleAskSuggestionsRefresh({ userId, project: result.context });
      }
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
    const validationNodeId = await nodeIdForEditedQuestion(userId, body.projectId, body.nodeId, body.question);
    if (!validationNodeId) throw new StorageError('The answered question could not be identified for checking.', 'VALIDATION_ERROR');
    const validation = await validateResolutionSubmission({
      userId,
      projectId: body.projectId,
      nodeId: validationNodeId,
      proposedResponse: body.answer,
      validationOverride: body.validationOverride,
      validationFingerprint: body.validationFingerprint,
    });
    if (validation instanceof NextResponse) return validation;
    const result = await editAnsweredQuestion({
      userId,
      projectId: body.projectId,
      historyTimestamp: body.historyTimestamp,
      nodeId: body.nodeId,
      question: body.question,
      previousAnswer: body.previousAnswer,
      answer: body.answer,
      resolutionValidation: validation.metadata,
    });
    await scheduleAskSuggestionsRefresh({ userId, project: result.context });
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
