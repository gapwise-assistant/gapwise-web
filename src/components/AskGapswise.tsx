'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ChevronRight, Eye, EyeOff, Globe, Loader2, MessageSquarePlus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { AskContextProposal, AskExecution, AskOpenQuestion, AskResearchEvidence, AskResponseOutcome, AskSearchSuggestions, AskSource, AskTarget, normalizeAskContextProposals, PendingAskHandoff } from '@/types/ask';
import { AppScope, scopeStorageKey } from '@/types/scope';
import { AssistantMarkdown } from '@/components/AssistantMarkdown';
import { addSourceCitations } from '@/lib/ask/citations';
import { humanizeSourceTitle } from '@/lib/context/sourceTitle';
import { authFetch } from '@/lib/auth/client';
import { AskSourceModal } from '@/components/AskSourceModal';
import { formatDateTime } from '@/lib/datetime/displayDateTime';
import type { UserMemoryProfile } from '@/types/clarity';
import type { AccessTier } from '@/lib/auth/server';
import { Button } from '@/components/ui/Button';
import {
  normalizeAskSuggestionsAssessment,
  pollAskSuggestions,
  type AskSuggestionsAssessment,
  type AskSuggestionsResponseShape,
} from '@/lib/ask/suggestionsPolling';

interface AskGapswiseProps {
  userId: string;
  scope: AppScope;
  scopeLabel: string;
  profile?: UserMemoryProfile;
  initialPrompt?: string;
  autoSendInitialPrompt?: boolean;
  onInitialPromptSent?: () => void;
  newChatPrompt?: PendingAskHandoff | null;
  onNewChatPromptOpened?: () => void;
  onProjectContextChanged?: () => Promise<void>;
  onProjectUpdated?: () => void | Promise<void>;
  accessTier?: AccessTier | null;
  publicDemoMessagesRemaining?: number | null;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  outcome?: AskResponseOutcome;
  resolvesQuestionId?: string;
  conclusion?: string;
  contextProposals?: AskContextProposal[];
  proposals?: AskContextProposal[];
  sources?: AskSource[];
  openQuestionIds?: string[];
  openQuestions?: AskOpenQuestion[];
  searchSuggestions?: AskSearchSuggestions;
  execution?: AskExecution;
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

function proposalUiKey(messageId: string, proposal: AskContextProposal): string {
  return `${messageId}:${proposal.id ?? proposal.text}`;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  firstQuestion: string;
  sessionId: string | null;
  target?: AskTarget;
  messages: ChatMessage[];
}

interface PersistedAskChat {
  id: string;
  title: string;
  adkSessionId?: string;
  target?: AskTarget;
  createdAt: string;
  updatedAt: string;
}

interface PersistedAskMessage extends ChatMessage {
  chatId: string;
  createdAt: string;
}

interface ResearchActionState {
  message: ChatMessage;
  mode: 'save' | 'use_as_answer' | 'use_as_decision' | 'save_as_context';
  text: string;
  targetQuestionId: string;
  targetQuestionText?: string;
  targetDecisionId: string;
  targetDecisionText?: string;
}

function hiddenWorkspaceKey(userId: string, scope: AppScope): string {
  return `gapwise_ask_workspace_hidden_${userId}_${scopeStorageKey(scope)}`;
}

function newChat(target?: AskTarget): ChatSession {
  return {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New chat',
    createdAt: new Date().toISOString(),
    firstQuestion: '',
    sessionId: null,
    ...(target ? { target } : {}),
    messages: [],
  };
}

function titleForMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 42 ? `${compact.slice(0, 41).replace(/\s+\S*$/, '')}…` : compact || 'New chat';
}

function chatQuestion(chat: ChatSession): string {
  return chat.firstQuestion || chat.title || 'New chat';
}

function chatLabel(chat: ChatSession): string {
  return `${formatDateTime(chat.createdAt)} · ${titleForMessage(chatQuestion(chat))}`;
}

function chatHoverLabel(chat: ChatSession): string {
  return `${formatDateTime(chat.createdAt)} · ${chatQuestion(chat)}`;
}

