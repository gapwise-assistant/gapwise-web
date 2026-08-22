'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ChevronRight, Eye, EyeOff, Globe, Loader2, MessageSquarePlus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { AskOpenQuestion, AskResearchEvidence, AskResult, AskSearchSuggestions, AskSource } from '@/types/ask';
import { AppScope, scopeStorageKey } from '@/types/scope';
import { AssistantMarkdown } from '@/components/AssistantMarkdown';
import { addSourceCitations } from '@/lib/ask/citations';
import { humanizeSourceTitle } from '@/lib/context/sourceTitle';
import type { SuggestedQuestionGroups } from '@/lib/ask/suggestions';
import { authFetch } from '@/lib/auth/client';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';

interface AskGapswiseProps {
  userId: string;
  scope: AppScope;
  scopeLabel: string;
  initialPrompt?: string;
  autoSendInitialPrompt?: boolean;
  onInitialPromptSent?: () => void;
  newChatPrompt?: { id: string; text: string } | null;
  onNewChatPromptOpened?: () => void;
  onViewSource?: (source: AskSource) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: AskSource[];
  openQuestionIds?: string[];
  openQuestions?: AskOpenQuestion[];
  searchSuggestions?: AskSearchSuggestions;
  responseDetails?: {
    promptUsed?: string;
    systemPrompt?: string;
    modelConfig?: {
      provider: string;
      agent: string;
      model: string;
      thinkingLevel: string;
      maxOutputTokens: number;
      retryAttempts: number;
      profile: string;
      execution: string;
    };
    contextUsed?: {
      projectTitle: string;
      items: string[];
    };
  };
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  firstQuestion: string;
  sessionId: string | null;
  messages: ChatMessage[];
}

interface PersistedAskChat {
  id: string;
  title: string;
  adkSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

interface PersistedAskMessage extends ChatMessage {
  chatId: string;
  createdAt: string;
}

interface ResearchActionState {
  message: ChatMessage;
  mode: 'save' | 'use_as_answer' | 'save_as_context';
  text: string;
  targetQuestionId: string;
}

function sessionStorageKey(userId: string, scope: AppScope): string {
  return `gapwise_ask_session_${userId}_${scopeStorageKey(scope)}`;
}

function messagesStorageKey(userId: string, scope: AppScope): string {
  return `gapwise_ask_messages_${userId}_${scopeStorageKey(scope)}`;
}

function chatsStorageKey(userId: string, scope: AppScope): string {
  return `gapwise_ask_chats_${userId}_${scopeStorageKey(scope)}`;
}

function hiddenWorkspaceKey(userId: string, scope: AppScope): string {
  return `gapwise_ask_workspace_hidden_${userId}_${scopeStorageKey(scope)}`;
}

function newChat(): ChatSession {
  return {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New chat',
    createdAt: new Date().toISOString(),
    firstQuestion: '',
    sessionId: null,
    messages: [],
  };
}

function titleForMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 42 ? `${compact.slice(0, 41).replace(/\s+\S*$/, '')}…` : compact || 'New chat';
}

function chatTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function chatQuestion(chat: ChatSession): string {
  return chat.firstQuestion || chat.title || 'New chat';
}

function chatLabel(chat: ChatSession): string {
  return `${chatTimestamp(chat.createdAt)} · ${titleForMessage(chatQuestion(chat))}`;
}

function chatHoverLabel(chat: ChatSession): string {
  return `${chatTimestamp(chat.createdAt)} · ${chatQuestion(chat)}`;
}

export function chatPickerOptions(chats: ChatSession[], draftChat: ChatSession | null): Array<{ id: string; label: string; title?: string }> {
  const options: Array<{ id: string; label: string; title?: string }> = [];
  if (draftChat) {
    options.push({
      id: draftChat.id,
      label: draftChat.messages.length ? chatLabel(draftChat) : 'New chat (unsent)',
      title: draftChat.messages.length ? chatHoverLabel(draftChat) : 'Unsent new chat draft',
    });
  }
  chats.forEach((candidate) => {
    if (draftChat && candidate.id === draftChat.id) return;
    options.push({
      id: candidate.id,
      label: chatLabel(candidate),
      title: chatHoverLabel(candidate),
    });
  });
  return options;
}

