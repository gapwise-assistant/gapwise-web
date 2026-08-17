'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ChevronRight, Eye, EyeOff, Loader2, MessageSquarePlus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { AskSource } from '@/lib/ask/adkClient';
import { AppScope, scopeStorageKey } from '@/types/scope';
import { AssistantMarkdown } from '@/components/AssistantMarkdown';
import { addSourceCitations } from '@/lib/ask/citations';
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
  responseDetails?: {
    promptUsed: string;
    systemPrompt?: string;
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
  return [
    ...(draftChat ? [{ id: draftChat.id, label: 'New chat (unsent)', title: chatHoverLabel(draftChat) }] : []),
    ...chats.map((chat) => ({ id: chat.id, label: chatLabel(chat), title: chatHoverLabel(chat) })),
  ];
}

function normalizeChat(chat: ChatSession): ChatSession {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const firstQuestion = typeof chat.firstQuestion === 'string' && chat.firstQuestion
    ? chat.firstQuestion
    : messages.find((message) => message?.role === 'user')?.text ?? '';
  return {
    ...chat,
    title: firstQuestion ? titleForMessage(firstQuestion) : chat.title || 'New chat',
    createdAt: typeof chat.createdAt === 'string' && !Number.isNaN(new Date(chat.createdAt).getTime())
      ? chat.createdAt
      : new Date().toISOString(),
    firstQuestion,
    messages,
  };
}

