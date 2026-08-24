import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { askGapswiseLocally } from '@/lib/ask/localDemoAdapter';
import { isDemoMode, isLocalhostRequest } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getConfiguredGeminiModel } from '@/lib/google/genai';
import { estimateTokenCount, recordTrace } from '@/lib/observability/trace';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { persistAskConversationContext } from '@/lib/ask/conversationContext';
import { getStorageProvider } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { AskChatMessage, AskChatSession, AskOpenQuestion, AskSearchSuggestions, AskTarget } from '@/types/ask';

export const runtime = 'nodejs';

const offlineFallbackNotices = [
  'AI is not active right now. This response uses the data already in this project.',
  'The AI service is offline, so this is a local response based on your saved context.',
  'Here is an AI-style response using the context already available in this project.',
];
const localFallbackSystemPrompt = 'Use only the selected project context and clearly distinguish known facts from unresolved questions.';

function configuredModelConfig(provider: string, execution: string, agent = 'Partner Agent') {
  const config = getAgentModelConfig('partner');
  return {
    provider,
    agent,
    model: config.model,
    thinkingLevel: config.thinkingLevel,
    maxOutputTokens: config.maxOutputTokens,
    retryAttempts: 3,
    profile: process.env.AGENT_MODEL_PROFILE?.trim().toLowerCase() === 'flagship' ? 'flagship' : 'cheap',
    execution,
  } as const;
}

function localModelConfig() {
  return configuredModelConfig(
    'Deterministic local response',
    'Not called locally; Partner Agent would be used when ADK is available',
  );
}

const askRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1),
  sessionId: z.string().trim().optional(),
  projectId: z.string().trim().min(1).optional(),
  chatId: z.string().trim().min(1).optional(),
  userMessageId: z.string().trim().min(1).optional(),
  target: z.object({
    type: z.enum(['question', 'decision']),
    id: z.string().trim().min(1),
    text: z.string().trim().min(1).max(1000),
  }).optional(),
});

function titleForMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? `${compact.slice(0, 71).replace(/\s+\S*$/, '')}…` : compact || 'New chat';
}