function logAskBrowserDebug(stage: string, details: unknown): void {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV === 'production') return;
  if (!['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(window.location.hostname)) return;
  console.log(`[Gapwise Ask][browser] ${stage}`, details);
}

export function canonicalAskQuestions(questions: AskOpenQuestion[]): AskOpenQuestion[] {
  // The API already returns stored canonical question IDs. The UI must not
  // invent a second semantic grouping based on display text; that can hide a
  // genuinely distinct question or target the wrong graph node.
  const byId = new Map<string, AskOpenQuestion>();
  questions.forEach((question) => {
    if (!byId.has(question.id)) byId.set(question.id, question);
  });
  return Array.from(byId.values());
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

export function askHandoffMatchesScope(handoff: PendingAskHandoff, scope: AppScope): boolean {
  if (handoff.scopeType === 'project') {
    return scope.type === 'project' && scope.projectId === handoff.projectId;
  }
  return scope.type === 'everything';
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
      outcome: message.outcome,
      resolvesQuestionId: message.resolvesQuestionId,
      conclusion: message.conclusion,
      contextProposals: normalizeAskContextProposals(message.contextProposals ?? message.proposals),
      sources: message.sources,
      openQuestionIds: message.openQuestionIds,
      openQuestions: message.openQuestions,
      searchSuggestions: message.searchSuggestions,
      execution: message.execution,
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
      target: chat.target,
      messages,
    };
  });
}

export function canUseAskConclusion(
  message: Pick<ChatMessage, 'outcome' | 'resolvesQuestionId' | 'conclusion' | 'openQuestionIds'>,
): boolean {
  return message.outcome === 'conclusion'
    && Boolean(message.resolvesQuestionId)
    && Boolean(message.conclusion?.trim())
    && Boolean(message.openQuestionIds?.includes(message.resolvesQuestionId as string));
}

export function askResponseAction(
  message: Pick<ChatMessage, 'outcome' | 'resolvesQuestionId' | 'conclusion' | 'openQuestionIds'>,
): 'use_as_answer' | null {
  return canUseAskConclusion(message) ? 'use_as_answer' : null;
}

export async function refreshAskProjectBeforeCompletion(
  onProjectUpdated?: () => void | Promise<void>,
): Promise<void> {
  await onProjectUpdated?.();
}

export function canUseAskDecisionConclusion(
  message: Pick<ChatMessage, 'outcome' | 'conclusion'>,
): boolean {
  return message.outcome === 'conclusion' && Boolean(message.conclusion?.trim());
}

