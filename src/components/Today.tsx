'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AttentionCandidate, DailyBrief, RecommendationStatus } from '@/types/attention';
import { FeedbackEvent } from '@/types/feedback';
import { updateRecommendationStatus } from '@/lib/attention/generateBrief';
import { buildComingUp, buildTodayQuestions, openTodayDecisions, todayQuestionFromNode, TodayQuestion } from '@/lib/today/sections';
import {
  hasUsefulSuggestedAnswer,
  localQuestionPresentations,
  localQuestionSuggestions,
  normalizeQuestionPlanRequest,
  parseQuestionPresentations,
  QuestionPlanRequestInput,
  TodayQuestionPresentation,
  TodayQuestionSuggestion,
} from '@/lib/today/questionPlans';
import { buildTodayFeed, compactQuestionContext, compactQuestionReason } from '@/lib/today/feed';
import { AppScope } from '@/types/scope';
import { authFetch } from '@/lib/auth/client';
import { OpenQuestions, OpenQuestionRowItem } from '@/components/OpenQuestions';
import { RecommendedFocus } from '@/components/RecommendedFocus';
import { canonicalQuestionGroups, semanticallyEquivalentQuestion } from '@/lib/questions/canonical';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { isNextActionSatisfied } from '@/lib/actions/completion';
import { focusAssessmentToGuidance } from '@/lib/focus/presentation';
import { isLocalhostBrowser } from '@/lib/runtime/localhost';
import { formatDateOnly } from '@/lib/datetime/displayDateTime';
import { Button } from '@/components/ui/Button';

interface TodayProps {
  userId: string;
  project: Project;
  projectRefreshVersion: number;
  scope: AppScope;
  memories: DurableMemory[];
  feedbackEvents: FeedbackEvent[];
  onUpdateMemories: (updated: DurableMemory[]) => void;
  onFeedbackEvent: (event: FeedbackEvent) => void;
  onUpdateProfile?: (profile: import('@/types/clarity').UserMemoryProfile) => void;
  profile?: import('@/types/clarity').UserMemoryProfile;
  onAnswerQuestion?: (question: TodayQuestion) => void;
  onViewResolvedGaps?: () => void;
  onReviewDecision?: (nodeId: string) => void;
  onNavigateToSource?: (sourceId: string) => void;
  onViewReasoningPath?: (nodeId: string) => void;
}

type TodayLoadState = 'loading' | 'ready' | 'error';

function todayScopeKey(scope: AppScope): string {
  return scope.type === 'project' ? `project:${scope.projectId}` : 'everything';
}

function todayProjectStateKey(
  project: Project,
  memories: DurableMemory[],
  scope: AppScope,
  profile?: UserMemoryProfile,
): string {
  return JSON.stringify({
    scope: todayScopeKey(scope),
    project: {
      id: project.id,
      title: project.title,
      goal: project.goal,
      deadline: project.deadline ?? null,
      nodes: project.nodes
        .filter((node) => node.status !== 'DEPRECATED')
        .map((node) => ({
          id: node.id,
          type: node.type,
          text: node.text,
          status: node.status,
          confidence: node.confidence,
          impact: node.impact,
          decision_outcome: node.decision_outcome ?? null,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      edges: project.edges
        .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }))
        .sort((left, right) => `${left.source}:${left.type}:${left.target}`.localeCompare(`${right.source}:${right.type}:${right.target}`)),
    },
    memories: memories
      .map((memory) => ({
        category: memory.category,
        text: memory.text,
        source: memory.source,
        confidence: memory.confidence,
        status: memory.status ?? 'active',
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    profile: profile
      ? {
        answer_density: profile.answer_density,
        question_frequency: profile.question_frequency,
        challenge_level: profile.challenge_level,
        evidence_preference: profile.evidence_preference,
        brainstorm_style: profile.brainstorm_style,
        uncertainty_style: profile.uncertainty_style,
        durable_notes: [...(profile.durable_notes ?? [])].sort(),
      }
      : null,
  });
}

function TodaySkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading Today">
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />)}
      </div>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="h-2.5 w-28 animate-pulse rounded bg-slate-800" />
        <div className="mt-4 h-5 w-4/5 animate-pulse rounded bg-slate-800" />
        <div className="mt-3 h-9 w-36 animate-pulse rounded bg-slate-800" />
      </section>
      {[0, 1].map((item) => (
        <section key={item} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="h-2.5 w-24 animate-pulse rounded bg-slate-800" />
          <div className="mt-4 space-y-3">
            <div className="h-4 w-5/6 animate-pulse rounded bg-slate-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-800" />
          </div>
        </section>
      ))}
    </div>
  );
}