export function restoreChatSessions(
  persistedChats: PersistedAskChat[],
  persistedMessages: PersistedAskMessage[],
): ChatSession[] {
  const messagesByChat = new Map<string, ChatMessage[]>();
  persistedMessages.forEach((message) => {
    const messages = messagesByChat.get(message.chatId) ?? [];
    messages.push({
      id: message.id,
      role: message.role,
      text: message.text,
      sources: message.sources,
      openQuestionIds: message.openQuestionIds,
      openQuestions: message.openQuestions,
      searchSuggestions: message.searchSuggestions,
    });
    messagesByChat.set(message.chatId, messages);
  });

  return persistedChats.map((chat) => {
    const messages = messagesByChat.get(chat.id) ?? [];
    const firstQuestion = messages.find((message) => message.role === 'user')?.text ?? '';
    return {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      firstQuestion,
      sessionId: chat.adkSessionId ?? null,
      messages,
    };
  });
}

export function researchStatusFromRecords(records: Array<Partial<AskResearchEvidence>>): {
  savedMessageIds: Set<string>;
  savedContextMessageIds: Set<string>;
  confirmedAnswerMessageIds: Set<string>;
} {
  const savedMessageIds = new Set<string>();
  const savedContextMessageIds = new Set<string>();
  const confirmedAnswerMessageIds = new Set<string>();

  records.forEach((record) => {
    if (!record.assistantMessageId) return;
    if (record.action === 'save_as_context' || record.provenance === 'user_confirmed_ai_response') {
      savedContextMessageIds.add(record.assistantMessageId);
    }
    if (record.action === 'save' || record.provenance === 'assistant_web_research_confirmed_by_user') {
      savedMessageIds.add(record.assistantMessageId);
    }
    if (record.action === 'use_as_answer' && record.status === 'confirmed') {
      confirmedAnswerMessageIds.add(record.assistantMessageId);
    }
    if (!record.action && !record.provenance) {
      savedMessageIds.add(record.assistantMessageId);
    }
  });

  return { savedMessageIds, savedContextMessageIds, confirmedAnswerMessageIds };
}

function conclusionFromAnswer(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));
  return lines[0] ?? text.trim();
}

