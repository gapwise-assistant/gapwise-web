import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getStorageProvider } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { AskResearchEvidence } from '@/types/ask';

export const runtime = 'nodejs';

const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  excerpt: z.string(),
  score: z.number().optional(),
  kind: z.enum(['source', 'graph', 'memory', 'calendar', 'web']),
  supports: z.array(z.string()).optional(),
  reason: z.string().optional(),
  url: z.string().url().optional(),
  retrievedAt: z.string().optional(),
  groundingMetadata: z.record(z.string(), z.unknown()).optional(),
});

const chatSchema = z.object({
  id: z.string().trim().min(1),
  scopeType: z.enum(['general', 'project']),
  projectId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(240),
  adkSessionId: z.string().trim().min(1).optional(),
  target: z.object({
    type: z.enum(['question', 'decision']),
    id: z.string().trim().min(1),
    text: z.string().trim().min(1).max(1000),
  }).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

const messageSchema = z.object({
  id: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  projectId: z.string().trim().min(1).optional(),
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1),
  outcome: z.enum(['exploration', 'recommendation', 'conclusion']).optional(),
  resolvesQuestionId: z.string().trim().min(1).optional(),
  conclusion: z.string().trim().min(1).max(5000).optional(),
  sources: z.array(sourceSchema).default([]),
  openQuestionIds: z.array(z.string()).optional(),
  openQuestions: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  searchSuggestions: z.object({ renderedContent: z.string().optional(), webSearchQueries: z.array(z.string()).optional() }).optional(),
  execution: z.object({
    route: z.enum(['web_research', 'internal_context', 'graph_reasoning']),
    agent: z.string(),
    toolCalls: z.array(z.string()),
  }).optional(),
  createdAt: z.string().datetime().optional(),
});

function errorResponse(error: unknown, status = 500) {
  const code = error instanceof StorageError ? error.code : undefined;
  return NextResponse.json({
    error: error instanceof Error ? error.message : 'Ask chat storage failed.',
    ...(code ? { code } : {}),
  }, { status });
}

function statusForStorageError(error: unknown): number {
  if (!(error instanceof StorageError)) return 500;
  if (error.code === 'UNAUTHENTICATED') return 401;
  if (error.code === 'PERMISSION_DENIED') return 403;
  if (error.code === 'VALIDATION_ERROR') return 400;
  return 503;
}

function chatMatchesScope(
  chat: { id: string; projectId?: string },
  requestedProjectId: string | undefined,
  requestedChatId: string | undefined,
): boolean {
  if (requestedChatId && chat.id !== requestedChatId) return false;
  if (requestedProjectId) return chat.projectId === requestedProjectId;
  return Boolean(requestedChatId) || !chat.projectId;
}

export async function GET(request: Request) {
  try {
    const userId = await requireAuthenticatedUserId(request, new URL(request.url).searchParams.get('userId') ?? undefined);
    const searchParams = new URL(request.url).searchParams;
    const projectId = searchParams.get('projectId')?.trim() || undefined;
    const chatId = searchParams.get('chatId')?.trim() || undefined;
    const storage = getStorageProvider();
    const [allChats, allMessages, allResearch] = await Promise.all([
      storage.getAskChats(userId),
      storage.getAskMessages(userId),
      storage.getAskResearch(userId),
    ]);
    const chats = allChats
      .filter((chat) => chatMatchesScope(chat, projectId, chatId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const chatIds = new Set(chats.map((chat) => chat.id));
    const messages = allMessages
      .filter((message) => chatIds.has(message.chatId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const research = allResearch
      .filter((item: AskResearchEvidence) => chatIds.has(item.chatId))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    return NextResponse.json({ chats, messages, research });
  } catch (error) {
    return errorResponse(error, statusForStorageError(error));
  }
}

export async function POST(request: Request) {
  try {
    const body = z.object({
      userId: z.string().trim().min(1).optional(),
      chat: chatSchema,
      message: messageSchema.optional(),
    }).parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const now = new Date().toISOString();
    const storage = getStorageProvider();
    const existingChat = (await storage.getAskChats(userId)).find((candidate) => candidate.id === body.chat.id);
    if (body.chat.scopeType === 'project' ? !body.chat.projectId : Boolean(body.chat.projectId)) {
      throw new StorageError('Ask chat scope and workspace ID must agree.', 'VALIDATION_ERROR');
    }
    if (existingChat) {
      if (existingChat.scopeType !== body.chat.scopeType || existingChat.projectId !== body.chat.projectId) {
      throw new StorageError('The Ask chat is bound to a different workspace scope.', 'PERMISSION_DENIED');
      }
      if (existingChat.adkSessionId && body.chat.adkSessionId && existingChat.adkSessionId !== body.chat.adkSessionId) {
        throw new StorageError('The Ask chat is bound to a different ADK session.', 'PERMISSION_DENIED');
      }
      if (existingChat.target && body.chat.target && (existingChat.target.type !== body.chat.target.type || existingChat.target.id !== body.chat.target.id)) {
      throw new StorageError('The Ask chat is bound to a different workspace target.', 'PERMISSION_DENIED');
      }
    }
    const chat = {
      ...body.chat,
      userId,
      ...(existingChat?.adkSessionId ? { adkSessionId: existingChat.adkSessionId } : {}),
      createdAt: existingChat?.createdAt ?? body.chat.createdAt ?? now,
      updatedAt: body.chat.updatedAt ?? now,
    };
    await storage.saveAskChat(userId, chat);
    if (body.message) {
      await storage.saveAskMessage(userId, {
        ...body.message,
        userId,
        createdAt: body.message.createdAt ?? now,
      });
    }
    return NextResponse.json({ chat, message: body.message ? { ...body.message, userId, createdAt: body.message.createdAt ?? now } : undefined });
  } catch (error) {
    return error instanceof z.ZodError
      ? errorResponse(new Error('Invalid Ask chat request.'), 400)
      : errorResponse(error, statusForStorageError(error));
  }
}

export async function DELETE(request: Request) {
  try {
    const body = z.object({ userId: z.string().trim().min(1).optional(), chatId: z.string().trim().min(1) }).parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    await getStorageProvider().deleteAskChat(userId, body.chatId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return error instanceof z.ZodError
      ? errorResponse(new Error('Invalid Ask chat deletion request.'), 400)
      : errorResponse(error, statusForStorageError(error));
  }
}
