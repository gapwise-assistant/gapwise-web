'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ChevronRight, Loader2, Send, Sparkles, X } from 'lucide-react';
import { AskSource } from '@/lib/ask/adkClient';
import { AppScope, scopeStorageKey } from '@/types/scope';
import { AssistantMarkdown } from '@/components/AssistantMarkdown';
import { addSourceCitations } from '@/lib/ask/citations';
import type { SuggestedQuestionGroups } from '@/lib/ask/suggestions';
import { authFetch } from '@/lib/auth/client';

interface AskGapswiseProps {
  userId: string;
  scope: AppScope;
  scopeLabel: string;
  onViewSource?: (source: AskSource) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: AskSource[];
}

function sessionStorageKey(userId: string, scope: AppScope): string {
  return `gapwise_ask_session_${userId}_${scopeStorageKey(scope)}`;
}

function messagesStorageKey(userId: string, scope: AppScope): string {
  return `gapwise_ask_messages_${userId}_${scopeStorageKey(scope)}`;
}

export const AskGapswise: React.FC<AskGapswiseProps> = ({ userId, scope, scopeLabel, onViewSource }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedPrompts, setSuggestedPrompts] = useState<SuggestedQuestionGroups>({ top: [], other: [] });
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [error, setError] = useState('');
  const [selectedSources, setSelectedSources] = useState<AskSource[] | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const hasConversation = messages.length > 0;
  const openSource = (message: ChatMessage, sourceId: string) => {
    const source = message.sources?.find((item) => item.id === sourceId);
    if (source) setSelectedSources([source]);
  };
  const topPrompts = useMemo(() => suggestedPrompts.top.slice(0, 3), [suggestedPrompts.top]);
  const otherPrompts = useMemo(() => suggestedPrompts.other.slice(0, 3), [suggestedPrompts.other]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setSessionId(localStorage.getItem(sessionStorageKey(userId, scope)));
    const stored = localStorage.getItem(messagesStorageKey(userId, scope));
    if (!stored) {
      setMessages([]);
      return;
    }
    try {
      setMessages(JSON.parse(stored) as ChatMessage[]);
    } catch {
      setMessages([]);
    }
  }, [userId, scope]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingSuggestions(true);
    setSuggestionsError('');
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
    if (typeof window !== 'undefined') {
      localStorage.setItem(messagesStorageKey(userId, scope), JSON.stringify(messages.slice(-20)));
    }
  }, [messages, userId, scope]);

  const sendMessage = async (text: string) => {
    const message = text.trim();
    if (!message || isLoading) return;
    setError('');
    setInput('');
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: message,
    };
    setMessages((current) => [...current, userMessage]);
    setIsLoading(true);

    try {
      const response = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          message,
          ...(sessionId ? { sessionId } : {}),
          ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Gapswise agent is unavailable right now.');
      if (body.sessionId && typeof body.sessionId === 'string') {
        setSessionId(body.sessionId);
        localStorage.setItem(sessionStorageKey(userId, scope), body.sessionId);
      }
      setMessages((current) => [
        ...current,
        {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          text: body.answer,
          sources: Array.isArray(body.sources) ? body.sources : [],
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gapswise agent is unavailable right now.');
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
        <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">ASK GAPSWISE</p>
        <h1 className="mt-2 text-xl font-extrabold text-slate-100 sm:text-2xl">What should I focus on?</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Gapswise uses your goals, memories, documents, calendar and other context to answer.
        </p>
        <p className="mt-3 text-xs font-semibold text-cyan-300">Focused on: {scopeLabel}</p>
      </div>

      <div className="flex-1 space-y-5 py-5">
        {!hasConversation && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              Questions for this context
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
              <p className="mt-4 text-xs text-slate-500">{suggestionsError} You can still ask Gapswise anything below.</p>
            )}
          </div>
        )}

        {hasConversation && (topPrompts.length > 0 || otherPrompts.length > 0) && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {topPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  className="min-h-10 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-cyan-300 sm:min-h-0"
                >
                  {prompt}
                </button>
              ))}
            </div>
            {otherPrompts.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-1">
                {otherPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    className="min-h-10 rounded-full border border-slate-900 bg-slate-950 px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:border-slate-700 hover:text-slate-300 sm:min-h-0"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
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
                Gapswise is checking your context...
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
            placeholder="Ask Gapswise..."
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
          <aside className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-950 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:border-t-0 sm:border-b-0 sm:border-r-0 sm:p-6 sm:pb-6">
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
                          : 'View in You'}
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
