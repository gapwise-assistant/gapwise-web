import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { loadGeneralContext, listProjects, getStorageProvider } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { answerQuestion } from '@/lib/questions/answerQuestion';
import { canonicalQuestionGroups } from '@/lib/questions/canonical';
import { AskResearchEvidence } from '@/types/ask';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  action: z.enum(['save', 'use_as_answer', 'save_as_context']),
  chatId: z.string().trim().min(1),
  assistantMessageId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(5000),
  projectId: z.string().trim().min(1).optional(),
  targetQuestionId: z.string().trim().min(1).optional(),
});

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return `ask_research_${Math.abs(hash)}_${value.length}`;
}

function normalizedAnswer(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function answerFingerprint(value: string): string {
  const normalized = normalizedAnswer(value);
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  return `answer_${Math.abs(hash)}_${normalized.length}`;
}

function errorResponse(error: unknown, status = 500) {
  const code = error instanceof StorageError ? error.code : undefined;
  return NextResponse.json({
    error: error instanceof Error ? error.message : 'Research action failed.',
    ...(code ? { code } : {}),
  }, { status });
}

async function assertTargetQuestion(userId: string, projectId: string | undefined, questionId: string): Promise<void> {
  const project = projectId && projectId !== GENERAL_CONTEXT_ID
    ? (await listProjects(userId)).find((candidate) => candidate.id === projectId)
    : await loadGeneralContext(userId);
  const question = project ? questionForId(project, questionId) : undefined;
  if (!question || question.type !== 'UNKNOWN' || question.status !== 'OPEN') {
    throw new StorageError('Select an open question for this research.', 'VALIDATION_ERROR');
  }
}

function questionForId(project: Awaited<ReturnType<typeof loadGeneralContext>>, questionId: string) {
  const group = canonicalQuestionGroups(project).find((candidate) => candidate.nodeIds.includes(questionId));
  return group?.canonical ?? project.nodes.find((node) => node.id === questionId);
}

async function targetQuestionStatus(userId: string, projectId: string | undefined, questionId: string): Promise<string | undefined> {
  const project = projectId && projectId !== GENERAL_CONTEXT_ID
    ? (await listProjects(userId)).find((candidate) => candidate.id === projectId)
    : await loadGeneralContext(userId);
  return project ? questionForId(project, questionId)?.status : undefined;
}

async function resolutionMatchesPendingAnswer(
  userId: string,
  projectId: string | undefined,
  questionId: string,
  pendingText: string,
  pendingFingerprint?: string,
): Promise<boolean> {
  const project = projectId && projectId !== GENERAL_CONTEXT_ID
    ? (await listProjects(userId)).find((candidate) => candidate.id === projectId)
    : await loadGeneralContext(userId);
  const question = project ? questionForId(project, questionId) : undefined;
  if (!project || !question || question.status !== 'RESOLVED') return false;
  const expectedFingerprint = pendingFingerprint ?? answerFingerprint(pendingText);
  return project.history.some((entry) =>
    entry.question === question.text
    && answerFingerprint(entry.answer) === expectedFingerprint
    && normalizedAnswer(entry.answer) === normalizedAnswer(pendingText)
    && !entry.graph_diff_summary.startsWith('Response cancelled; reopened')
  );
}

function matchingUseAsAnswerResearch(
  records: AskResearchEvidence[],
  chatId: string,
  assistantMessageId: string,
  targetQuestionId: string,
): AskResearchEvidence | undefined {
  return records
    .filter((record) => record.chatId === chatId
      && record.assistantMessageId === assistantMessageId
      && record.action === 'use_as_answer'
      && record.targetQuestionId === targetQuestionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const storage = getStorageProvider();
    const [chats, messages, researchRecords] = await Promise.all([
      storage.getAskChats(userId),
      storage.getAskMessages(userId),
      storage.getAskResearch(userId),
    ]);
    const chat = chats.find((candidate) => candidate.id === body.chatId);
    const assistantMessage = messages.find((candidate) =>
      candidate.id === body.assistantMessageId && candidate.chatId === body.chatId && candidate.role === 'assistant'
    );
    if (!chat || !assistantMessage) throw new StorageError('The cited Ask response could not be found.', 'PERMISSION_DENIED');
    if (chat.projectId !== body.projectId) throw new StorageError('The Ask response is outside this project.', 'PERMISSION_DENIED');

    const existingUseAsAnswer = body.action === 'use_as_answer' && body.targetQuestionId
      ? matchingUseAsAnswerResearch(researchRecords, body.chatId, body.assistantMessageId, body.targetQuestionId)
      : undefined;

    if (existingUseAsAnswer && body.action === 'use_as_answer') {
      const status = await targetQuestionStatus(userId, chat.projectId, body.targetQuestionId!);
      if (status === 'RESOLVED') {
        const matches = await resolutionMatchesPendingAnswer(
          userId,
          chat.projectId,
          body.targetQuestionId!,
          existingUseAsAnswer.text,
          existingUseAsAnswer.answerFingerprint,
        );
        if (!matches) {
          throw new StorageError('The question was resolved with a different answer; this research cannot be confirmed.', 'VALIDATION_ERROR');
        }
        if (existingUseAsAnswer.status !== 'confirmed') {
          const confirmed = { ...existingUseAsAnswer, status: 'confirmed' as const, updatedAt: new Date().toISOString() };
          await storage.saveAskResearch(userId, confirmed);
          return NextResponse.json({ research: confirmed, action: body.action, targetQuestionId: body.targetQuestionId });
        }
        return NextResponse.json({ research: existingUseAsAnswer, action: body.action, targetQuestionId: body.targetQuestionId });
      }
    }

    if (body.action === 'use_as_answer' && !body.targetQuestionId) {
      throw new StorageError('Select which open question this research answers.', 'VALIDATION_ERROR');
    }
    if (body.action === 'use_as_answer') await assertTargetQuestion(userId, chat.projectId, body.targetQuestionId!);

    const webSources = assistantMessage.sources.filter((source) => source.kind === 'web' && source.url);
    if (body.action === 'save' && !webSources.length) {
      throw new StorageError('This response does not contain cited web research.', 'VALIDATION_ERROR');
    }

    const hasWeb = webSources.length > 0;
    const isWebResearch = body.action === 'save' || (body.action === 'use_as_answer' && hasWeb);
    const provenance = isWebResearch ? 'assistant_web_research_confirmed_by_user' : 'user_confirmed_ai_response';
    const chosenSources = isWebResearch ? webSources : assistantMessage.sources.filter((s) => s.kind !== 'web');

    const retrievedAt = webSources.map((source) => source.retrievedAt).filter((value): value is string => Boolean(value)).sort()[0]
      ?? new Date().toISOString();
    const now = new Date().toISOString();
    const text = body.text;

    const research: AskResearchEvidence = {
      id: existingUseAsAnswer?.id ?? stableId(`${body.assistantMessageId}:${text}:${body.action}`),
      userId,
      chatId: body.chatId,
      assistantMessageId: body.assistantMessageId,
      ...(chat.projectId ? { projectId: chat.projectId } : {}),
      text,
      sources: chosenSources,
      retrievedAt,
      createdAt: existingUseAsAnswer?.createdAt ?? now,
      updatedAt: now,
      action: body.action,
      ...(body.targetQuestionId ? { targetQuestionId: body.targetQuestionId } : {}),
      ...(body.action === 'use_as_answer' ? { answerFingerprint: answerFingerprint(text) } : {}),
      status: body.action === 'use_as_answer' ? 'pending' : 'confirmed',
      provenance,
    };

    if (body.action === 'use_as_answer') {
      await storage.saveAskResearch(userId, research);
      await answerQuestion({
        userId,
        nodeId: body.targetQuestionId!,
        answer: text,
        projectId: chat.projectId,
      });
      const confirmed = { ...research, status: 'confirmed' as const, updatedAt: new Date().toISOString() };
      await storage.saveAskResearch(userId, confirmed);
      return NextResponse.json({ research: confirmed, action: body.action, targetQuestionId: body.targetQuestionId });
    }

    await storage.saveAskResearch(userId, research);
    return NextResponse.json({ research, action: body.action, targetQuestionId: body.targetQuestionId });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new Error('Invalid research action request.'), 400);
    if (error instanceof StorageError) {
      const status = error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'VALIDATION_ERROR' ? 400 : 503;
      return errorResponse(error, status);
    }
    return errorResponse(error);
  }
}