function TodayUnavailable() {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
      <h2 className="text-sm font-bold text-slate-200">Today is temporarily unavailable</h2>
      <p className="mt-2 text-xs text-slate-500">The current attention assessment could not be loaded.</p>
    </section>
  );
}

function valueAtPath(value: unknown, path: unknown[]): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (typeof segment === 'number' && Array.isArray(current)) return current[segment];
    if (typeof segment === 'string' && current && typeof current === 'object') {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

function logQuestionPlanValidation(body: unknown, request: QuestionPlanRequestInput): void {
  if (!isLocalhostBrowser() || !body || typeof body !== 'object') return;
  const issues = (body as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return;
  console.warn('[Gapwise Today question plans validation]', issues.map((issue) => {
    const record = issue && typeof issue === 'object' ? issue as Record<string, unknown> : {};
    const path = Array.isArray(record.path) ? record.path : [];
    const received = valueAtPath(request, path);
    return {
      path: path.join('.'),
      rule: typeof record.code === 'string' ? record.code : 'validation',
      receivedLength: typeof received === 'string' || Array.isArray(received) ? received.length : undefined,
    };
  }));
}

function decisionForQuestion(project: Project, nodeId: string): string | undefined {
  const edge = project.edges.find((candidate) =>
    ['blocks', 'depends_on', 'affects', 'informs'].includes(candidate.type) &&
    (candidate.source === nodeId || candidate.target === nodeId) &&
    project.nodes.some((node) => node.id === (candidate.source === nodeId ? candidate.target : candidate.source) && node.type === 'DECISION')
  );
  if (!edge) return undefined;
  const otherId = edge.source === nodeId ? edge.target : edge.source;
  return project.nodes.find((node) => node.id === otherId && node.type === 'DECISION')?.id;
}

function answeredQuestionItems(project: Project): OpenQuestionRowItem[] {
  const resolvedQuestions = canonicalQuestionGroups(project)
    .filter((group) => group.canonical.status === 'RESOLVED');
  const seen = new Set<string>();
  return project.history
    .slice()
    .reverse()
    .flatMap((historyItem) => {
      const stableNode = historyItem.nodeId
        ? project.nodes.find((candidate) => candidate.id === historyItem.nodeId)
        : undefined;
      const group = !stableNode
        ? resolvedQuestions.find((candidate) => semanticallyEquivalentQuestion(candidate.canonical.text, historyItem.question))
        : undefined;
      const node = stableNode ?? group?.canonical;
      if (node && (node.type !== 'UNKNOWN' && node.type !== 'ASSUMPTION' || node.status !== 'RESOLVED')) return [];
      if (!node || seen.has(node.id)) return [];
      seen.add(node.id);
      const question = todayQuestionFromNode(project, node);
      // Keep the exact historical wording for edit/reopen routing while the
      // canonical node ID remains the identity used by the UI projection.
      question.question = historyItem.question;
      question.mode = 'edit';
      question.initialAnswer = historyItem.answer;
      question.historyTimestamp = historyItem.timestamp;
      question.projectId = project.id;
      return [{
        id: `answered:${node.id}`,
        question,
        context: 'Answered and saved to workspace context.',
        decisionNodeId: decisionForQuestion(project, node.id),
        answered: true,
        answer: historyItem.answer,
      }];
    });
}

function questionSectionSummary(items: OpenQuestionRowItem[], project: Project): string {
  const decisionId = items.find((item) => !item.answered)?.decisionNodeId;
  const decision = decisionId ? project.nodes.find((node) => node.id === decisionId) : undefined;
  if (!decision) return 'Resolve these before the next important workspace decision.';
  if (/interview/i.test(decision.text)) return 'Resolve these before continuing the interview process.';
  if (project.deadline) {
    const deadline = new Date(`${project.deadline}T12:00:00`);
    if (!Number.isNaN(deadline.getTime())) {
      const readableDate = formatDateOnly(deadline, { locale: 'en-US' });
      const decisionKind = /go\s*\/\s*no[- ]go|launch|pilot/i.test(decision.text)
        ? 'go/no-go decision'
        : 'workspace decision';
      return `Resolve these before the ${readableDate} ${decisionKind}.`;
    }
  }
  return 'Resolve these before the next important workspace decision.';
}

export const Today: React.FC<TodayProps> = ({ userId, project, scope, memories, feedbackEvents, onUpdateMemories, onFeedbackEvent, onUpdateProfile, profile, onAnswerQuestion, onViewResolvedGaps, onReviewDecision, onNavigateToSource, onViewReasoningPath }) => {
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [serverBrief, setServerBrief] = useState<DailyBrief | null>(null);
  const [focusAssessment, setFocusAssessment] = useState<FocusAssessment | null>(null);
  const [loadState, setLoadState] = useState<TodayLoadState>('loading');
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [failedRequestKey, setFailedRequestKey] = useState<string | null>(null);
  const [questionSuggestions, setQuestionSuggestions] = useState<Record<string, TodayQuestionSuggestion>>({});
  const [questionPresentations, setQuestionPresentations] = useState<Record<string, TodayQuestionPresentation>>({});
  const [questionSuggestionWarning, setQuestionSuggestionWarning] = useState('');
  const [hiddenStatuses, setHiddenStatuses] = useState<Record<string, RecommendationStatus>>({});
  const [hiddenRecommendations, setHiddenRecommendations] = useState<Record<string, AttentionCandidate>>({});
  const [hiddenQuestions, setHiddenQuestions] = useState<Record<string, TodayQuestion>>({});
  const [hiddenQuestionsExpanded, setHiddenQuestionsExpanded] = useState(false);

  const requestStateKey = useMemo(
    () => todayProjectStateKey(project, memories, scope, profile),
    [project, memories, profile, scope],
  );
  const requestKey = `${userId}:${requestStateKey}:refresh:${refreshCounter}`;
  const emptyBrief = useMemo<DailyBrief>(() => ({
    id: `today-loading-${userId}`,
    userId,
    period: '',
    generated_at: '',
    recommendations: [],
  }), [userId]);
  const brief = serverBrief ?? emptyBrief;
  const requestSequence = React.useRef(0);
  const forceRefreshRef = React.useRef(false);

  React.useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestSequence.current;
    const force = forceRefreshRef.current;
    forceRefreshRef.current = false;
    setServerBrief(null);
    setFocusAssessment(null);
    setLoadedRequestKey(null);
    setFailedRequestKey(null);
    setLoadState('loading');
    authFetch('/api/attention/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        ...(force ? { force: true } : {}),
        ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
      }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Attention brief unavailable');
        return response.json();
      })
      .then((body) => {
        if (requestId !== requestSequence.current || controller.signal.aborted) return;
        if (!body?.brief) throw new Error('Attention brief unavailable');
        setServerBrief(body.brief as DailyBrief);
        setFocusAssessment((body.focusAssessment as FocusAssessment | null) ?? null);
        setLoadedRequestKey(requestKey);
        setLoadState('ready');
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (requestId !== requestSequence.current || controller.signal.aborted) return;
        setServerBrief(null);
        setFocusAssessment(null);
        setFailedRequestKey(requestKey);
        setLoadState('error');
      });

    return () => controller.abort();
  }, [requestKey, refreshCounter, scope, userId]);

  React.useEffect(() => {
    setHiddenRecommendations({});
    setHiddenQuestions({});
    setHiddenQuestionsExpanded(false);
  }, [project.id]);

  const briefRecommendations = brief.recommendations
    .map((recommendation) => ({
      ...recommendation,
      status: hiddenStatuses[recommendation.id] ?? recommendation.status,
    }));
  const recommendations = briefRecommendations
    .filter((recommendation) => recommendation.status === 'active' && recommendation.kind !== 'risk' && !hiddenRecommendations[recommendation.id])
    .slice(0, 5);
  const openDecisions = useMemo(() => openTodayDecisions(project), [project]);
  const focusTargetNodeId = focusAssessment?.targetNodeId ?? focusAssessment?.actionNodeId;
  const focusTargetNode = focusTargetNodeId
    ? project.nodes.find((node) => node.id === focusTargetNodeId) ?? null
    : null;
  const focusTargetSatisfied = Boolean(
    focusTargetNode
    && focusTargetNode.type === 'NEXT_ACTION'
    && isNextActionSatisfied(project, focusTargetNode),
  );
  const representedNodeIds = useMemo(() => new Set(
    focusAssessment?.representedNodeIds ?? (focusTargetNode ? [focusTargetNode.id] : []),
  ), [focusAssessment?.representedNodeIds, focusTargetNode]);
  const canDecideFocus = focusTargetNode?.type === 'DECISION'
    && focusTargetNode.status === 'OPEN';
  const canResolveFocus = (
    focusTargetNode?.type === 'UNKNOWN'
    || focusTargetNode?.type === 'ASSUMPTION'
  ) && focusTargetNode.status === 'OPEN';
  const focusGuidance = focusAssessment ? focusAssessmentToGuidance(focusAssessment) : undefined;
  const questions = buildTodayQuestions({
    project,
    brief,
    excludedQuestionNodeIds: [...representedNodeIds].filter((nodeId) => {
      const node = project.nodes.find((candidate) => candidate.id === nodeId);
      return node?.type === 'UNKNOWN' || node?.type === 'ASSUMPTION';
    }),
  });
  const feedItems = useMemo(() => buildTodayFeed(recommendations, questions, project), [recommendations, questions, project]);
  const hiddenCandidates = [
    ...Object.values(hiddenRecommendations),
    ...briefRecommendations.filter((recommendation) => recommendation.status !== 'active' && !hiddenRecommendations[recommendation.id]),
  ];
  const hiddenFeedItems = useMemo(
    () => buildTodayFeed(hiddenCandidates, questions, project, 20),
    [hiddenCandidates, questions, project]
  );
  const hiddenQuestionNodeIds = new Set(
    hiddenFeedItems
      .filter((item) => item.itemType === 'QUESTION' && item.question)
      .flatMap((item) => item.question?.sourceNodeIds ?? [])
  );
  Object.values(hiddenQuestions).forEach((question) => question.sourceNodeIds.forEach((nodeId) => hiddenQuestionNodeIds.add(nodeId)));
  const openQuestionsForToday = questions.filter((question) =>
    question.sourceNodeIds.some((nodeId) => {
      const node = project.nodes.find((candidate) => candidate.id === nodeId);
      return node && ['UNKNOWN', 'ASSUMPTION'].includes(node.type) && node.status === 'OPEN';
    }) && !question.sourceNodeIds.some((nodeId) => hiddenQuestionNodeIds.has(nodeId))
  );
  const openQuestionItems = openQuestionsForToday.map((sourceQuestion) => {
    const directItem = feedItems.find((candidate) =>
      candidate.itemType === 'QUESTION'
      && candidate.question
      && candidate.question.sourceNodeIds.some((nodeId) => sourceQuestion.sourceNodeIds.includes(nodeId))
    );
    const fallbackRecommendation = briefRecommendations.find((candidate) =>
      candidate.status === 'active'
      && candidate.source_node_ids.some((nodeId) => sourceQuestion.sourceNodeIds.includes(nodeId))
    );
    const item = directItem ?? (fallbackRecommendation
      ? buildTodayFeed([fallbackRecommendation], questions, project, 1)[0]
      : undefined);
    const presentation = questionPresentations[sourceQuestion.id];
    const suggestion = questionSuggestions[sourceQuestion.id];
    const question = presentation
      ? { ...sourceQuestion, presentationTitle: sourceQuestion.question, presentationSummary: presentation.summary }
      : sourceQuestion;
    return {
      id: item?.recommendation.id ?? `question:${question.id}`,
      question: suggestion && hasUsefulSuggestedAnswer(suggestion)
        ? { ...question, answerSuggestion: suggestion }
        : question,
      context: item ? compactQuestionContext(item, project) : compactQuestionReason(question.reason),
      decisionNodeId: item?.decisionNodeId ?? decisionForQuestion(project, question.sourceNodeIds[0]),
      recommendation: item?.recommendation,
    } satisfies OpenQuestionRowItem;
  });
  const answeredItems = useMemo(() => answeredQuestionItems(project), [project]);
  const questionItems: OpenQuestionRowItem[] = openQuestionItems;
  const visibleDecisions = openDecisions.filter((node) => !representedNodeIds.has(node.id));
  const visibleQuestions = questionItems.filter((item) =>
    !item.question.sourceNodeIds.some((nodeId) => representedNodeIds.has(nodeId)),
  );
  const hiddenQuestionItems = hiddenFeedItems.filter((item) => item.itemType === 'QUESTION');
  const feedQuestions = questionItems.map(({ question, context }) => ({
    ...question,
    reason: question.reason || context,
  }));
  const focusQuestionItem = canResolveFocus
    ? questionItems.find((item) => focusTargetNode && item.question.sourceNodeIds.includes(focusTargetNode.id))
    : undefined;
  const focusQuestion = focusQuestionItem?.question
    ?? (focusTargetNode ? todayQuestionFromNode(project, focusTargetNode) : undefined);
  const focusHidden = focusTargetNode
    ? hiddenQuestionItems.some((item) => item.question?.sourceNodeIds.includes(focusTargetNode.id))
      || Boolean(hiddenRecommendations[`rec_gap_${focusTargetNode.id}`])
    : false;
  const showRecommendedFocus = Boolean(
    focusGuidance
    && !focusTargetSatisfied
    && (!focusTargetNode || focusTargetNode.status === 'OPEN')
    && !focusHidden,
  );
  const comingUp = buildComingUp(brief, new Date(), 4);
  const questionPlanRequest = useMemo(() => normalizeQuestionPlanRequest({
    userId,
    ...(scope.type === 'project' ? { projectId: scope.projectId } : {}),
    scopeLabel: scope.type === 'project' ? project.title : 'General context',
    questions: feedQuestions.map(({ id, question, reason, provenance, presentationContext }) => ({ id, question, reason, provenance, presentationContext })),
  }), [feedQuestions, project.title, scope, userId]);
  const questionPlanKey = JSON.stringify(questionPlanRequest);

  React.useEffect(() => {
    if (!feedQuestions.length) {
      setQuestionSuggestions({});
      setQuestionPresentations({});
      setQuestionSuggestionWarning('');
      return;
    }

    const fallbackSuggestions = Object.fromEntries(localQuestionSuggestions(questionPlanRequest.questions).map((suggestion) => [suggestion.questionId, suggestion]));
    const fallbackPresentations = Object.fromEntries(localQuestionPresentations(questionPlanRequest.questions).map((presentation) => [presentation.questionId, presentation]));
    setQuestionSuggestions(fallbackSuggestions);
    setQuestionPresentations(fallbackPresentations);
    setQuestionSuggestionWarning('');
    const controller = new AbortController();
    authFetch('/api/today/question-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...questionPlanRequest,
      }),
      signal: controller.signal,
    })
      .then((response) => {
        return response.json().catch(() => ({})).then((body) => {
          if (!response.ok) {
            logQuestionPlanValidation(body, questionPlanRequest);
            throw new Error('Today question plans unavailable');
          }
          return body;
        });
      })
      .then((body) => {
        const suggestions = Array.isArray(body.suggestions) ? body.suggestions as TodayQuestionSuggestion[] : [];
        setQuestionSuggestions(Object.fromEntries(suggestions.map((suggestion) => [suggestion.questionId, suggestion])));
        const presentations = Array.isArray(body.presentations)
          ? parseQuestionPresentations(JSON.stringify({ presentations: body.presentations }), questionPlanRequest.questions)
          : localQuestionPresentations(questionPlanRequest.questions);
        setQuestionPresentations(Object.fromEntries(presentations.map((presentation) => [presentation.questionId, presentation])));
        setQuestionSuggestionWarning(typeof body.warning === 'string' ? body.warning : '');
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // The deterministic fallback remains visible when real AI is unavailable.
      });

    return () => controller.abort();
  }, [questionPlanKey, requestStateKey, userId]);

  const handleHide = (recommendation: AttentionCandidate) => {
    setHiddenRecommendations((current) => ({
      ...current,
      [recommendation.id]: { ...recommendation, status: 'not_now' },
    }));
    updateRecommendationStatus(recommendation.id, 'not_now');
    setHiddenStatuses((current) => ({ ...current, [recommendation.id]: 'not_now' }));
  };

  const handleHideQuestion = (question: TodayQuestion, recommendation?: AttentionCandidate) => {
    if (recommendation) {
      handleHide(recommendation);
      return;
    }
    setHiddenQuestions((current) => ({ ...current, [question.id]: question }));
  };

  const handleRestoreQuestion = (question: TodayQuestion) => {
    setHiddenQuestions((current) => {
      const next = { ...current };
      delete next[question.id];
      return next;
    });
  };

  const handleRestore = (recommendation: AttentionCandidate) => {
    setHiddenRecommendations((current) => {
      const next = { ...current };
      delete next[recommendation.id];
      return next;
    });
    updateRecommendationStatus(recommendation.id, 'active');
    setHiddenStatuses((current) => ({ ...current, [recommendation.id]: 'active' }));
  };

  const renderHiddenQuestionSection = () => {
    const entries = [
      ...hiddenQuestionItems.map((item) => ({
        key: item.recommendation.id,
        title: item.title,
        description: item.description,
        question: item.question,
        restore: () => handleRestore(item.recommendation),
      })),
      ...Object.values(hiddenQuestions).map((question) => ({
        key: question.id,
        title: question.question,
        description: question.presentationSummary || question.reason,
        question,
        restore: () => handleRestoreQuestion(question),
      })),
    ].filter((entry, index, all) => all.findIndex((candidate) => candidate.key === entry.key) === index);
    if (!entries.length) return null;
    return (
      <section className="space-y-2" aria-labelledby="hidden-question-items-heading">
        <button
          type="button"
          onClick={() => setHiddenQuestionsExpanded((current) => !current)}
          aria-expanded={hiddenQuestionsExpanded}
          className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300"
        >
          <span id="hidden-question-items-heading">Hidden questions · {entries.length}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${hiddenQuestionsExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {hiddenQuestionsExpanded && (
          <div className="overflow-hidden divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            {entries.map((entry) => (
              <div key={entry.key} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-300">{entry.title}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{entry.description}</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={entry.restore}
                  icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const hasResolvedGaps = answeredItems.length > 0 || project.nodes.some((node) =>
    node.status === 'RESOLVED' && ['UNKNOWN', 'ASSUMPTION', 'DECISION'].includes(node.type),
  );
  const isCurrentReady = loadState === 'ready'
    && loadedRequestKey === requestKey
    && serverBrief !== null;
  const isCurrentError = loadState === 'error' && failedRequestKey === requestKey;

  return (
    <div className="mx-auto max-w-[1080px] space-y-5 px-3 py-4 sm:px-6 sm:py-6">
      <div className="border-b border-slate-800 pb-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-xl border border-cyan-800 bg-cyan-950 p-2.5 text-cyan-300">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">TODAY</p>
              <h1 className="text-xl font-extrabold text-slate-100 sm:text-2xl">What deserves attention now</h1>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              forceRefreshRef.current = true;
              setRefreshCounter((value) => value + 1);
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:border-cyan-700 hover:text-cyan-300"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {isCurrentReady ? (
        <>
          {questionSuggestionWarning && (
            <p className="text-xs text-amber-300" role="status">{questionSuggestionWarning}</p>
          )}

      {showRecommendedFocus && focusGuidance && (
        <RecommendedFocus
          guidance={focusGuidance}
          onResolve={canResolveFocus && focusQuestion && onAnswerQuestion ? () => onAnswerQuestion(focusQuestion) : undefined}
          onDecide={canDecideFocus && focusTargetNode && onReviewDecision ? () => onReviewDecision(focusTargetNode.id) : undefined}
          onViewDecisionMap={focusTargetNode && onViewReasoningPath ? () => onViewReasoningPath(focusTargetNode.id) : undefined}
        />
      )}

      {visibleDecisions.length > 0 && (
        <section className="space-y-2" aria-labelledby="today-decisions-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="today-decisions-heading" className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-indigo-300">
              Decisions · {visibleDecisions.length}
            </h2>
          </div>
          <div className="overflow-hidden divide-y divide-slate-800 rounded-xl border border-indigo-900/60 bg-slate-900">
            {visibleDecisions.map((decision) => (
              <article key={decision.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-snug text-slate-100">{decision.text}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    {decision.why_it_matters?.[0] ?? 'This workspace choice is still open and needs a recorded decision.'}
                  </p>
                </div>
                {onReviewDecision && (
                <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onReviewDecision(decision.id)}
                  >
                    Decide
                  </Button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {visibleQuestions.length > 0 && (
        <OpenQuestions
          items={visibleQuestions}
          summary={questionSectionSummary(visibleQuestions, project)}
          onAnswer={(question) => onAnswerQuestion?.(question)}
          onHide={handleHideQuestion}
        />
      )}

      {hasResolvedGaps && onViewResolvedGaps && (
        <Button
          variant="ghost"
          onClick={onViewResolvedGaps}
          icon={<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          View resolved gaps
        </Button>
      )}

      {renderHiddenQuestionSection()}
      {!showRecommendedFocus && visibleDecisions.length === 0 && visibleQuestions.length === 0 && !hasResolvedGaps && hiddenFeedItems.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
          <h3 className="text-sm font-bold text-slate-100">Nothing needs your attention right now</h3>
          <p className="mt-2 text-xs text-slate-500">Refresh after adding new context or memory.</p>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Coming up</h2>
        {comingUp.length > 0 ? (
          <div className="overflow-hidden divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/45">
            {comingUp.map((commitment) => (
              <article
                key={commitment.id}
                role={onViewReasoningPath ? 'button' : undefined}
                tabIndex={onViewReasoningPath ? 0 : undefined}
                onClick={onViewReasoningPath ? () => onViewReasoningPath(commitment.id) : undefined}
                onKeyDown={onViewReasoningPath ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onViewReasoningPath(commitment.id); } } : undefined}
                className={`flex items-center gap-4 px-3 py-3 ${onViewReasoningPath ? 'cursor-pointer hover:bg-slate-900/70' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-400">{commitment.time}</p>
                  <p className="mt-1 break-words text-sm font-bold text-slate-100">{commitment.title}</p>
                  <p className="mt-1 text-[10px] font-semibold text-slate-500">{commitment.provenance}</p>
                </div>
                <span className="shrink-0 text-lg text-slate-500" aria-hidden="true">→</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="border-y border-slate-800 py-3 text-xs text-slate-500">
            No near-term commitments in the current Context Pack.
          </p>
        )}
      </section>
        </>
      ) : isCurrentError ? (
        <TodayUnavailable />
      ) : (
        <TodaySkeleton />
      )}
    </div>
  );
};
