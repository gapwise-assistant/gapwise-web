'use client';

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AttentionCandidate, DailyBrief, RecommendationStatus } from '@/types/attention';
import { FeedbackEvent, FeedbackRating } from '@/types/feedback';
import { generateDailyBrief, updateRecommendationStatus } from '@/lib/attention/generateBrief';
import { adaptProfileFromFeedback, applyCorrectionToMemories, createFeedbackEvent } from '@/lib/personalization/applyFeedback';
import { buildComingUp, buildTodayQuestions, todayQuestionFromNode, TodayQuestion } from '@/lib/today/sections';
import {
  hasUsefulSuggestedAnswer,
  localQuestionPresentation,
  localQuestionPresentations,
  localQuestionSuggestions,
  parseQuestionPresentations,
  TodayQuestionPresentation,
  TodayQuestionSuggestion,
} from '@/lib/today/questionPlans';
import { buildTodayFeed, compactQuestionContext } from '@/lib/today/feed';
import { RecommendationCard, SnoozeOption } from '@/components/RecommendationCard';
import { RecommendationWhy } from '@/components/RecommendationWhy';
import { AppScope } from '@/types/scope';
import { authFetch } from '@/lib/auth/client';
import { calendarTimestampFromText, formatCalendarSchedule } from '@/lib/google/calendarFormatting';
import { OpenQuestions, OpenQuestionRowItem } from '@/components/OpenQuestions';

interface TodayProps {
  userId: string;
  project: Project;
  scope: AppScope;
  memories: DurableMemory[];
  feedbackEvents: FeedbackEvent[];
  onUpdateMemories: (updated: DurableMemory[]) => void;
  onFeedbackEvent: (event: FeedbackEvent) => void;
  onUpdateProfile?: (profile: import('@/types/clarity').UserMemoryProfile) => void;
  profile?: import('@/types/clarity').UserMemoryProfile;
  onAnswerQuestion?: (question: TodayQuestion) => void;
  onReopenQuestion?: (question: TodayQuestion) => Promise<void> | void;
  onReviewDecision?: (nodeId: string) => void;
  onNavigateToSource?: (sourceId: string) => void;
  onViewReasoningPath?: (nodeId: string) => void;
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
  const resolvedQuestions = new Map(
    project.nodes
      .filter((node) => ['UNKNOWN', 'ASSUMPTION'].includes(node.type) && node.status === 'RESOLVED')
      .map((node) => [node.text, node])
  );
  const seen = new Set<string>();
  return project.history
    .slice()
    .reverse()
    .flatMap((historyItem) => {
      const node = resolvedQuestions.get(historyItem.question);
      if (!node || seen.has(node.id)) return [];
      seen.add(node.id);
      const question = todayQuestionFromNode(project, node);
      question.mode = 'edit';
      question.initialAnswer = historyItem.answer;
      question.historyTimestamp = historyItem.timestamp;
      question.projectId = project.id;
      return [{
        id: `answered:${node.id}`,
        question,
        context: 'Answered and saved to project context.',
        decisionNodeId: decisionForQuestion(project, node.id),
        answered: true,
        answer: historyItem.answer,
      }];
    });
}

function questionSectionSummary(items: OpenQuestionRowItem[], project: Project): string {
  const decisionId = items.find((item) => !item.answered)?.decisionNodeId;
  const decision = decisionId ? project.nodes.find((node) => node.id === decisionId) : undefined;
  if (!decision) return 'Resolve these before the next important project decision.';
  if (/interview/i.test(decision.text)) return 'Resolve these before continuing the interview process.';
  const decisionText = decision.text.replace(/[.?!]+$/, '').replace(/^Decide whether\s+/i, 'deciding whether ');
  return `Resolve these before ${decisionText.charAt(0).toLowerCase()}${decisionText.slice(1)}.`;
}

