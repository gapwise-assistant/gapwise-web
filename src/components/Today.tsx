'use client';

import React, { useMemo, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AttentionCandidate, DailyBrief, RecommendationStatus } from '@/types/attention';
import { FeedbackEvent, FeedbackRating } from '@/types/feedback';
import { generateDailyBrief, updateRecommendationStatus } from '@/lib/attention/generateBrief';
import { adaptProfileFromFeedback, applyCorrectionToMemories, createFeedbackEvent } from '@/lib/personalization/applyFeedback';
import { buildComingUp, buildTodayQuestions, TodayQuestion } from '@/lib/today/sections';
import { localQuestionSuggestions, TodayQuestionSuggestion } from '@/lib/today/questionPlans';
import { buildTodayFeed } from '@/lib/today/feed';
import { buildQuestionWhyExplanation } from '@/lib/questions/whyQuestion';
import { RecommendationCard } from '@/components/RecommendationCard';
import { RecommendationWhy } from '@/components/RecommendationWhy';
import { AppScope } from '@/types/scope';
import { authFetch } from '@/lib/auth/client';

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
  onReviewDecision?: (nodeId: string) => void;
  onNavigateToSource?: (sourceId: string) => void;
  onViewReasoningPath?: (nodeId: string) => void;
}

export const Today: React.FC<TodayProps> = ({ userId, project, scope, memories, feedbackEvents, onUpdateMemories, onFeedbackEvent, onUpdateProfile, profile, onAnswerQuestion, onReviewDecision, onNavigateToSource, onViewReasoningPath }) => {
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [serverBrief, setServerBrief] = useState<DailyBrief | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<AttentionCandidate | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<TodayQuestion | null>(null);
  const [questionSuggestions, setQuestionSuggestions] = useState<Record<string, TodayQuestionSuggestion>>({});
  const [questionSuggestionSource, setQuestionSuggestionSource] = useState<'gapswise-agent' | 'local-context' | 'local-fallback'>('local-context');
  const [questionSuggestionWarning, setQuestionSuggestionWarning] = useState('');
  const [hiddenStatuses, setHiddenStatuses] = useState<Record<string, RecommendationStatus>>({});

  const localBrief: DailyBrief = useMemo(
    () => generateDailyBrief({ userId, project, memories, feedbackEvents, force: Boolean(refreshCounter) }),
    [userId, project, memories, feedbackEvents, refreshCounter]
  );
  const brief = serverBrief ?? localBrief;

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

  const recommendations = brief.recommendations
    .map((recommendation) => ({
      ...recommendation,
      status: hiddenStatuses[recommendation.id] ?? recommendation.status,
    }))
    .filter((recommendation) => recommendation.status === 'active')
    .slice(0, 5);
  const questions = buildTodayQuestions({ project, brief });
  const feedItems = useMemo(() => buildTodayFeed(recommendations, questions, project), [recommendations, questions, project]);
  const feedQuestions = feedItems.flatMap((item) => item.question ? [item.question] : []);
  const comingUp = buildComingUp(brief);
  const questionPlanKey = JSON.stringify(feedQuestions.map(({ id, question, reason, provenance }) => ({ id, question, reason, provenance })));
  const selectedQuestionWhy = selectedQuestion ? buildQuestionWhyExplanation(project, selectedQuestion) : null;
  const selectedReasoningPathNodeId = selectedQuestionWhy?.reasoningPath?.nodeIds[0] ?? null;

  React.useEffect(() => {
    if (!feedQuestions.length) {
      setQuestionSuggestions({});
      setQuestionSuggestionSource('local-context');
      setQuestionSuggestionWarning('');
      return;
    }

    const fallbackSuggestions = Object.fromEntries(localQuestionSuggestions(feedQuestions).map((suggestion) => [suggestion.questionId, suggestion]));
    setQuestionSuggestions(fallbackSuggestions);
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
        questions: feedQuestions.map(({ id, question, reason, provenance }) => ({ id, question, reason, provenance })),
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="border-b border-slate-800 pb-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-xl border border-cyan-800 bg-cyan-950 p-2.5 text-cyan-300">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">TODAY</p>
              <h1 className="text-xl font-extrabold text-slate-100 sm:text-2xl">What deserves attention now</h1>
              <p className="text-xs text-slate-400">
                {feedItems.length} items for {brief.period}
              </p>
              {scope.type === 'project' && (
                <p className="mt-1 text-xs font-semibold text-cyan-300">Focused on: {project.title}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setRefreshCounter((value) => value + 1)}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:text-cyan-300 sm:min-h-0 sm:w-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-extrabold text-slate-100">What deserves attention</h2>
        {questionSuggestionWarning && (
          <p className="text-xs text-amber-300" role="status">{questionSuggestionWarning}</p>
        )}
        {feedItems.length > 0 ? (
          <div className="space-y-4">
            {feedItems.map((item) => (
              <RecommendationCard
                key={item.recommendation.id}
                recommendation={item.recommendation}
                itemType={item.itemType}
                title={item.title}
                description={item.description}
                question={item.question}
                decisionNodeId={item.decisionNodeId}
                questionSuggestion={item.question ? questionSuggestions[item.question.id] : undefined}
                questionSuggestionSource={questionSuggestionSource}
                onOpenWhy={setSelectedRecommendation}
                onOpenQuestionWhy={setSelectedQuestion}
                onAnswerQuestion={onAnswerQuestion}
                onReviewDecision={onReviewDecision}
                onFeedback={handleFeedback}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
            <h3 className="text-sm font-bold text-slate-100">Nothing needs your attention right now</h3>
            <p className="mt-2 text-xs text-slate-500">Refresh after adding new context or memory.</p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-extrabold text-slate-100">Coming up</h2>
        {comingUp.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {comingUp.map((commitment) => (
              <article key={commitment.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-sm font-bold text-slate-100">{commitment.title}</p>
                <p className="mt-1 text-xs text-slate-400">{commitment.time}</p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">{commitment.provenance}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-xs text-slate-500">
            No near-term commitments in the current Context Pack.
          </div>
        )}
      </section>

      <RecommendationWhy
        recommendation={selectedRecommendation}
        onClose={() => setSelectedRecommendation(null)}
      />
      {selectedQuestion && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-2 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-none sm:rounded-xl sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-400">Decision value</p>
                <h2 className="mt-1 text-sm font-bold text-slate-100">Why this matters</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedQuestion(null)}
                className="min-h-11 min-w-11 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 sm:min-h-0 sm:min-w-0"
                aria-label="Close question explanation"
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-200">{selectedQuestion.question}</p>

            {selectedQuestionWhy && (
              <div className="mt-5 space-y-5">
                <section>
                  <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-300">Why this matters</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{selectedQuestionWhy.whyThisMatters}</p>
                </section>

                {selectedQuestionWhy.whatGapswiseKnows.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">What Gapswise already knows</h3>
                    <ul className="mt-2 space-y-2">
                      {selectedQuestionWhy.whatGapswiseKnows.map((item) => (
                        <li key={item} className="text-xs leading-relaxed text-slate-300">• {item}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {selectedQuestionWhy.whatThisBlocks.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">What this is blocking</h3>
                    <ul className="mt-2 space-y-2">
                      {selectedQuestionWhy.whatThisBlocks.map((item) => (
                        <li key={item} className="text-xs leading-relaxed text-slate-300">• {item}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {selectedQuestionWhy.whatCouldChange.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">What could change if you answer</h3>
                    <ul className="mt-2 space-y-2">
                      {selectedQuestionWhy.whatCouldChange.map((item) => (
                        <li key={item} className="text-xs leading-relaxed text-slate-300">• {item}</li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Evidence checked</h3>
                  {selectedQuestionWhy.evidence.length ? (
                    <div className="mt-2 space-y-2">
                      {selectedQuestionWhy.evidence.map((evidence) => (
                        evidence.sourceId && onNavigateToSource && !evidence.sourceId.startsWith('gcal_') ? (
                          <button
                            key={evidence.sourceId}
                            type="button"
                            onClick={() => {
                              onNavigateToSource(evidence.sourceId as string);
                              setSelectedQuestion(null);
                            }}
                            className="block min-h-11 w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-left hover:border-cyan-700"
                          >
                            <span className="block text-xs font-semibold text-cyan-300">{evidence.title}</span>
                            <span className="mt-1 block text-xs leading-relaxed text-slate-400">{evidence.excerpt}</span>
                          </button>
                        ) : (
                          <div key={`${evidence.title}-${evidence.excerpt}`} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                            <span className="block text-xs font-semibold text-slate-300">{evidence.title}</span>
                            <span className="mt-1 block text-xs leading-relaxed text-slate-400">{evidence.excerpt}</span>
                          </div>
                        )
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">No named source is linked to this question yet.</p>
                  )}
                </section>

                {selectedReasoningPathNodeId && onViewReasoningPath && (
                  <button
                    type="button"
                    onClick={() => {
                      onViewReasoningPath(selectedReasoningPathNodeId);
                      setSelectedQuestion(null);
                    }}
                    className="min-h-11 w-full rounded-lg border border-cyan-800 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-200 hover:border-cyan-600"
                  >
                    View reasoning path
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setSelectedQuestion(null)}
              className="mt-5 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 sm:min-h-0"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