function assistantMessageId(userMessageId: string): string {
  return `ask_assistant_${userMessageId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240);
}

async function persistUserAskMessage(params: {
  userId: string;
  chatId: string;
  userMessageId: string;
  message: string;
  projectId?: string;
  sessionId?: string;
  target?: AskTarget;
  request?: Request;
}): Promise<{ context: Awaited<ReturnType<typeof persistAskConversationContext>>; chat: AskChatSession }> {
  const storage = getStorageProvider();
  const now = new Date().toISOString();
  const chats = await storage.getAskChats(params.userId);
  const existingChat = chats.find((chat) => chat.id === params.chatId);
  assertAskChatBinding(existingChat, params.projectId, params.sessionId, params.target);
  const chat: AskChatSession = {
    id: params.chatId,
    userId: params.userId,
    scopeType: params.projectId ? 'project' : 'general',
    ...(params.projectId ? { projectId: params.projectId } : {}),
    title: existingChat?.title || titleForMessage(params.message),
    ...(existingChat?.adkSessionId || params.sessionId ? { adkSessionId: existingChat?.adkSessionId ?? params.sessionId } : {}),
    ...(existingChat?.target || params.target ? { target: existingChat?.target ?? params.target } : {}),
    createdAt: existingChat?.createdAt ?? now,
    updatedAt: now,
  };
  await storage.saveAskChat(params.userId, chat);
  await storage.saveAskMessage(params.userId, {
    id: params.userMessageId,
    chatId: params.chatId,
    userId: params.userId,
    ...(params.projectId ? { projectId: params.projectId } : {}),
    role: 'user',
    text: params.message,
    sources: [],
    createdAt: now,
  });
  const context = await persistAskConversationContext({
    userId: params.userId,
    chatId: params.chatId,
    messageId: params.userMessageId,
    text: params.message,
    ...(params.projectId ? { projectId: params.projectId } : {}),
    captureProcessingLog: params.request ? isLocalhostRequest(params.request) : false,
  });
  return { context, chat };
}

function assertAskChatBinding(
  chat: AskChatSession | undefined,
  projectId: string | undefined,
  sessionId: string | undefined,
  target?: AskTarget,
): void {
  if (!chat) return;
  const projectScope = projectId ? 'project' : 'general';
  if (chat.scopeType !== projectScope || (chat.projectId ?? undefined) !== projectId) {
    throw new StorageError('This chat belongs to a different project scope.', 'PERMISSION_DENIED');
  }
  if (chat.adkSessionId && sessionId && chat.adkSessionId !== sessionId) {
    throw new StorageError('This chat is bound to another active AI session.', 'VALIDATION_ERROR');
  }
  if (chat.target && target && (chat.target.type !== target.type || chat.target.id !== target.id)) {
    throw new StorageError('This chat is bound to a different project target.', 'VALIDATION_ERROR');
  }
}

async function loadAskChatBinding(
  userId: string,
  chatId: string | undefined,
  projectId: string | undefined,
  sessionId: string | undefined,
  target?: AskTarget,
): Promise<AskChatSession | undefined> {
  if (!chatId) return undefined;
  const chat = (await getStorageProvider().getAskChats(userId)).find((candidate) => candidate.id === chatId);
  assertAskChatBinding(chat, projectId, sessionId, target);
  return chat;
}

function storageErrorResponse(error: StorageError): NextResponse {
  const status = error.code === 'PERMISSION_DENIED' ? 403 : error.code === 'VALIDATION_ERROR' ? 400 : 503;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

async function persistAssistantAskMessage(params: {
  userId: string;
  chat: AskChatSession;
  userMessageId: string;
  answer: string;
  sources: AskChatMessage['sources'];
  openQuestionIds: string[];
  openQuestions: AskOpenQuestion[];
  outcome?: AskChatMessage['outcome'];
  resolvesQuestionId?: AskChatMessage['resolvesQuestionId'];
  conclusion?: AskChatMessage['conclusion'];
  searchSuggestions?: AskSearchSuggestions;
  execution?: AskChatMessage['execution'];
  sessionId?: string;
}): Promise<string> {
  const now = new Date().toISOString();
  const id = assistantMessageId(params.userMessageId);
  const storage = getStorageProvider();
  await storage.saveAskMessage(params.userId, {
    id,
    chatId: params.chat.id,
    userId: params.userId,
    ...(params.chat.projectId ? { projectId: params.chat.projectId } : {}),
    role: 'assistant',
    text: params.answer,
    sources: params.sources,
    createdAt: now,
    openQuestionIds: params.openQuestionIds,
    openQuestions: params.openQuestions,
    ...(params.outcome ? { outcome: params.outcome } : {}),
    ...(params.resolvesQuestionId ? { resolvesQuestionId: params.resolvesQuestionId } : {}),
    ...(params.conclusion ? { conclusion: params.conclusion } : {}),
    ...(params.searchSuggestions ? { searchSuggestions: params.searchSuggestions } : {}),
    ...(params.execution ? { execution: params.execution } : {}),
  });
  const boundSessionId = params.chat.adkSessionId ?? params.sessionId;
  await storage.saveAskChat(params.userId, {
    ...params.chat,
    ...(boundSessionId ? { adkSessionId: boundSessionId } : {}),
    updatedAt: now,
  });
  return id;
}

export async function POST(request: Request) {
  const started = Date.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid Ask request.', issues: parsed.error.issues }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, parsed.data.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }

  let existingChat: AskChatSession | undefined;
  try {
    existingChat = await loadAskChatBinding(userId, parsed.data.chatId, parsed.data.projectId, parsed.data.sessionId, parsed.data.target);
  } catch (error) {
    if (error instanceof StorageError) return storageErrorResponse(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ask chat storage is unavailable.' }, { status: 503 });
  }
  const boundSessionId = existingChat?.adkSessionId ?? parsed.data.sessionId;
  const askInputBase = {
    userId,
    message: parsed.data.message,
    ...(boundSessionId ? { sessionId: boundSessionId } : {}),
    ...(parsed.data.projectId ? { projectId: parsed.data.projectId } : {}),
    ...(parsed.data.chatId ? { chatId: parsed.data.chatId } : {}),
  };

  let persistedTurn: Awaited<ReturnType<typeof persistUserAskMessage>> | null = null;
  if (parsed.data.chatId && parsed.data.userMessageId) {
    try {
      persistedTurn = await persistUserAskMessage({
        userId,
        chatId: parsed.data.chatId,
        userMessageId: parsed.data.userMessageId,
        message: parsed.data.message,
        projectId: parsed.data.projectId,
        sessionId: boundSessionId,
        target: parsed.data.target,
        request,
      });
    } catch (error) {
      if (error instanceof StorageError && (error.code === 'PERMISSION_DENIED' || error.code === 'VALIDATION_ERROR')) {
        return storageErrorResponse(error);
      }
      console.error('[Gapwise Ask] user message persistence failed', {
        error: error instanceof Error ? error.message : 'unknown-error',
        chatId: parsed.data.chatId,
        userMessageId: parsed.data.userMessageId,
      });
    }
  }

  const askOpenQuestions = persistedTurn
    ? Array.from(new Map([
        ...persistedTurn.context.openQuestions,
        ...(persistedTurn.chat.target?.type === 'question'
          ? [{ id: persistedTurn.chat.target.id, text: persistedTurn.chat.target.text }]
          : []),
      ].map((question) => [question.id, question] as const)).values())
    : [];
  const askInput = {
    ...askInputBase,
    ...(parsed.data.userMessageId ? { excludeMessageId: parsed.data.userMessageId } : {}),
    ...(persistedTurn ? { excludeSourceId: persistedTurn.context.sourceId } : {}),
    ...(persistedTurn ? { openQuestions: askOpenQuestions } : {}),
  };

  const withPersistedTurn = async (result: Awaited<ReturnType<typeof askGapswise>>): Promise<typeof result> => {
    if (!persistedTurn || !parsed.data.chatId || !parsed.data.userMessageId) return result;
    const openQuestions = result.openQuestions?.length ? result.openQuestions : askOpenQuestions;
    const openQuestionIds = result.openQuestionIds?.length
      ? result.openQuestionIds
      : openQuestions.map((question) => question.id);
    const boundSessionId = persistedTurn.chat.adkSessionId ?? result.sessionId;
    const assistantId = await persistAssistantAskMessage({
      userId,
      chat: persistedTurn.chat,
      userMessageId: parsed.data.userMessageId,
      answer: result.answer,
      sources: result.sources,
      openQuestionIds,
      openQuestions,
      outcome: result.outcome,
      resolvesQuestionId: result.resolvesQuestionId,
      conclusion: result.conclusion,
      searchSuggestions: result.searchSuggestions,
      execution: result.execution,
      sessionId: boundSessionId,
    });
    return {
      ...result,
      ...(boundSessionId ? { sessionId: boundSessionId } : {}),
      assistantMessageId: assistantId,
      openQuestionIds,
      openQuestions,
    };
  };

  try {
    const live = !isDemoMode();
    const result = live
      ? await askGapswise(askInput)
      : await askGapswiseLocally(askInput);
    const persistedResult = await withPersistedTurn(result);
    if (live) {
      const execution = persistedResult.execution;
      const agentName = execution?.agent ?? 'Partner Agent';
      const toolCalls = execution?.toolCalls ?? ['ADK /run_sse'];
      const routeName = execution?.route ?? 'internal_context';
      recordTrace({
        userId,
        route: '/api/ask',
        label: 'Live Ask response',
        started_at: new Date(started).toISOString(),
        duration_ms: Date.now() - started,
        agentNames: [agentName],
        contextIds: [],
        scores: [],
        toolCalls,
        model: getConfiguredGeminiModel(),
        agentConfigs: [{
          ...configuredModelConfig('Vertex AI / Google ADK', 'Used', agentName),
          agentName,
          execution: 'used',
        }],
        agentRuns: [{
          runId: `partner_${started}`,
          agent: agentName,
          model: getConfiguredGeminiModel(),
          thinkingLevel: getAgentModelConfig('partner').thinkingLevel,
          inputTokens: estimateTokenCount(parsed.data.message),
          outputTokens: estimateTokenCount(persistedResult.answer ?? ''),
          latencyMs: Date.now() - started,
          estimatedCost: 0,
          costSource: 'unavailable',
          validationStatus: 'passed',
          confidence: null,
          escalated: false,
          execution: 'used',
          inputSummary: `Ask route selected: ${routeName}`,
          outputSummary: `${agentName} response returned to Ask UI`,
        }],
      });
    }
    return NextResponse.json(isDemoMode()
      ? {
          ...persistedResult,
          generatedBy: 'local-context',
          modelConfig: localModelConfig(),
          fallbackPrompt: parsed.data.message,
          fallbackSystemPrompt: localFallbackSystemPrompt,
        }
      : {
          ...persistedResult,
          modelConfig: {
            ...configuredModelConfig('Vertex AI / Google ADK', 'Used', persistedResult.execution?.agent),
            model: getConfiguredGeminiModel(),
          },
        });
  } catch (error) {
    if (isDemoMode()) {
      return NextResponse.json(
        { error: error instanceof Error ? `Local demo Ask failed: ${error.message}` : 'Local demo Ask failed.' },
        { status: 500 }
      );
    }
    if (error instanceof AskAgentError && error.stage === 'routing') {
      return NextResponse.json(
        { error: 'External verification failed: the request could not be routed safely.' },
        { status: 502 },
      );
    }
    try {
      const fallback = await askGapswiseLocally(askInput);
      const persistedFallback = await withPersistedTurn(fallback);
      const notice = offlineFallbackNotices[Math.floor(Math.random() * offlineFallbackNotices.length)];
      return NextResponse.json({
        ...persistedFallback,
        modelConfig: localModelConfig(),
        answer: `${notice}\n\n${fallback.answer}`,
        generatedBy: 'local-fallback',
        fallbackPrompt: parsed.data.message,
        fallbackSystemPrompt: localFallbackSystemPrompt,
        warning: 'The deployed AI agent is unavailable; this answer was generated from the current project context.',
      });
    } catch {
      // Preserve the existing error response if the local context fallback is also unavailable.
    }
    const message = error instanceof AskAgentError
      ? error.message
      : 'Gapwise agent is unavailable right now.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