export function isClarificationResponse(message: Pick<ChatMessage, 'text' | 'execution'>): boolean {
  // Keep older persisted clarification messages safe when they predate the
  // two-route contract and do not have route metadata.
  return /^i\s+(?:do\s+not|don't)\s+have\s+enough\s+context\b[\s\S]*\b(?:clarif(?:y|ication)|more details|specific information)\b/i.test(message.text.trim());
}

export function researchStatusFromRecords(records: Array<Partial<AskResearchEvidence>>): {
  savedMessageIds: Set<string>;
  savedContextMessageIds: Set<string>;
  confirmedAnswerMessageIds: Set<string>;
  confirmedDecisionMessageIds: Set<string>;
} {
  const savedMessageIds = new Set<string>();
  const savedContextMessageIds = new Set<string>();
  const confirmedAnswerMessageIds = new Set<string>();
  const confirmedDecisionMessageIds = new Set<string>();

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
    if (record.action === 'use_as_decision' && record.status === 'confirmed') {
      confirmedDecisionMessageIds.add(record.assistantMessageId);
    }
    if (!record.action && !record.provenance) {
      savedMessageIds.add(record.assistantMessageId);
    }
  });

  return { savedMessageIds, savedContextMessageIds, confirmedAnswerMessageIds, confirmedDecisionMessageIds };
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
  profile,
  initialPrompt,
  autoSendInitialPrompt,
  onInitialPromptSent,
  newChatPrompt,
  onNewChatPromptOpened,
  onProjectContextChanged,
  onProjectUpdated,
  accessTier = null,
  publicDemoMessagesRemaining = null,
}: AskGapswiseProps) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [draftChat, setDraftChat] = useState<ChatSession | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedSources, setSelectedSources] = useState<AskSource[] | null>(null);
  const [isWorkspaceHidden, setIsWorkspaceHidden] = useState(false);
  const [suggestionsAssessment, setSuggestionsAssessment] = useState<AskSuggestionsAssessment | null>(null);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [isSuggestionRetrying, setIsSuggestionRetrying] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [suggestionsPollNonce, setSuggestionsPollNonce] = useState(0);
  const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(false);
  const [hasLoadedRemoteState, setHasLoadedRemoteState] = useState(false);
  const [researchAction, setResearchAction] = useState<ResearchActionState | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState('');
  const [savedResearchMessageIds, setSavedResearchMessageIds] = useState<Set<string>>(new Set());
  const [savedContextMessageIds, setSavedContextMessageIds] = useState<Set<string>>(new Set());
  const [confirmedAnswerMessageIds, setConfirmedAnswerMessageIds] = useState<Set<string>>(new Set());
  const [confirmedDecisionMessageIds, setConfirmedDecisionMessageIds] = useState<Set<string>>(new Set());
  const [proposalBusyIds, setProposalBusyIds] = useState<Set<string>>(new Set());
  const [hiddenProposalKeys, setHiddenProposalKeys] = useState<Set<string>>(new Set());
  const [shownProposalKeys, setShownProposalKeys] = useState<Set<string>>(new Set());
  const [publicMessagesRemaining, setPublicMessagesRemaining] = useState<number | null>(publicDemoMessagesRemaining);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionProjectIdRef = useRef<string | null>(null);
  const initialPromptSentRef = useRef<string | null>(null);
  const handledNewChatPromptRef = useRef<string | null>(null);
  const processingNewChatPromptRef = useRef<string | null>(null);
  const failedNewChatPromptRef = useRef<string | null>(null);

  const activeChat = useMemo(() => {
    if (draftChat && draftChat.id === activeChatId) return draftChat;
    if (activeChatId) return chats.find((chat) => chat.id === activeChatId) ?? null;
    return draftChat ?? chats[0] ?? null;
  }, [activeChatId, chats, draftChat]);
  const suggestionProjectId = scope.type === 'project' ? scope.projectId : null;
  const isPublicDemo = accessTier === 'public_demo';
  suggestionProjectIdRef.current = suggestionProjectId;

  useEffect(() => {
    if (typeof publicDemoMessagesRemaining === 'number') {
      setPublicMessagesRemaining(publicDemoMessagesRemaining);
    }
  }, [publicDemoMessagesRemaining]);

  useEffect(() => {
    setHasLoadedRemoteState(false);
    setChats([]);
    setActiveChatId(null);
    setSuggestionsAssessment(null);
    setIsSuggestionsLoading(scope.type === 'project');
    setIsSuggestionRetrying(false);
    setSuggestionsError('');
    setHiddenProposalKeys(new Set());
    setShownProposalKeys(new Set());
    setIsWorkspaceHidden(localStorage.getItem(hiddenWorkspaceKey(userId, scope)) === 'true');
    setSavedResearchMessageIds(new Set());
    setSavedContextMessageIds(new Set());
    setConfirmedAnswerMessageIds(new Set());
    setConfirmedDecisionMessageIds(new Set());
    setHasLoadedPersistedState(true);
  }, [scope, userId]);

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
        setConfirmedDecisionMessageIds(researchStatus.confirmedDecisionMessageIds);
      } catch {
        // The database is authoritative. Do not fall back to an older browser
        // copy when the persistent conversation request fails.
        if (!isMounted) return;
        setChats([]);
        setActiveChatId(null);
      } finally {
        if (isMounted) setHasLoadedRemoteState(true);
      }
    };
    void fetchChatState();
    return () => {
      isMounted = false;
    };
  }, [hasLoadedPersistedState, scope, userId]);

  useEffect(() => {
    if (!hasLoadedPersistedState) return;
    if (!suggestionProjectId) {
      setIsSuggestionsLoading(false);
      return;
    }

    let isActive = true;
    const controller = new AbortController();
    // Existing questions remain rendered while polling; this flag only drives
    // the empty-state skeleton while a read-only refresh is still pending.
    setIsSuggestionsLoading(true);
    setSuggestionsError('');

    const read = async (signal: AbortSignal): Promise<AskSuggestionsAssessment> => {
      const response = await authFetch(`/api/ask/suggestions?projectId=${encodeURIComponent(suggestionProjectId)}`, { signal });
      const data = await response.json() as AskSuggestionsResponseShape;
      if (!response.ok) throw new Error(data.error ?? 'Suggestions are unavailable right now.');
      return normalizeAskSuggestionsAssessment(data, suggestionProjectId);
    };

    void pollAskSuggestions({
      read,
      signal: controller.signal,
      onUpdate: (assessment) => {
        if (!isActive) return;
        setSuggestionsAssessment(assessment);
        setIsSuggestionsLoading(assessment.status === 'preparing' || assessment.status === 'stale');
      },
      onError: () => {
        if (!isActive) return;
        setSuggestionsAssessment((current) => ({
          ...(current ?? { topQuestions: [], otherQuestions: [], projectId: suggestionProjectId }),
          projectId: suggestionProjectId,
          status: 'failed',
        }));
        setSuggestionsError('Suggestions are unavailable right now.');
        setIsSuggestionsLoading(false);
      },
      onTimeout: () => {
        if (!isActive) return;
        setSuggestionsAssessment((current) => ({
          ...(current ?? { topQuestions: [], otherQuestions: [], projectId: suggestionProjectId }),
          projectId: suggestionProjectId,
          status: 'stale',
        }));
        setSuggestionsError('Suggestions are taking longer than expected. Retry when you are ready.');
        setIsSuggestionsLoading(false);
      },
    });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [hasLoadedPersistedState, suggestionProjectId, suggestionsPollNonce, userId]);

  const retrySuggestions = async () => {
    if (isPublicDemo || scope.type !== 'project' || isSuggestionRetrying) return;
    const retryProjectId = scope.projectId;
    setIsSuggestionRetrying(true);
    setSuggestionsError('');
    try {
      const response = await authFetch('/api/internal/ask/suggestions/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, projectId: scope.projectId }),
      });
      const data = await response.json() as {
        topQuestions?: unknown[];
        otherQuestions?: unknown[];
        projectId?: string;
        status?: string;
        semanticVersion?: string;
        generatedAt?: string;
        generatedBy?: string;
      };
      if (!response.ok) throw new Error('Suggestions are unavailable right now.');
      const assessment = normalizeAskSuggestionsAssessment(data, retryProjectId);
      if (suggestionProjectIdRef.current !== retryProjectId) return;
      setSuggestionsAssessment(assessment);
      // Restart the read-only poller so an older poll cannot overwrite the
      // explicit retry result for this project.
      setSuggestionsPollNonce((current) => current + 1);
    } catch {
      if (suggestionProjectIdRef.current === retryProjectId) {
        setSuggestionsError('Suggestions are unavailable right now.');
      }
    } finally {
      if (suggestionProjectIdRef.current === retryProjectId) setIsSuggestionRetrying(false);
    }
  };

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
    }
  };

  const openResearchAction = (message: ChatMessage, mode: ResearchActionState['mode']) => {
    const questions = canonicalAskQuestions(message.openQuestions ?? []);
    const target = activeChat?.target;
    const isDecision = mode === 'use_as_decision' || target?.type === 'decision';
    const actionMode = isDecision && mode === 'use_as_answer' ? 'use_as_decision' : mode;
    const modelQuestionTarget = canUseAskConclusion(message)
      ? message.resolvesQuestionId
      : undefined;
    setResearchError('');
    setResearchAction({
      message,
      mode: actionMode,
      text: actionMode === 'use_as_answer' || actionMode === 'use_as_decision'
        ? message.conclusion?.trim() ?? ''
        : message.text.trim(),
      targetQuestionId: !isDecision
        ? modelQuestionTarget ?? (target?.type === 'question' ? target.id : questions.length === 1 ? questions[0].id : '')
        : '',
      ...(target?.type === 'question' ? { targetQuestionText: target.text } : {}),
      targetDecisionId: isDecision && target?.type === 'decision' ? target.id : '',
      ...(isDecision && target?.type === 'decision' ? { targetDecisionText: target.text } : {}),
    });
  };

  const submitResearchAction = async () => {
    if (!researchAction || !activeChat) return;
    if (researchAction.mode === 'use_as_answer' && !researchAction.targetQuestionId) {
      setResearchError('Select the open question this answer should resolve.');
      return;
    }
    if (researchAction.mode === 'use_as_decision' && !researchAction.targetDecisionId) {
      setResearchError('This decision chat is missing its target. Reopen the decision and start the discussion again.');
      return;
    }
    if (researchAction.mode === 'use_as_answer'
      && (!canUseAskConclusion(researchAction.message)
        || researchAction.targetQuestionId !== researchAction.message.resolvesQuestionId)) {
      setResearchError('Only a conclusion that targets an open question can be used as its answer.');
      return;
    }
    if (researchAction.mode === 'use_as_decision' && !canUseAskDecisionConclusion(researchAction.message)) {
      setResearchError('Only a conclusion can be used as a decision.');
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
          ...(researchAction.mode === 'use_as_decision' ? { targetDecisionId: researchAction.targetDecisionId } : {}),
        }),
      });
      const researchBody = await researchResponse.json();
      if (!researchResponse.ok) throw new Error(researchBody.error ?? 'Action could not be completed.');
      if (researchAction.mode === 'save_as_context') {
        setSavedContextMessageIds((current) => new Set(current).add(researchAction.message.id));
      } else if (researchAction.mode === 'use_as_answer') {
        await refreshAskProjectBeforeCompletion(onProjectUpdated);
        setConfirmedAnswerMessageIds((current) => new Set(current).add(researchAction.message.id));
      } else if (researchAction.mode === 'use_as_decision') {
        await refreshAskProjectBeforeCompletion(onProjectUpdated);
        setConfirmedDecisionMessageIds((current) => new Set(current).add(researchAction.message.id));
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

  const updateProposalStatus = (messageId: string, proposal: AskContextProposal) => {
    setChats((current) => current.map((chat) => ({
      ...chat,
      messages: chat.messages.map((message) => message.id !== messageId
        ? message
        : (() => {
          const existing = normalizeAskContextProposals(message.contextProposals ?? message.proposals);
          const next = existing.map((candidate) => candidate.id === proposal.id ? proposal : candidate);
          return { ...message, contextProposals: next, proposals: next };
        })()),
    })));
  };

  const handleProposalAction = async (
    message: ChatMessage,
    proposal: AskContextProposal,
    action: 'add' | 'dismiss',
  ) => {
    const uiKey = proposalUiKey(message.id, proposal);
    if (action === 'dismiss') {
      setHiddenProposalKeys((current) => new Set(current).add(uiKey));
    }
    if (!proposal.id || proposalBusyIds.has(proposal.id)) return;
    setProposalBusyIds((current) => new Set(current).add(proposal.id as string));
    setError('');
    try {
      const response = await authFetch('/api/ask/proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          action,
          chatId: activeChat?.id,
          assistantMessageId: message.id,
          proposalId: proposal.id,
          ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
        }),
      });
      const body = await response.json() as { proposal?: AskContextProposal; error?: string };
      if (!response.ok || !body.proposal) throw new Error(body.error ?? 'The proposal action failed.');
      updateProposalStatus(message.id, body.proposal);
      await onProjectContextChanged?.();
    } catch (caught) {
      if (action === 'dismiss') {
        setHiddenProposalKeys((current) => {
          const next = new Set(current);
          next.delete(uiKey);
          return next;
        });
      }
      setError(caught instanceof Error ? caught.message : 'The proposal action failed.');
    } finally {
      setProposalBusyIds((current) => {
        const next = new Set(current);
        next.delete(proposal.id as string);
        return next;
      });
    }
  };

  const sendMessage = async (promptText: string, chatOverride?: ChatSession, allowWhileLoading = false) => {
    const text = promptText.trim();
    if (!text || (isLoading && !allowWhileLoading)) return;
    if (isPublicDemo && text.length > 300) {
      setError('Public demo messages must be 300 characters or fewer.');
      return;
    }
    if (isPublicDemo && publicMessagesRemaining === 0) {
      setError('Public demo complete. Full Gapwise access is currently private.');
      return;
    }
    const userMsgId = `user_${Date.now()}`;
    const userMsg: ChatMessage = { id: userMsgId, role: 'user', text };
    const chatToUse = chatOverride ?? activeChat ?? newChat();
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
      const requestBody = {
        userId,
        message: text,
        chatId: updatedChat.id,
        userMessageId: userMsgId,
        ...(chatToUse.sessionId ? { sessionId: chatToUse.sessionId } : {}),
        ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
        ...(chatToUse.target ? { target: chatToUse.target } : {}),
      };
      logAskBrowserDebug('api-request', { endpoint: '/api/ask', body: requestBody });
      const response = await authFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      logAskBrowserDebug('api-response', { status: response.status, body: data });
      if (!response.ok) throw new Error(data.error ?? 'Ask failed.');
      if (!isPublicDemo) await onProjectContextChanged?.();

      if (isPublicDemo && typeof data.publicDemo?.messagesRemaining === 'number') {
        setPublicMessagesRemaining(data.publicDemo.messagesRemaining);
      }

      const assistantMsg: ChatMessage = {
        id: data.assistantMessageId ?? `assistant_${Date.now()}`,
        role: 'assistant',
        text: data.answer,
        outcome: data.outcome,
        resolvesQuestionId: data.resolvesQuestionId,
        conclusion: data.conclusion,
        sources: data.sources,
        openQuestionIds: data.openQuestionIds,
        openQuestions: data.openQuestions,
        contextProposals: isPublicDemo ? [] : normalizeAskContextProposals(data.contextProposals ?? data.proposals),
        searchSuggestions: data.searchSuggestions,
        execution: data.execution,
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

  useEffect(() => {
    if (!hasLoadedPersistedState || !hasLoadedRemoteState || !newChatPrompt) return;
    if (handledNewChatPromptRef.current === newChatPrompt.id) return;
    if (processingNewChatPromptRef.current === newChatPrompt.id) return;
    if (failedNewChatPromptRef.current === newChatPrompt.id) return;
    if (!askHandoffMatchesScope(newChatPrompt, scope)) return;

    const handoff = newChatPrompt;
    const text = handoff.prompt.trim();
    if (!text) return;
    processingNewChatPromptRef.current = handoff.id;

    const persistHandoffChat = async (): Promise<ChatSession> => {
      const fresh = newChat(handoff.target);
      const response = await authFetch('/api/ask/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          chat: {
            id: fresh.id,
            scopeType: handoff.scopeType,
            ...(handoff.scopeType === 'project' && handoff.projectId ? { projectId: handoff.projectId } : {}),
            title: titleForMessage(text),
            target: handoff.target,
            createdAt: fresh.createdAt,
            updatedAt: fresh.createdAt,
          },
        }),
      });
      const body = await response.json().catch(() => ({})) as { chat?: PersistedAskChat; error?: string };
      if (!response.ok || !body.chat) {
        throw new Error(body.error ?? 'The discussion could not be started.');
      }
      return {
        ...fresh,
        title: body.chat.title || fresh.title,
        createdAt: body.chat.createdAt || fresh.createdAt,
        sessionId: body.chat.adkSessionId ?? null,
        target: body.chat.target ?? fresh.target,
      };
    };

    const startHandoff = async () => {
      try {
        const fresh = await persistHandoffChat();
        setChats((current) => [fresh, ...current.filter((chat) => chat.id !== fresh.id)]);
        setDraftChat(null);
        setActiveChatId(fresh.id);
        setInput('');
        setError('');
        handledNewChatPromptRef.current = handoff.id;
        failedNewChatPromptRef.current = null;
        onNewChatPromptOpened?.();
        await sendMessage(text, fresh, true);
      } catch (caught) {
        failedNewChatPromptRef.current = handoff.id;
        setError(caught instanceof Error ? caught.message : 'The discussion could not be started.');
      } finally {
        processingNewChatPromptRef.current = null;
      }
    };

    void startHandoff();
  }, [hasLoadedPersistedState, hasLoadedRemoteState, newChatPrompt, onNewChatPromptOpened, scope, sendMessage, userId]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const researchQuestions = researchAction
    ? canonicalAskQuestions(researchAction.message.openQuestions ?? [])
    : [];

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
            {isPublicDemo && (
              <p className="text-xs font-semibold text-slate-500" role="status">
                {publicMessagesRemaining === 0
                  ? 'Public demo complete. Full Gapwise access is currently private.'
                  : `Demo messages remaining: ${publicMessagesRemaining ?? 3}`}
              </p>
            )}
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

      {!activeChat?.messages.length && (
        <section className="mb-4 rounded-2xl border border-cyan-900/60 bg-cyan-950/20 p-4 sm:p-5" aria-labelledby="ask-suggestions-title">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
            <div>
              <h2 id="ask-suggestions-title" className="text-sm font-extrabold text-slate-100">Questions worth asking</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">Based on your goal and context, these are the three questions most likely to help you move forward.</p>
            </div>
          </div>
          {(isSuggestionsLoading && !suggestionsAssessment)
            || (isSuggestionsLoading
              && (suggestionsAssessment?.status === 'preparing' || suggestionsAssessment?.status === 'stale')
              && !suggestionsAssessment.topQuestions.length
              && !suggestionsAssessment.otherQuestions.length) ? (
            <div className="mt-4 space-y-2" aria-label="Loading suggested questions">
              {[1, 2, 3].map((item) => <div key={item} className="h-10 animate-pulse rounded-lg bg-slate-900/80" />)}
            </div>
          ) : suggestionsAssessment?.topQuestions.length ? (
            <div className="mt-4 grid gap-2">
              {suggestionsAssessment.topQuestions.slice(0, 3).map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => void sendMessage(question)}
                  disabled={isLoading}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-left text-xs font-semibold leading-relaxed text-slate-200 transition hover:border-cyan-700 hover:text-cyan-200 disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
              {suggestionsAssessment.status === 'preparing' && (
                <p className="text-xs text-slate-500" role="status">Updating suggestions…</p>
              )}
              {suggestionsAssessment.status === 'stale' && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500" role="status">
                  <span>Updating from the latest workspace changes…</span>
                  <Button type="button" variant="secondary" size="sm" loading={isSuggestionRetrying} onClick={() => void retrySuggestions()}>
                    Retry
                  </Button>
                </div>
              )}
              {suggestionsAssessment.status === 'failed' && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-amber-200" role="status">
                  <span>Suggestions could not be updated.</span>
                  <Button type="button" variant="secondary" size="sm" loading={isSuggestionRetrying} onClick={() => void retrySuggestions()}>
                    Retry
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{suggestionsError || (suggestionsAssessment?.status === 'failed'
                ? 'Suggestions are unavailable right now.'
                : suggestionsAssessment?.status === 'stale'
                  ? 'Updating from the latest workspace changes…'
                  : 'Suggestions are being prepared.')}</span>
              {(suggestionsAssessment?.status === 'failed' || suggestionsAssessment?.status === 'stale') && (
                <Button type="button" variant="secondary" size="sm" loading={isSuggestionRetrying} onClick={() => void retrySuggestions()}>
                  Retry
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {activeChat?.messages.map((message) => {
          const hasWebSources = Boolean(message.sources?.some((s) => s.kind === 'web' && s.url));
          const isClarification = message.role === 'assistant' && isClarificationResponse(message);
          const responseAction = !isPublicDemo && message.role === 'assistant' ? askResponseAction(message) : null;

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
                              onClick={() => openSource(message, source.id)}
                              title={displayTitle}
                              className="min-h-9 max-w-full truncate rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-left text-[10px] font-semibold text-cyan-300 hover:border-cyan-700"
                            >
                              {index + 1}. {displayTitle}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {(() => {
                      const contextProposals = isPublicDemo
                        ? []
                        : normalizeAskContextProposals(message.contextProposals ?? message.proposals);
                      const isHidden = (proposal: AskContextProposal) =>
                        (proposal.confirmationStatus === 'dismissed'
                          && !shownProposalKeys.has(proposalUiKey(message.id, proposal)))
                        || hiddenProposalKeys.has(proposalUiKey(message.id, proposal));
                      const visibleProposals = contextProposals.filter((proposal) => !isHidden(proposal));
                      const hiddenProposals = contextProposals.filter(isHidden);
                      const showHiddenProposals = () => {
                        setHiddenProposalKeys((current) => {
                          const next = new Set(current);
                          hiddenProposals.forEach((proposal) => next.delete(proposalUiKey(message.id, proposal)));
                          return next;
                        });
                        setShownProposalKeys((current) => {
                          const next = new Set(current);
                          hiddenProposals.forEach((proposal) => next.add(proposalUiKey(message.id, proposal)));
                          return next;
                        });
                      };
                      if (contextProposals.length === 0) return null;
                      return (
                        <>
                          {visibleProposals.length > 0 && (
                            <div className="mt-4 space-y-3 border-t border-slate-800 pt-3">
                              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-cyan-300">Potential workspace update</p>
                              {visibleProposals.map((proposal) => {
                                const proposalBusy = proposal.id ? proposalBusyIds.has(proposal.id) : false;
                                return (
                                  <div key={proposalUiKey(message.id, proposal)} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{proposal.type}</span>
                                      {proposal.confirmationStatus === 'added' && <span className="text-xs font-semibold text-emerald-300">Added to workspace</span>}
                                    </div>
                                    <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-200">{proposal.text}</p>
                                    {proposal.reasoning && <p className="mt-1 text-xs leading-relaxed text-slate-400">{proposal.reasoning}</p>}
                                    {(!proposal.confirmationStatus || proposal.confirmationStatus === 'pending' || proposal.confirmationStatus === 'proposed') && (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <Button
                                          variant="primary"
                                          size="sm"
                                          onClick={() => void handleProposalAction(message, proposal, 'add')}
                                          disabled={proposalBusy}
                                          loading={proposalBusy}
                                        >
                                          Add
                                        </Button>
                                        <Button
                                          variant="danger"
                                          size="sm"
                                          onClick={() => void handleProposalAction(message, proposal, 'dismiss')}
                                          disabled={proposalBusy}
                                          loading={proposalBusy}
                                        >
                                          Dismiss
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {hiddenProposals.length > 0 && (
                            <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
                              <span className="text-xs font-semibold text-slate-500">Potential workspace update dismissed</span>
                              <Button
                                variant="secondary"
                                onClick={showHiddenProposals}
                              >
                                Show
                              </Button>
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* Exploration and recommendations stay conversational. Only a
                        structured conclusion can enter the existing answer flow. */}
                    {!isClarification && responseAction === 'use_as_answer' && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                        {confirmedAnswerMessageIds.has(message.id) ? (
                          <span className="text-xs font-semibold text-emerald-300">Answer confirmed.</span>
                        ) : (
                          <Button
                            variant="primary"
                            onClick={() => openResearchAction(message, 'use_as_answer')}
                          >
                            Use as my answer
                          </Button>
                        )}
                      </div>
                    )}

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
            maxLength={isPublicDemo ? 300 : undefined}
            placeholder={isPublicDemo ? 'Ask about this demo workspace…' : 'Ask Gapwise anything about your workspaces, goals, or external knowledge...'}
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
            disabled={!input.trim() || isLoading || (isPublicDemo && publicMessagesRemaining === 0)}
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
                  {researchAction.mode === 'save_as_context' ? 'User Context' : researchAction.mode === 'use_as_decision' ? 'Workspace Decision' : researchAction.mode === 'use_as_answer' ? 'Answer Question' : 'Cited Web Research'}
                </p>
                <h2 id="ask-action-title" className="mt-1 text-lg font-bold text-slate-100">
                  {researchAction.mode === 'save_as_context' ? 'Save as context' : researchAction.mode === 'use_as_decision' ? 'Use as my decision' : researchAction.mode === 'use_as_answer' ? 'Use as my answer' : 'Save research'}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {researchAction.mode === 'save_as_context'
                    ? 'Save this conclusion as user-confirmed context for this conversation and future reasoning.'
                    : researchAction.mode === 'use_as_decision'
                      ? 'The discussion is guidance. Enter the concise decision you are making in the originating Decision workspace.'
                    : researchAction.mode === 'use_as_answer'
                      ? 'Select which open question this conclusion resolves.'
                      : 'Review the proposed text and cited web sources.'}
                </p>
              </div>
              <button type="button" onClick={() => setResearchAction(null)} title="Close" className="h-10 w-10 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100">
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>

            {researchAction.mode === 'use_as_answer' && !researchAction.targetQuestionText && researchQuestions.length > 1 && (
              <label className="mt-5 block text-xs font-bold text-slate-300">
                Question to answer
                <select
                  value={researchAction.targetQuestionId}
                  onChange={(event) => setResearchAction((current) => current ? { ...current, targetQuestionId: event.target.value } : current)}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-normal text-slate-200 outline-none focus:border-cyan-700"
                >
                  <option value="">Select an open question</option>
                  {researchQuestions.map((question) => (
                    <option key={question.id} value={question.id}>{question.text}</option>
                  ))}
                </select>
              </label>
            )}

            {researchAction.mode === 'use_as_answer' && researchAction.targetQuestionText && (
              <div className="mt-5 rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-300">Question this resolves</p>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-200">{researchAction.targetQuestionText}</p>
              </div>
            )}

            {researchAction.mode === 'use_as_decision' && researchAction.targetDecisionText && (
              <div className="mt-5 rounded-lg border border-violet-900/60 bg-violet-950/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-violet-300">Decision this resolves</p>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-200">{researchAction.targetDecisionText}</p>
              </div>
            )}

            {researchAction.mode === 'use_as_answer' && !researchAction.targetQuestionText && researchQuestions.length === 1 && (
              <div className="mt-5 rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-300">Question this resolves</p>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-200">{researchQuestions[0].text}</p>
              </div>
            )}

            <label className="mt-5 block text-xs font-bold text-slate-300">
              {researchAction.mode === 'save_as_context' ? 'Confirmed context statement' : researchAction.mode === 'use_as_decision' ? 'Your confirmed decision' : researchAction.mode === 'use_as_answer' ? 'Your confirmed conclusion' : 'Research statement'}
              <textarea
                value={researchAction.text}
                onChange={(event) => setResearchAction((current) => current ? { ...current, text: event.target.value } : current)}
                placeholder={researchAction.mode === 'use_as_decision' ? 'For example: I will ask someone to act as a spotter.' : undefined}
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
              <Button variant="ghost" size="md" onClick={() => setResearchAction(null)} disabled={researchBusy}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={() => void submitResearchAction()} disabled={!researchAction.text.trim()} loading={researchBusy}>
                {researchAction.mode === 'save_as_context' ? 'Save as context' : researchAction.mode === 'use_as_decision' ? 'Confirm decision' : researchAction.mode === 'use_as_answer' ? 'Confirm answer' : 'Save research'}
              </Button>
            </div>
          </section>
        </div>
      )}

      {selectedSources && (
        <AskSourceModal sources={selectedSources} onClose={() => setSelectedSources(null)} />
      )}
    </div>
  );
}
