import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { loadGeneralContext, listProjects, getStorageProvider, saveGeneralContext, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { answerQuestion } from '@/lib/questions/answerQuestion';
import { canonicalQuestionGroups } from '@/lib/questions/canonical';
import { AskResearchEvidence } from '@/types/ask';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import { confirmDecision } from '@/lib/decisions/workspace';
import { refreshAskSuggestionsForProject } from '@/lib/ask/suggestionsRefresh';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  action: z.enum(['save', 'use_as_answer', 'use_as_decision', 'save_as_context']),
  chatId: z.string().trim().min(1),
  assistantMessageId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(5000),
  projectId: z.string().trim().min(1).optional(),
  targetQuestionId: z.string().trim().min(1).optional(),
  targetDecisionId: z.string().trim().min(1).optional(),
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

async function loadDecisionTarget(userId: string, projectId: string | undefined, decisionId: string): Promise<{ project: Awaited<ReturnType<typeof loadGeneralContext>>; isGeneral: boolean }> {
  if (projectId && projectId !== GENERAL_CONTEXT_ID) {
    const project = (await listProjects(userId)).find((candidate) => candidate.id === projectId);
    if (!project) throw new StorageError('The selected Ask workspace does not exist.', 'VALIDATION_ERROR');
    return { project, isGeneral: false };
  }
  return { project: await loadGeneralContext(userId), isGeneral: true };
}

async function assertTargetDecision(userId: string, projectId: string | undefined, decisionId: string): Promise<void> {
  const target = await loadDecisionTarget(userId, projectId, decisionId);
  const decision = target.project.nodes.find((node) => node.id === decisionId);
  if (!decision || decision.type !== 'DECISION' || decision.status !== 'OPEN') {
    throw new StorageError('Select an open decision for this discussion.', 'VALIDATION_ERROR');
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

async function targetDecisionStatus(userId: string, projectId: string | undefined, decisionId: string): Promise<string | undefined> {
  const target = await loadDecisionTarget(userId, projectId, decisionId);
  return target.project.nodes.find((node) => node.id === decisionId)?.status;
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

async function resolutionMatchesPendingDecision(
  userId: string,
  projectId: string | undefined,
  decisionId: string,
  pendingText: string,
): Promise<boolean> {
  const target = await loadDecisionTarget(userId, projectId, decisionId);
  const decision = target.project.nodes.find((node) => node.id === decisionId);
  return Boolean(
    decision
      && decision.type === 'DECISION'
      && decision.status === 'RESOLVED'
      && typeof decision.decision_outcome === 'string'
      && normalizedAnswer(decision.decision_outcome) === normalizedAnswer(pendingText),
  );
}

function matchingUseAsAnswerResearch(
  records: AskResearchEvidence[],
  chatId: string,
  assistantMessageId: string,
  target: { questionId?: string; decisionId?: string },
): AskResearchEvidence | undefined {
  return records
    .filter((record) => record.chatId === chatId
      && record.assistantMessageId === assistantMessageId
      && (record.action === 'use_as_answer' || record.action === 'use_as_decision')
      && (target.questionId ? record.targetQuestionId === target.questionId : record.targetDecisionId === target.decisionId))
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
    if (chat.projectId !== body.projectId) throw new StorageError('The Ask response is outside this workspace.', 'PERMISSION_DENIED');

    const isQuestionAction = body.action === 'use_as_answer';
    const isDecisionAction = body.action === 'use_as_decision';
    const targetQuestionId = body.targetQuestionId ?? (chat.target?.type === 'question' ? chat.target.id : undefined);
    const targetDecisionId = body.targetDecisionId ?? (chat.target?.type === 'decision' ? chat.target.id : undefined);
    if (chat.target && ((chat.target.type === 'question' && isDecisionAction) || (chat.target.type === 'decision' && isQuestionAction))) {
      throw new StorageError('This Ask chat is bound to a different target type.', 'VALIDATION_ERROR');
    }
    if (body.targetQuestionId && chat.target?.type === 'question' && body.targetQuestionId !== chat.target.id) {
      throw new StorageError('This Ask chat is bound to a different question.', 'VALIDATION_ERROR');
    }
    if (body.targetDecisionId && chat.target?.type === 'decision' && body.targetDecisionId !== chat.target.id) {
      throw new StorageError('This Ask chat is bound to a different decision.', 'VALIDATION_ERROR');
    }
    if (targetQuestionId && targetDecisionId) {
      throw new StorageError('An Ask response cannot target both a question and a decision.', 'VALIDATION_ERROR');
    }

    const existingUseAsAnswer = (isQuestionAction && targetQuestionId) || (isDecisionAction && targetDecisionId)
      ? matchingUseAsAnswerResearch(researchRecords, body.chatId, body.assistantMessageId, {
        ...(targetQuestionId ? { questionId: targetQuestionId } : {}),
        ...(targetDecisionId ? { decisionId: targetDecisionId } : {}),
      })
      : undefined;

    if (existingUseAsAnswer && (isQuestionAction || isDecisionAction)) {
      const status = isQuestionAction
        ? await targetQuestionStatus(userId, chat.projectId, targetQuestionId!)
        : await targetDecisionStatus(userId, chat.projectId, targetDecisionId!);
      if (status === 'RESOLVED') {
        const matches = isQuestionAction
          ? await resolutionMatchesPendingAnswer(
            userId,
            chat.projectId,
            targetQuestionId!,
            existingUseAsAnswer.text,
            existingUseAsAnswer.answerFingerprint,
          )
          : await resolutionMatchesPendingDecision(userId, chat.projectId, targetDecisionId!, existingUseAsAnswer.text);
        if (!matches) {
          throw new StorageError(
            isQuestionAction
              ? 'The question was resolved with a different answer; this research cannot be confirmed.'
              : 'The decision was made with different wording; this research cannot be confirmed.',
            'VALIDATION_ERROR',
          );
        }
        if (existingUseAsAnswer.status !== 'confirmed') {
          const confirmed = { ...existingUseAsAnswer, status: 'confirmed' as const, updatedAt: new Date().toISOString() };
          await storage.saveAskResearch(userId, confirmed);
          return NextResponse.json({ research: confirmed, action: body.action, ...(targetQuestionId ? { targetQuestionId } : {}), ...(targetDecisionId ? { targetDecisionId } : {}) });
        }
        return NextResponse.json({ research: existingUseAsAnswer, action: body.action, ...(targetQuestionId ? { targetQuestionId } : {}), ...(targetDecisionId ? { targetDecisionId } : {}) });
      }
    }

    if (isQuestionAction && !targetQuestionId) {
      throw new StorageError('Select which open question this research answers.', 'VALIDATION_ERROR');
    }
    if (isDecisionAction && !targetDecisionId) {
      throw new StorageError('This decision chat is missing its target.', 'VALIDATION_ERROR');
    }
    if (isQuestionAction) {
      if (assistantMessage.outcome !== 'conclusion' || !assistantMessage.conclusion?.trim()) {
        throw new StorageError('Only a structured conclusion can be used as a question answer.', 'VALIDATION_ERROR');
      }
      if (assistantMessage.resolvesQuestionId !== targetQuestionId) {
        throw new StorageError('This conclusion targets a different open question.', 'VALIDATION_ERROR');
      }
    }
    if (isDecisionAction && (assistantMessage.outcome !== 'conclusion' || !assistantMessage.conclusion?.trim())) {
      throw new StorageError('Only a structured conclusion can be used as a decision.', 'VALIDATION_ERROR');
    }
    if (isQuestionAction) await assertTargetQuestion(userId, chat.projectId, targetQuestionId!);
    if (isDecisionAction) await assertTargetDecision(userId, chat.projectId, targetDecisionId!);

    const webSources = assistantMessage.sources.filter((source) => source.kind === 'web' && source.url);
    if (body.action === 'save' && !webSources.length) {
      throw new StorageError('This response does not contain cited web research.', 'VALIDATION_ERROR');
    }

    const hasWeb = webSources.length > 0;
    const isWebResearch = body.action === 'save' || ((isQuestionAction || isDecisionAction) && hasWeb);
    const provenance = isWebResearch ? 'assistant_web_research_confirmed_by_user' : 'user_confirmed_ai_response';
    const chosenSources = isWebResearch ? webSources : assistantMessage.sources.filter((s) => s.kind !== 'web');

    const retrievedAt = webSources.map((source) => source.retrievedAt).filter((value): value is string => Boolean(value)).sort()[0]
      ?? new Date().toISOString();
    const now = new Date().toISOString();
    const text = (isQuestionAction || isDecisionAction)
      ? assistantMessage.conclusion!.trim()
      : body.text;

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
      ...(targetQuestionId ? { targetQuestionId } : {}),
      ...(targetDecisionId ? { targetDecisionId } : {}),
      ...((isQuestionAction || isDecisionAction) ? { answerFingerprint: answerFingerprint(text) } : {}),
      status: isQuestionAction || isDecisionAction ? 'pending' : 'confirmed',
      provenance,
    };

    if (isQuestionAction || isDecisionAction) {
      await storage.saveAskResearch(userId, research);
      if (isQuestionAction) {
        const answerResult = await answerQuestion({
          userId,
          nodeId: targetQuestionId!,
          answer: text,
          projectId: chat.projectId,
        });
        if (answerResult.projectId) {
          await refreshAskSuggestionsForProject({ userId, project: answerResult.context });
        }
      } else {
        const target = await loadDecisionTarget(userId, chat.projectId, targetDecisionId!);
        const updated = confirmDecision(target.project, {
          decisionNodeId: targetDecisionId!,
          customDecision: text,
        });
        if (target.isGeneral) await saveGeneralContext(userId, updated);
        else {
          await saveProject(userId, updated);
          await refreshAskSuggestionsForProject({ userId, project: updated });
        }
      }
      const confirmed = { ...research, status: 'confirmed' as const, updatedAt: new Date().toISOString() };
      await storage.saveAskResearch(userId, confirmed);
      return NextResponse.json({ research: confirmed, action: body.action, ...(targetQuestionId ? { targetQuestionId } : {}), ...(targetDecisionId ? { targetDecisionId } : {}) });
    }

    await storage.saveAskResearch(userId, research);
    return NextResponse.json({ research, action: body.action, ...(targetQuestionId ? { targetQuestionId } : {}) });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new Error('Invalid research action request.'), 400);
    if (error instanceof StorageError) {
      const status = error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'VALIDATION_ERROR' ? 400 : 503;
      return errorResponse(error, status);
    }
    return errorResponse(error);
  }
}