export const Today: React.FC<TodayProps> = ({ userId, project, scope, memories, feedbackEvents, onUpdateMemories, onFeedbackEvent, onUpdateProfile, profile, onAnswerQuestion, onReopenQuestion, onReviewDecision, onNavigateToSource, onViewReasoningPath }) => {
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [serverBrief, setServerBrief] = useState<DailyBrief | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<AttentionCandidate | null>(null);
  const [questionSuggestions, setQuestionSuggestions] = useState<Record<string, TodayQuestionSuggestion>>({});
  const [questionPresentations, setQuestionPresentations] = useState<Record<string, TodayQuestionPresentation>>({});
  const [questionSuggestionSource, setQuestionSuggestionSource] = useState<'gapswise-agent' | 'local-context' | 'local-fallback'>('local-context');
  const [questionSuggestionWarning, setQuestionSuggestionWarning] = useState('');
  const [hiddenStatuses, setHiddenStatuses] = useState<Record<string, RecommendationStatus>>({});
  const [hiddenRecommendations, setHiddenRecommendations] = useState<Record<string, AttentionCandidate>>({});
  const [hiddenQuestionsExpanded, setHiddenQuestionsExpanded] = useState(false);
  const [hiddenRemindersExpanded, setHiddenRemindersExpanded] = useState(false);
  const [hiddenOtherExpanded, setHiddenOtherExpanded] = useState(false);
  const [resolvedQuestionsExpanded, setResolvedQuestionsExpanded] = useState(false);

  const localBrief: DailyBrief = useMemo(
    () => generateDailyBrief({ userId, project, memories, feedbackEvents, force: Boolean(refreshCounter) }),
    [userId, project, memories, feedbackEvents, refreshCounter]
  );
  const brief = serverBrief ?? localBrief;

  React.useEffect(() => {
    // A graph answer or durable-memory update invalidates the server snapshot;
    // show the locally recalculated brief immediately while the fresh server
    // brief is fetched below.
    setServerBrief(null);
  }, [project.updated_at, memories]);

  React.useEffect(() => {
    const controller = new AbortController();
    authFetch('/api/attention/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, force: true, ...(scope.type === 'project' ? { projectId: scope.projectId } : {}) }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Attention brief unavailable');
        return response.json();
      })
      .then((body) => setServerBrief(body.brief as DailyBrief))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setServerBrief(null);
      });

    return () => controller.abort();
  }, [userId, scope, refreshCounter, project.updated_at]);

  React.useEffect(() => {
    setHiddenRecommendations({});
    setHiddenQuestionsExpanded(false);
    setHiddenRemindersExpanded(false);
    setHiddenOtherExpanded(false);
    setResolvedQuestionsExpanded(false);
  }, [project.id]);

  const briefRecommendations = brief.recommendations
    .map((recommendation) => ({
      ...recommendation,
      status: hiddenStatuses[recommendation.id] ?? recommendation.status,
    }));
  const recommendations = briefRecommendations
    .filter((recommendation) => recommendation.status === 'active' && !hiddenRecommendations[recommendation.id])
    .slice(0, 5);
  const questions = buildTodayQuestions({ project, brief });
  const feedItems = useMemo(() => buildTodayFeed(recommendations, questions, project), [recommendations, questions, project]);
  const feedQuestions = feedItems.flatMap((item) => item.question ? [item.question] : []);
  const openQuestionItems = feedItems
    .filter((item) => item.itemType === 'QUESTION' && item.question)
    .map((item, index) => {
      const presentation = questionPresentations[item.question!.id];
      const suggestion = questionSuggestions[item.question!.id];
      const question = presentation
        ? { ...item.question!, presentationTitle: presentation.title, presentationSummary: presentation.summary }
        : item.question!;
      return {
        id: item.recommendation.id,
        question: suggestion && hasUsefulSuggestedAnswer(suggestion)
          ? { ...question, answerSuggestion: suggestion }
          : question,
        context: compactQuestionContext(item, project),
        decisionNodeId: item.decisionNodeId,
        recommendation: item.recommendation,
        priority: index === 0,
      } satisfies OpenQuestionRowItem;
    });
  const answeredItems = useMemo(() => answeredQuestionItems(project), [project]);
  const answeredItemsWithPresentation = useMemo(() => answeredItems.map((item) => {
    const presentation = localQuestionPresentation(item.question);
    return {
      ...item,
      question: {
        ...item.question,
        presentationTitle: presentation.title,
        presentationSummary: presentation.summary,
      },
    } satisfies OpenQuestionRowItem;
  }), [answeredItems]);
  const questionItems: OpenQuestionRowItem[] = openQuestionItems;
  const nonQuestionItems = feedItems.filter((item) => item.itemType !== 'QUESTION');
  const hiddenCandidates = [
    ...Object.values(hiddenRecommendations),
    ...briefRecommendations.filter((recommendation) => recommendation.status !== 'active' && !hiddenRecommendations[recommendation.id]),
  ];
  const hiddenFeedItems = useMemo(
    () => buildTodayFeed(hiddenCandidates, questions, project, 20),
    [hiddenCandidates, questions, project]
  );
  const hiddenQuestionItems = hiddenFeedItems.filter((item) => item.itemType === 'QUESTION');
  const hiddenReminderItems = hiddenFeedItems.filter((item) => item.itemType === 'REMINDER');
  const hiddenOtherItems = hiddenFeedItems.filter((item) => item.itemType !== 'QUESTION' && item.itemType !== 'REMINDER');
  const reminderCount = nonQuestionItems.filter((item) => item.itemType === 'REMINDER').length;
  const reminderItems = nonQuestionItems.filter((item) => item.itemType === 'REMINDER');
  const otherNonQuestionItems = nonQuestionItems.filter((item) => item.itemType !== 'REMINDER');
  const openQuestionCount = questionItems.filter((item) => !item.answered).length;
  const promotedCommitmentIds = new Set(
    [...feedItems, ...hiddenFeedItems]
      .filter((item) => item.itemType === 'REMINDER' && item.calendarCommitmentId)
      .map((item) => item.calendarCommitmentId as string)
  );
  const comingUp = buildComingUp(brief, new Date(), 4, promotedCommitmentIds);
  const questionPlanKey = JSON.stringify(feedQuestions.map(({ id, question, reason, provenance, presentationContext }) => ({ id, question, reason, provenance, presentationContext })));

  React.useEffect(() => {
    if (!feedQuestions.length) {
      setQuestionSuggestions({});
      setQuestionPresentations({});
      setQuestionSuggestionSource('local-context');
      setQuestionSuggestionWarning('');
      return;
    }

    const fallbackSuggestions = Object.fromEntries(localQuestionSuggestions(feedQuestions).map((suggestion) => [suggestion.questionId, suggestion]));
    const fallbackPresentations = Object.fromEntries(localQuestionPresentations(feedQuestions).map((presentation) => [presentation.questionId, presentation]));
    setQuestionSuggestions(fallbackSuggestions);
    setQuestionPresentations(fallbackPresentations);
    setQuestionSuggestionSource('local-context');
    setQuestionSuggestionWarning('');
    const controller = new AbortController();
    const scopeProjectId = scope.type === 'project' ? scope.projectId : undefined;
    const scopeLabel = scope.type === 'project' ? project.title : 'Everything';

    authFetch('/api/today/question-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        ...(scopeProjectId ? { projectId: scopeProjectId } : {}),
        scopeLabel,
        questions: feedQuestions.map(({ id, question, reason, provenance, presentationContext }) => ({ id, question, reason, provenance, presentationContext })),
      }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Today question plans unavailable');
        return response.json();
      })
      .then((body) => {
        const suggestions = Array.isArray(body.suggestions) ? body.suggestions as TodayQuestionSuggestion[] : [];
        setQuestionSuggestions(Object.fromEntries(suggestions.map((suggestion) => [suggestion.questionId, suggestion])));
        const presentations = Array.isArray(body.presentations)
          ? parseQuestionPresentations(JSON.stringify({ presentations: body.presentations }), feedQuestions)
          : localQuestionPresentations(feedQuestions);
        setQuestionPresentations(Object.fromEntries(presentations.map((presentation) => [presentation.questionId, presentation])));
        setQuestionSuggestionSource(
          body.generatedBy === 'gapswise-agent'
            ? 'gapswise-agent'
            : body.generatedBy === 'local-fallback'
              ? 'local-fallback'
              : 'local-context'
        );
        setQuestionSuggestionWarning(typeof body.warning === 'string' ? body.warning : '');
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // The deterministic fallback remains visible when real AI is unavailable.
      });

    return () => controller.abort();
  }, [userId, project.id, project.title, project.updated_at, scope.type, scope.type === 'project' ? scope.projectId : '', questionPlanKey]);

  const handleFeedback = (
    recommendationId: string,
    rating: FeedbackRating,
    status: RecommendationStatus | null,
    explanation?: string
  ) => {
    const event = createFeedbackEvent({
      userId,
      targetType: 'recommendation',
      targetId: recommendationId,
      rating,
      explanation,
      suppressDays: rating === 'not_now' ? 3 : rating === 'already_done' ? 365 : undefined,
    });
    onFeedbackEvent(event);
    if (status) {
      updateRecommendationStatus(recommendationId, status);
      setHiddenStatuses((current) => ({ ...current, [recommendationId]: status }));
    }
    if (rating === 'wrong_assumption' && explanation) {
      onUpdateMemories(applyCorrectionToMemories({ memories, explanation }));
    }
    if (profile && onUpdateProfile) {
      onUpdateProfile(adaptProfileFromFeedback(profile, event));
    }
  };

  const handleSnooze = (recommendation: AttentionCandidate, option: SnoozeOption) => {
    const now = new Date();
    const commitment = recommendation.context_pack.upcomingCommitments.find((node) =>
      recommendation.source_node_ids.includes(node.id)
    );
    const startValue = commitment ? calendarTimestampFromText(commitment.text, 'Starts') : undefined;
    const startTime = startValue ? new Date(startValue).getTime() : Number.NaN;
    const suppressUntil = option === 'before_event' && Number.isFinite(startTime)
      ? new Date(Math.max(now.getTime() + 60 * 1000, startTime - 10 * 60 * 1000)).toISOString()
      : undefined;
    const event = createFeedbackEvent({
      userId,
      targetType: 'recommendation',
      targetId: recommendation.id,
      rating: 'not_now',
      suppressUntil,
      suppressMinutes: suppressUntil ? undefined : option === 'before_event' ? 15 : option,
      metadata: { snooze: option },
    });
    onFeedbackEvent(event);
    updateRecommendationStatus(recommendation.id, 'not_now');
    setHiddenStatuses((current) => ({ ...current, [recommendation.id]: 'not_now' }));
  };

  const handleHide = (recommendation: AttentionCandidate) => {
    setHiddenRecommendations((current) => ({
      ...current,
      [recommendation.id]: { ...recommendation, status: 'not_now' },
    }));
    updateRecommendationStatus(recommendation.id, 'not_now');
    setHiddenStatuses((current) => ({ ...current, [recommendation.id]: 'not_now' }));
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

  const renderRecommendationCard = (item: typeof nonQuestionItems[number]) => (
    <RecommendationCard
      key={item.recommendation.id}
      recommendation={item.recommendation}
      itemType={item.itemType}
      title={item.title}
      description={item.description}
      calendarStart={item.calendarStart}
      calendarEnd={item.calendarEnd}
      calendarSource={item.calendarSource}
      question={item.question}
      decisionNodeId={item.decisionNodeId}
      questionSuggestion={item.question ? questionSuggestions[item.question.id] : undefined}
      questionSuggestionSource={questionSuggestionSource}
      onOpenWhy={setSelectedRecommendation}
      onAnswerQuestion={onAnswerQuestion}
      onReviewDecision={onReviewDecision}
      onFeedback={handleFeedback}
      onSnooze={handleSnooze}
      onHide={handleHide}
    />
  );

  const renderHiddenSection = (
    items: typeof hiddenFeedItems,
    label: string,
    headingId: string,
    expanded: boolean,
    onToggle: () => void,
  ) => items.length > 0 ? (
    <section className="space-y-2" aria-labelledby={headingId}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300"
      >
        <span id={headingId}>{label} · {items.length}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="overflow-hidden divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
          {items.map((item) => {
            const schedule = item.calendarStart
              ? formatCalendarSchedule(item.calendarStart, item.calendarEnd, new Date())
              : undefined;
            return (
              <div key={item.recommendation.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-300">{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {schedule ?? item.description}
                    {item.calendarSource ? ` · ${item.calendarSource}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(item.recommendation)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-700 bg-transparent px-2.5 text-xs font-semibold text-slate-300 hover:border-cyan-700 hover:bg-cyan-950/30 hover:text-cyan-100"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Restore
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  ) : null;

  const renderResolvedSection = () => answeredItemsWithPresentation.length > 0 ? (
    <section className="space-y-2" aria-labelledby="resolved-questions-heading">
      <button
        type="button"
        onClick={() => setResolvedQuestionsExpanded((current) => !current)}
        aria-expanded={resolvedQuestionsExpanded}
        className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300"
      >
        <span id="resolved-questions-heading">Resolved · {answeredItemsWithPresentation.length}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${resolvedQuestionsExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {resolvedQuestionsExpanded && (
        <div className="overflow-hidden divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
          {answeredItemsWithPresentation.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-300">
                  <Check className="mr-1 inline h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  {item.question.presentationTitle || item.question.question}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500" title={item.answer}>{item.answer}</p>
              </div>
              {onAnswerQuestion && (
                <button
                  type="button"
                  onClick={() => onAnswerQuestion(item.question)}
                  className="inline-flex h-8 shrink-0 items-center rounded-md border border-slate-700 bg-transparent px-2.5 text-xs font-semibold text-slate-300 hover:border-cyan-700 hover:bg-cyan-950/30 hover:text-cyan-100"
                >
                  Edit
                </button>
              )}
              {onReopenQuestion && (
                <button
                  type="button"
                  onClick={() => void onReopenQuestion(item.question)}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-700 bg-transparent px-2.5 text-xs font-semibold text-slate-400 hover:border-amber-700 hover:bg-amber-950/20 hover:text-amber-200"
                  title="Cancel this response and reopen the question"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reopen
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  ) : null;

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
              <p className="text-xs text-slate-400">
                {reminderCount} reminder{reminderCount === 1 ? '' : 's'} · {openQuestionCount} question{openQuestionCount === 1 ? '' : 's'} · {scope.type === 'project' ? project.title : 'Everything'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setRefreshCounter((value) => value + 1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:border-cyan-700 hover:text-cyan-300"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <section className="space-y-2" aria-labelledby="reminders-heading">
        <p id="reminders-heading" className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Reminders · {reminderCount}</p>
        {reminderItems.length > 0 ? (
          <div className="space-y-2">
            {reminderItems.map(renderRecommendationCard)}
          </div>
        ) : (
          <p className="border-y border-slate-800 py-3 text-xs text-slate-500">No reminders scheduled for today.</p>
        )}
      </section>

      {otherNonQuestionItems.length > 0 && (
        <section className="space-y-2">
          <div className="space-y-2">
            {otherNonQuestionItems.map(renderRecommendationCard)}
          </div>
        </section>
      )}

      {questionSuggestionWarning && (
        <p className="text-xs text-amber-300" role="status">{questionSuggestionWarning}</p>
      )}

      {(questionItems.length > 0 || answeredItemsWithPresentation.length > 0 || hiddenQuestionItems.length > 0) && (
        <OpenQuestions
          items={questionItems}
          summary={questionSectionSummary(questionItems, project)}
          onAnswer={(question) => onAnswerQuestion?.(question)}
          onHide={handleHide}
        />
      )}

      {renderHiddenSection(hiddenQuestionItems, 'Hidden questions', 'hidden-questions-heading', hiddenQuestionsExpanded, () => setHiddenQuestionsExpanded((current) => !current))}
      {renderHiddenSection(hiddenReminderItems, 'Hidden reminders', 'hidden-reminders-heading', hiddenRemindersExpanded, () => setHiddenRemindersExpanded((current) => !current))}
      {renderHiddenSection(hiddenOtherItems, 'Hidden items', 'hidden-items-heading', hiddenOtherExpanded, () => setHiddenOtherExpanded((current) => !current))}
      {renderResolvedSection()}

      {feedItems.length === 0 && questionItems.length === 0 && answeredItemsWithPresentation.length === 0 && hiddenFeedItems.length === 0 && (
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

      <RecommendationWhy
        recommendation={selectedRecommendation}
        onClose={() => setSelectedRecommendation(null)}
      />
    </div>
  );
};