function safeSearchSuggestionText(suggestions?: AskSearchSuggestions): string {
  if (!suggestions) return '';
  const text = (suggestions.renderedContent ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text;
}

export function AskGapswise({
  userId,
  scope,
  scopeLabel,
  initialPrompt,
  autoSendInitialPrompt,
  onInitialPromptSent,
  newChatPrompt,
  onNewChatPromptOpened,
  onViewSource,
}: AskGapswiseProps) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [draftChat, setDraftChat] = useState<ChatSession | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedSources, setSelectedSources] = useState<AskSource[] | null>(null);
  const [isWorkspaceHidden, setIsWorkspaceHidden] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestionGroups | null>(null);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(false);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const [researchAction, setResearchAction] = useState<ResearchActionState | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState('');
  const [savedResearchMessageIds, setSavedResearchMessageIds] = useState<Set<string>>(new Set());
  const [savedContextMessageIds, setSavedContextMessageIds] = useState<Set<string>>(new Set());
  const [confirmedAnswerMessageIds, setConfirmedAnswerMessageIds] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sourcesPanelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialPromptSentRef = useRef<string | null>(null);

  useDismissibleModal(
    () => setSelectedSources(null),
    sourcesPanelRef,
    Boolean(selectedSources),
  );

  const activeChat = useMemo(() => {
    if (draftChat && draftChat.id === activeChatId) return draftChat;
    return chats.find((chat) => chat.id === activeChatId) ?? chats[0] ?? draftChat ?? null;
  }, [activeChatId, chats, draftChat]);

  useEffect(() => {
    setHydratedScope(`${userId}:${scopeStorageKey(scope)}`);
    try {
      const storedChats = localStorage.getItem(chatsStorageKey(userId, scope));
      const parsedChats: ChatSession[] = storedChats ? JSON.parse(storedChats) : [];
      setChats(parsedChats);
      const storedActiveId = localStorage.getItem(sessionStorageKey(userId, scope));
      const nextActiveId = parsedChats.some((candidate) => candidate.id === storedActiveId)
        ? storedActiveId
        : parsedChats[0]?.id ?? null;
      setActiveChatId(nextActiveId);
      setIsWorkspaceHidden(localStorage.getItem(hiddenWorkspaceKey(userId, scope)) === 'true');
    } catch {
      setChats([]);
      setActiveChatId(null);
    }
    setHasLoadedPersistedState(true);
  }, [scope, userId]);

  useEffect(() => {
    if (!hasLoadedPersistedState || !activeChatId) return;
    try {
      localStorage.setItem(sessionStorageKey(userId, scope), activeChatId);
    } catch {
      // Ignore storage write issues
    }
  }, [activeChatId, hasLoadedPersistedState, scope, userId]);

  useEffect(() => {
    if (!hasLoadedPersistedState) return;
    try {
      localStorage.setItem(chatsStorageKey(userId, scope), JSON.stringify(chats));
    } catch {
      // Ignore storage write issues
    }
  }, [chats, hasLoadedPersistedState, scope, userId]);

  useEffect(() => {
    if (!hasLoadedPersistedState) return;
    let isMounted = true;
    const fetchChatState = async () => {
      try {
        const searchParams = new URLSearchParams();
        if (scope.type === 'project') searchParams.set('projectId', scope.projectId);
        const query = searchParams.toString();
        const response = await authFetch(`/api/ask/chats${query ? `?${query}` : ''}`);
        if (!response.ok) return;
        const data = (await response.json()) as {
          chats?: PersistedAskChat[];
          messages?: PersistedAskMessage[];
          research?: AskResearchEvidence[];
        };
        if (!isMounted) return;
        const restoredChats = restoreChatSessions(data.chats ?? [], data.messages ?? []);
        setChats(restoredChats);
        setActiveChatId((current) => restoredChats.some((chat) => chat.id === current)
          ? current
          : restoredChats[0]?.id ?? null);
        const researchStatus = researchStatusFromRecords(data.research ?? []);
        setSavedResearchMessageIds(researchStatus.savedMessageIds);
        setSavedContextMessageIds(researchStatus.savedContextMessageIds);
        setConfirmedAnswerMessageIds(researchStatus.confirmedAnswerMessageIds);
      } catch {
        // Keep the local cache visible when the database is temporarily unavailable.
      }
    };
    void fetchChatState();
    return () => {
      isMounted = false;
    };
  }, [hasLoadedPersistedState, scope, userId]);

  const handleNewChat = () => {
    const fresh = newChat();
    setDraftChat(fresh);
    setActiveChatId(fresh.id);
    setInput('');
    setError('');
    setSelectedSources(null);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const openSource = (message: ChatMessage, sourceId: string) => {
    const found = message.sources?.find((candidate) => candidate.id === sourceId);
    if (found) {
      setSelectedSources([found]);
      onViewSource?.(found);
    }
  };

  const conclusionFromAnswer = (text: string): string => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'));
    return lines[0] ?? text.trim();
  };

  const openResearchAction = (message: ChatMessage, mode: ResearchActionState['mode']) => {
    const questions = message.openQuestions ?? [];
    setResearchError('');
    setResearchAction({
      message,
      mode,
      text: conclusionFromAnswer(message.text),
      targetQuestionId: questions.length === 1 ? questions[0].id : '',
    });
  };

  const submitResearchAction = async () => {
    if (!researchAction || !activeChat) return;
    if (researchAction.mode === 'use_as_answer' && !researchAction.targetQuestionId) {
      setResearchError('Select the open question this answer should resolve.');
      return;
    }
    setResearchBusy(true);
    setResearchError('');
    try {
      const researchResponse = await authFetch('/api/ask/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          action: researchAction.mode,
          chatId: activeChat.id,
          assistantMessageId: researchAction.message.id,
          text: researchAction.text,
          ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
          ...(researchAction.mode === 'use_as_answer' ? { targetQuestionId: researchAction.targetQuestionId } : {}),
        }),
      });
      const researchBody = await researchResponse.json();
      if (!researchResponse.ok) throw new Error(researchBody.error ?? 'Action could not be completed.');
      if (researchAction.mode === 'save_as_context') {
        setSavedContextMessageIds((current) => new Set(current).add(researchAction.message.id));
      } else if (researchAction.mode === 'use_as_answer') {
        setConfirmedAnswerMessageIds((current) => new Set(current).add(researchAction.message.id));
      } else {
        setSavedResearchMessageIds((current) => new Set(current).add(researchAction.message.id));
      }
      setResearchAction(null);
    } catch (caught) {
      setResearchError(caught instanceof Error ? caught.message : 'Action failed.');
    } finally {
      setResearchBusy(false);
    }
  };

  const sendMessage = async (promptText: string) => {
    const text = promptText.trim();
    if (!text || isLoading) return;
    const userMsgId = `user_${Date.now()}`;
    const userMsg: ChatMessage = { id: userMsgId, role: 'user', text };
    const chatToUse = activeChat ?? newChat();
    const updatedMessages = [...chatToUse.messages, userMsg];
    const isNewFirstQuestion = !chatToUse.firstQuestion;
    const updatedChat: ChatSession = {
      ...chatToUse,
      firstQuestion: isNewFirstQuestion ? text : chatToUse.firstQuestion,
      title: isNewFirstQuestion ? titleForMessage(text) : chatToUse.title,
      messages: updatedMessages,
    };

    setChats((current) => {
      const index = current.findIndex((c) => c.id === updatedChat.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = updatedChat;
        return next;
      }
      return [updatedChat, ...current];
    });
    setDraftChat(null);
    setActiveChatId(updatedChat.id);
    setInput('');
    setIsLoading(true);
    setError('');

    try {
      const response = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          message: text,
          chatId: updatedChat.id,
          userMessageId: userMsgId,
          ...(chatToUse.sessionId ? { sessionId: chatToUse.sessionId } : {}),
          ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Ask failed.');

      const assistantMsg: ChatMessage = {
        id: data.assistantMessageId ?? `assistant_${Date.now()}`,
        role: 'assistant',
        text: data.answer,
        sources: data.sources,
        openQuestionIds: data.openQuestionIds,
        openQuestions: data.openQuestions,
        searchSuggestions: data.searchSuggestions,
        responseDetails: {
          promptUsed: data.promptUsed,
          systemPrompt: data.fallbackSystemPrompt,
          modelConfig: data.modelConfig,
          contextUsed: data.contextUsed,
        },
      };

      setChats((current) => current.map((chat) => {
        if (chat.id !== updatedChat.id) return chat;
        return {
          ...chat,
          sessionId: data.sessionId ?? chat.sessionId,
          messages: [...chat.messages, assistantMsg],
        };
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ask failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-5xl flex-col px-3 py-4 sm:min-h-[calc(100vh-5rem)] sm:px-6 sm:py-6 lg:px-8">
      <div className="border-b border-slate-800 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">ASK GAPWISE</p>
            <h1 className="mt-2 text-xl font-extrabold text-slate-100 sm:text-2xl">What should I focus on?</h1>
          </div>
          <button type="button" onClick={handleNewChat} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-200">
            <MessageSquarePlus className="h-3.5 w-3.5" /> New chat
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Gapwise uses your goals, memories, documents, calendar and other context to answer.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-cyan-300">Focused on: {scopeLabel}</p>
          {(chats.length > 0 || draftChat) && (
            <select
              aria-label="Choose chat"
              title={activeChat ? chatHoverLabel(activeChat) : undefined}
              value={activeChatId ?? ''}
              onChange={(event) => {
                setActiveChatId(event.target.value);
                setInput('');
                setError('');
              }}
              className="min-w-0 max-w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs font-semibold text-slate-300 outline-none focus:border-cyan-700"
            >
              {chatPickerOptions(chats, draftChat).map((option) => (
                <option key={option.id} value={option.id} title={option.title}>{option.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {activeChat?.messages.map((message) => {
          const hasWebSources = Boolean(message.sources?.some((s) => s.kind === 'web' && s.url));
          const hasOpenQuestions = Boolean(message.openQuestions && message.openQuestions.length > 0);

          return (
            <div
              key={message.id}
              className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-3xl rounded-2xl p-4 sm:p-5 ${
                  message.role === 'user'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'border border-slate-800 bg-slate-900 text-slate-200'
                }`}
              >
                {message.role === 'assistant' ? (
                  <div className="min-w-0 break-words">
                    {/* Status Badge */}
                    <div className="mb-3 flex items-center gap-2">
                      {hasWebSources ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-800 bg-cyan-950/60 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
                          <Globe className="h-3 w-3" /> Web-grounded response
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[10px] font-medium text-slate-300">
                          AI suggestion — not externally verified.
                        </span>
                      )}
                    </div>

                    <AssistantMarkdown onSourceOpen={(sourceId) => openSource(message, sourceId)}>
                      {addSourceCitations(message.text, message.sources ?? [])}
                    </AssistantMarkdown>

                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-800 pt-3">
                        <span className="mr-1 text-[10px] font-bold uppercase text-slate-500">Sources</span>
                        {message.sources.map((source, index) => {
                          const displayTitle = humanizeSourceTitle(source.title);
                          return (
                            <button
                              key={source.id}
                              type="button"
                              onClick={() => setSelectedSources([source])}
                              title={displayTitle}
                              className="min-h-9 max-w-full truncate rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-left text-[10px] font-semibold text-cyan-300 hover:border-cyan-700"
                            >
                              {index + 1}. {displayTitle}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Distinct Actions */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                      {/* Action 1: Save as context (Always available) */}
                      {savedContextMessageIds.has(message.id) ? (
                        <span className="text-xs font-semibold text-emerald-300">Saved as context.</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openResearchAction(message, 'save_as_context')}
                          className="min-h-10 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs font-bold text-slate-200 hover:border-cyan-700"
                        >
                          Save as context
                        </button>
                      )}

                      {/* Action 2: Use as my answer (Available when open questions exist) */}
                      {confirmedAnswerMessageIds.has(message.id) ? (
                        <span className="text-xs font-semibold text-emerald-300">Answer confirmed.</span>
                      ) : hasOpenQuestions ? (
                        <button
                          type="button"
                          onClick={() => openResearchAction(message, 'use_as_answer')}
                          className="min-h-10 rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-200 hover:border-amber-600"
                        >
                          Use as my answer
                        </button>
                      ) : null}

                      {/* Action 3: Save research (Available only when genuine web sources exist) */}
                      {hasWebSources && (
                        savedResearchMessageIds.has(message.id) ? (
                          <span className="text-xs font-semibold text-emerald-300">Research saved for this conversation.</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openResearchAction(message, 'save')}
                            className="min-h-10 rounded-lg border border-cyan-800 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-200 hover:border-cyan-600"
                          >
                            Save research
                          </button>
                        )
                      )}
                    </div>

                    {message.searchSuggestions && (
                      <details className="mt-3 border-t border-slate-800 pt-3">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 hover:text-cyan-300">
                          Google Search suggestions
                        </summary>
                        <div className="mt-2 space-y-2 text-xs text-slate-400">
                          {safeSearchSuggestionText(message.searchSuggestions) && (
                            <p className="whitespace-pre-wrap leading-relaxed">{safeSearchSuggestionText(message.searchSuggestions)}</p>
                          )}
                          {message.searchSuggestions.webSearchQueries && message.searchSuggestions.webSearchQueries.length > 0 && (
                            <p>Queries: {message.searchSuggestions.webSearchQueries.join(' · ')}</p>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-900/50 bg-rose-950/40 p-3 text-xs font-semibold text-rose-200" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="border-t border-slate-800 pt-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Gapwise anything about your projects, goals, or external knowledge..."
            className="w-full resize-none rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(input);
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            title="Send message"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>

      {/* Confirmation Modal */}
      {researchAction && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:items-center">
          <section role="dialog" aria-modal="true" aria-labelledby="ask-action-title" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">
                  {researchAction.mode === 'save_as_context' ? 'User Context' : researchAction.mode === 'use_as_answer' ? 'Answer Question' : 'Cited Web Research'}
                </p>
                <h2 id="ask-action-title" className="mt-1 text-lg font-bold text-slate-100">
                  {researchAction.mode === 'save_as_context' ? 'Save as context' : researchAction.mode === 'use_as_answer' ? 'Use as my answer' : 'Save research'}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {researchAction.mode === 'save_as_context'
                    ? 'Save this conclusion as user-confirmed context for this conversation and future reasoning.'
                    : researchAction.mode === 'use_as_answer'
                      ? 'Select which open question this conclusion resolves.'
                      : 'Review the proposed text and cited web sources.'}
                </p>
              </div>
              <button type="button" onClick={() => setResearchAction(null)} title="Close" className="h-10 w-10 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100">
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>

            {researchAction.mode === 'use_as_answer' && (
              <label className="mt-5 block text-xs font-bold text-slate-300">
                Question to answer
                <select
                  value={researchAction.targetQuestionId}
                  onChange={(event) => setResearchAction((current) => current ? { ...current, targetQuestionId: event.target.value } : current)}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-normal text-slate-200 outline-none focus:border-cyan-700"
                >
                  <option value="">Select an open question</option>
                  {(researchAction.message.openQuestions ?? []).map((question) => (
                    <option key={question.id} value={question.id}>{question.text}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="mt-5 block text-xs font-bold text-slate-300">
              {researchAction.mode === 'save_as_context' ? 'Confirmed context statement' : researchAction.mode === 'use_as_answer' ? 'Your confirmed conclusion' : 'Research statement'}
              <textarea
                value={researchAction.text}
                onChange={(event) => setResearchAction((current) => current ? { ...current, text: event.target.value } : current)}
                rows={5}
                className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-normal leading-relaxed text-slate-200 outline-none focus:border-cyan-700"
              />
            </label>

            {researchAction.mode === 'save' && (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Citations kept separately</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(researchAction.message.sources ?? []).filter((source) => source.kind === 'web' && source.url).map((source) => (
                    <a key={source.id} href={source.url} target="_blank" rel="noreferrer noopener" className="max-w-full truncate text-xs font-semibold text-cyan-300 underline decoration-cyan-800 underline-offset-2">
                      {source.title}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {researchError && <p className="mt-4 text-sm text-rose-300" role="alert">{researchError}</p>}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setResearchAction(null)} disabled={researchBusy} className="min-h-11 rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-500">
                Cancel
              </button>
              <button type="button" onClick={() => void submitResearchAction()} disabled={researchBusy || !researchAction.text.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-extrabold text-slate-950 disabled:opacity-50">
                {researchBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {researchAction.mode === 'save_as_context' ? 'Save as context' : researchAction.mode === 'use_as_answer' ? 'Confirm answer' : 'Save research'}
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedSources && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/70 backdrop-blur-sm sm:items-stretch">
          <aside ref={sourcesPanelRef} className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-950 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:border-t-0 sm:border-b-0 sm:border-r-0 sm:p-6 sm:pb-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-slate-100">Why / Sources</h2>
              <button type="button" onClick={() => setSelectedSources(null)} className="h-9 w-9 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100">
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              {selectedSources.map((source) => (
                <div key={source.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <h3 className="text-sm font-bold text-cyan-300">{humanizeSourceTitle(source.title)}</h3>
                  {source.url && (
                    <a href={source.url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-xs text-slate-400 underline">
                      {source.url}
                    </a>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{source.excerpt}</p>
                  {source.reason && <p className="mt-2 text-[11px] text-slate-500">{source.reason}</p>}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