export const AskGapswise: React.FC<AskGapswiseProps> = ({ userId, scope, scopeLabel, initialPrompt, autoSendInitialPrompt, onInitialPromptSent, newChatPrompt, onNewChatPromptOpened, onViewSource }) => {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [draftChat, setDraftChat] = useState<ChatSession | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [showWorkspaceQuestions, setShowWorkspaceQuestions] = useState(true);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedPrompts, setSuggestedPrompts] = useState<SuggestedQuestionGroups>({ top: [], other: [] });
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [suggestionsWarning, setSuggestionsWarning] = useState('');
  const [error, setError] = useState('');
  const [selectedSources, setSelectedSources] = useState<AskSource[] | null>(null);
  const initialPromptSentRef = useRef('');
  const newChatPromptHandledRef = useRef('');
  const sourcesPanelRef = useRef<HTMLElement | null>(null);
  useDismissibleModal(() => setSelectedSources(null), sourcesPanelRef, Boolean(selectedSources));
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [hydratedScope, setHydratedScope] = useState('');
  const activeChat = chats.find((chat) => chat.id === activeChatId)
    ?? (draftChat?.id === activeChatId ? draftChat : null)
    ?? chats[0]
    ?? null;
  const messages = activeChat?.messages ?? [];
  const sessionId = activeChat?.sessionId ?? null;
  const openSource = (message: ChatMessage, sourceId: string) => {
    const source = message.sources?.find((item) => item.id === sourceId);
    if (source) setSelectedSources([source]);
  };
  const topPrompts = useMemo(() => suggestedPrompts.top.slice(0, 3), [suggestedPrompts.top]);
  const otherPrompts = useMemo(() => suggestedPrompts.other.slice(0, 3), [suggestedPrompts.other]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageScope = `${userId}:${scopeStorageKey(scope)}`;
    const storedChats = localStorage.getItem(chatsStorageKey(userId, scope));
    const legacySessionId = localStorage.getItem(sessionStorageKey(userId, scope));
    const legacyMessages = localStorage.getItem(messagesStorageKey(userId, scope));
    let loadedChats: ChatSession[] = [];
    try {
      if (storedChats) loadedChats = JSON.parse(storedChats) as ChatSession[];
    } catch {
      loadedChats = [];
    }
    if (!Array.isArray(loadedChats) || loadedChats.length === 0) {
      let messages: ChatMessage[] = [];
      try { messages = legacyMessages ? JSON.parse(legacyMessages) as ChatMessage[] : []; } catch { messages = []; }
      const firstQuestion = messages.find((message) => message?.role === 'user')?.text ?? '';
      loadedChats = firstQuestion || legacySessionId
        ? [{ id: `chat_legacy_${Date.now()}`, title: firstQuestion ? titleForMessage(firstQuestion) : 'New chat', createdAt: new Date().toISOString(), firstQuestion, sessionId: legacySessionId, messages: Array.isArray(messages) ? messages : [] }]
        : [];
    }
    loadedChats = loadedChats.map(normalizeChat).filter((chat) => Boolean(chat.firstQuestion.trim() || chat.messages.some((message) => message.role === 'user')));
    setChats(loadedChats);
    setDraftChat(null);
    setActiveChatId(loadedChats[0]?.id ?? null);
    setShowWorkspaceQuestions(localStorage.getItem(hiddenWorkspaceKey(userId, scope)) !== 'true');
    setHydratedScope(storageScope);
    setInput('');
    setError('');
  }, [userId, scope]);

  useEffect(() => {
    const storageScope = `${userId}:${scopeStorageKey(scope)}`;
    if (typeof window === 'undefined' || hydratedScope !== storageScope || chats.length === 0) return;
    localStorage.setItem(chatsStorageKey(userId, scope), JSON.stringify(chats.map((chat) => ({ ...chat, messages: chat.messages.slice(-20) }))));
  }, [chats, hydratedScope, userId, scope]);

  useEffect(() => {
    const storageScope = `${userId}:${scopeStorageKey(scope)}`;
    if (typeof window === 'undefined' || hydratedScope !== storageScope) return;
    localStorage.setItem(hiddenWorkspaceKey(userId, scope), showWorkspaceQuestions ? 'false' : 'true');
  }, [hydratedScope, showWorkspaceQuestions, userId, scope]);

  useEffect(() => {
    if (typeof initialPrompt === 'string' && initialPrompt.trim()) setInput(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    const storageScope = `${userId}:${scopeStorageKey(scope)}`;
    if (!newChatPrompt || hydratedScope !== storageScope || newChatPromptHandledRef.current === newChatPrompt.id) return;
    newChatPromptHandledRef.current = newChatPrompt.id;
    const chat = newChat();
    setDraftChat(chat);
    setActiveChatId(chat.id);
    setInput(newChatPrompt.text);
    setError('');
    onNewChatPromptOpened?.();
  }, [hydratedScope, newChatPrompt, onNewChatPromptOpened, scope, userId]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingSuggestions(true);
    setSuggestionsError('');
    setSuggestionsWarning('');
    setSuggestedPrompts({ top: [], other: [] });

    authFetch('/api/ask/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        scopeLabel,
        ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Contextual suggestions are unavailable right now.');
        const top = Array.isArray(body.topQuestions)
          ? body.topQuestions
          : Array.isArray(body.suggestions)
            ? body.suggestions
            : [];
        const other = Array.isArray(body.otherQuestions) ? body.otherQuestions : [];
        if (top.length === 0 && other.length === 0) {
          throw new Error('No contextual suggestions were returned.');
        }
        setSuggestedPrompts({
          top: top.filter((item: unknown): item is string => typeof item === 'string').slice(0, 3),
          other: other.filter((item: unknown): item is string => typeof item === 'string').slice(0, 3),
        });
        setSuggestionsWarning(typeof body.warning === 'string' ? body.warning : '');
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setSuggestionsError(caught instanceof Error ? caught.message : 'Contextual suggestions are unavailable right now.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingSuggestions(false);
      });

    return () => controller.abort();
  }, [scope, scopeLabel, userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, activeChatId]);

  const updateChat = (chatId: string, update: (chat: ChatSession) => ChatSession) => {
    setChats((current) => current.map((chat) => chat.id === chatId ? update(chat) : chat));
  };

  const handleNewChat = () => {
    const chat = newChat();
    setDraftChat(chat);
    setActiveChatId(chat.id);
    setInput('');
    setError('');
  };

  const handleDeleteChat = () => {
    if (!activeChatId || typeof window === 'undefined' || !window.confirm('Delete this chat?')) return;
    if (draftChat?.id === activeChatId) {
      setDraftChat(null);
      setActiveChatId(chats[0]?.id ?? null);
      setInput('');
      setError('');
      return;
    }
    const activeIndex = chats.findIndex((chat) => chat.id === activeChatId);
    if (activeIndex < 0) return;
    const remaining = chats.filter((chat) => chat.id !== activeChatId);
    const nextActive = remaining.length > 0 ? remaining[Math.min(activeIndex, remaining.length - 1)] : null;
    setChats(remaining);
    setDraftChat(null);
    setActiveChatId(nextActive?.id ?? null);
    setInput('');
    setError('');
  };

  const sendMessage = async (text: string) => {
    const message = text.trim();
    if (!message || isLoading) return;
    let chatId = activeChatId;
    let baseChat = activeChat;
    if (!chatId) {
      const chat = newChat();
      chatId = chat.id;
      baseChat = chat;
      setDraftChat(chat);
      setActiveChatId(chat.id);
    }
    if (!baseChat) return;
    setError('');
    setInput('');
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: message,
    };
    const updatedChat: ChatSession = {
      ...baseChat,
      title: baseChat.messages.length === 0 ? titleForMessage(message) : baseChat.title,
      firstQuestion: baseChat.messages.length === 0 ? message : baseChat.firstQuestion,
      messages: [...baseChat.messages, userMessage],
    };
    const isDraft = draftChat?.id === chatId || !chats.some((chat) => chat.id === chatId);
    if (isDraft) {
      setChats((current) => current.some((chat) => chat.id === chatId)
        ? current.map((chat) => chat.id === chatId ? updatedChat : chat)
        : [...current, updatedChat]);
      setDraftChat((current) => current?.id === chatId ? null : current);
    } else {
      updateChat(chatId, () => updatedChat);
    }
    setIsLoading(true);

    try {
      const response = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          message,
          ...(baseChat.sessionId ? { sessionId: baseChat.sessionId } : {}),
          ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Gapwise agent is unavailable right now.');
      if (body.sessionId && typeof body.sessionId === 'string') {
        updateChat(chatId, (chat) => ({ ...chat, sessionId: body.sessionId }));
      }
      const promptUsed = typeof body.promptUsed === 'string'
        ? body.promptUsed
        : typeof body.fallbackPrompt === 'string'
          ? body.fallbackPrompt
          : undefined;
      const responseDetails = promptUsed
        ? {
            promptUsed,
            systemPrompt: typeof body.fallbackSystemPrompt === 'string' ? body.fallbackSystemPrompt : undefined,
            contextUsed: body.contextUsed && typeof body.contextUsed === 'object'
              && typeof body.contextUsed.projectTitle === 'string'
              && Array.isArray(body.contextUsed.items)
              ? {
                  projectTitle: body.contextUsed.projectTitle,
                  items: body.contextUsed.items.filter((item: unknown): item is string => typeof item === 'string'),
                }
              : undefined,
          }
        : undefined;
      updateChat(chatId, (chat) => ({
        ...chat,
        messages: [...chat.messages, {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          text: body.answer,
          sources: Array.isArray(body.sources) ? body.sources : [],
          ...(responseDetails ? { responseDetails } : {}),
        }],
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gapwise agent is unavailable right now.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const prompt = initialPrompt?.trim() ?? '';
    const storageScope = `${userId}:${scopeStorageKey(scope)}`;
    if (!autoSendInitialPrompt || !prompt || hydratedScope !== storageScope || initialPromptSentRef.current === prompt) return;
    initialPromptSentRef.current = prompt;
    void sendMessage(prompt);
    onInitialPromptSent?.();
  }, [autoSendInitialPrompt, hydratedScope, initialPrompt, onInitialPromptSent, scope, userId]);

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
          <button type="button" onClick={handleDeleteChat} aria-label="Delete chat" title="Delete chat" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 text-slate-500 hover:border-rose-900 hover:bg-rose-950/30 hover:text-rose-300">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 py-5">
        {showWorkspaceQuestions && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                Suggestions
              </div>
              <button
                type="button"
                onClick={() => setShowWorkspaceQuestions(false)}
                aria-label="Hide suggestions"
                title="Hide suggestions"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-cyan-300"
              >
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            </div>
            {isLoadingSuggestions && (
              <div className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                Finding useful questions from {scopeLabel}...
              </div>
            )}
            {!isLoadingSuggestions && (topPrompts.length > 0 || otherPrompts.length > 0) && (
              <div className="mt-4 space-y-4">
                {topPrompts.length > 0 && (
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400">Top questions</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {topPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => sendMessage(prompt)}
                          className="min-h-11 rounded-lg border border-cyan-900/70 bg-slate-950 px-3 py-3 text-left text-sm font-semibold text-slate-200 hover:border-cyan-700 hover:text-cyan-300 sm:min-h-0"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {otherPrompts.length > 0 && (
                  <div className="border-t border-slate-800 pt-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Other ideas</p>
                    <div className="flex flex-wrap gap-2">
                      {otherPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => sendMessage(prompt)}
                          className="min-h-11 rounded-full border border-slate-800 bg-slate-950 px-3 py-2 text-left text-xs font-semibold text-slate-400 hover:border-cyan-800 hover:text-cyan-300 sm:min-h-0"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!isLoadingSuggestions && suggestionsError && (
              <p className="mt-4 text-xs text-slate-500">{suggestionsError} You can still ask Gapwise anything below.</p>
            )}
            {!isLoadingSuggestions && suggestionsWarning && (
              <p className="mt-4 text-[11px] text-slate-500" role="status">{suggestionsWarning}</p>
            )}
          </div>
        )}

        {!showWorkspaceQuestions && (
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 px-4 py-3 text-xs text-slate-500">
            Suggestions are hidden for this project. <button type="button" onClick={() => setShowWorkspaceQuestions(true)} aria-label="See suggestions" title="See suggestions" className="ml-1 inline-flex h-7 w-7 translate-y-1 items-center justify-center rounded-md text-cyan-300 hover:bg-slate-800 hover:text-cyan-200"><Eye className="h-3.5 w-3.5" /></button>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[94%] rounded-2xl px-4 py-3 text-sm shadow-lg sm:max-w-[74%] ${
                  message.role === 'user'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'border border-slate-800 bg-slate-900 text-slate-200'
                }`}
              >
                {message.role === 'assistant' ? (
                  <div className="min-w-0 break-words">
                    <AssistantMarkdown onSourceOpen={(sourceId) => openSource(message, sourceId)}>
                      {addSourceCitations(message.text, message.sources ?? [])}
                    </AssistantMarkdown>
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-800 pt-3">
                        <span className="mr-1 text-[10px] font-bold uppercase text-slate-500">Sources</span>
                        {message.sources.map((source, index) => (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => setSelectedSources([source])}
                            title={source.title}
                            className="min-h-9 max-w-full truncate rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-left text-[10px] font-semibold text-cyan-300 hover:border-cyan-700"
                          >
                            {index + 1}. {source.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {message.responseDetails && (
                      <details className="mt-3 border-t border-slate-800 pt-3">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 hover:text-cyan-300">
                          Response details
                        </summary>
                        <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
                          <div>
                            <p className="font-bold uppercase tracking-[0.1em] text-slate-500">Exact prompt sent to the AI</p>
                            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">{message.responseDetails.promptUsed}</pre>
                          </div>
                          {message.responseDetails.systemPrompt && (
                            <div>
                              <p className="font-bold uppercase tracking-[0.1em] text-slate-500">Fallback system instruction</p>
                              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-400">{message.responseDetails.systemPrompt}</p>
                            </div>
                          )}
                          {message.responseDetails.contextUsed && (
                            <div>
                              <p className="font-bold uppercase tracking-[0.1em] text-slate-500">Project context used</p>
                              <p className="mt-1 text-cyan-300">{message.responseDetails.contextUsed.projectTitle}</p>
                              <ul className="mt-2 space-y-1 text-slate-400">
                                {message.responseDetails.contextUsed.items.map((item) => <li key={item}>• {item}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                )}
                {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedSources(message.sources ?? [])}
                    className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-cyan-300 sm:min-h-0"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    Why / Sources
                  </button>
                )}
              </div>
            </article>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                        Gapwise is checking your context...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="sticky bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom))] z-20 pb-1 md:bottom-4 md:pb-0">
        <div className="flex gap-2 rounded-2xl border border-slate-800 bg-slate-950/95 p-2 shadow-2xl backdrop-blur">
          <textarea
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
            placeholder="Ask Gapwise..."
            className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            title="Send message"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-slate-950 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>

      {selectedSources && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/70 backdrop-blur-sm sm:items-stretch">
          <aside ref={sourcesPanelRef} className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-950 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:border-t-0 sm:border-b-0 sm:border-r-0 sm:p-6 sm:pb-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-slate-100">Why / Sources</h2>
              <button
                type="button"
                onClick={() => setSelectedSources(null)}
                title="Close sources"
                className="h-11 w-11 rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-slate-100 sm:h-auto sm:w-auto"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {selectedSources.map((source) => (
                <article key={source.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="font-bold text-slate-300">{source.title}</span>
                    {source.score !== undefined && (
                      <span className="text-cyan-400">{Math.round(source.score * 100)}% match</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{source.excerpt}</p>
                  {source.reason && (
                    <div className="mt-3 rounded-lg border border-cyan-900 bg-cyan-950/40 p-3">
                      <p className="text-[10px] font-bold uppercase text-cyan-400">Why this supports the answer</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-300">{source.reason}</p>
                    </div>
                  )}
                  {onViewSource && (
                    <button
                      type="button"
                      onClick={() => {
                        onViewSource(source);
                        setSelectedSources(null);
                      }}
                      className="mt-3 inline-flex min-h-11 items-center text-xs font-bold text-cyan-300 hover:text-cyan-200 sm:min-h-0"
                    >
                      {source.kind === 'source'
                        ? 'View in Context'
                        : source.kind === 'calendar'
                          ? 'View connection'
                          : 'View in context'}
                      <ChevronRight className="ml-1 inline h-3.5 w-3.5" />
                    </button>
                  )}
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
