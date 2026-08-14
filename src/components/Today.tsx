'use client';

import React, { useMemo, useState } from 'react';
import { HelpCircle, RefreshCw, Sparkles } from 'lucide-react';
import { Project } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AttentionCandidate, DailyBrief, RecommendationStatus } from '@/types/attention';
import { FeedbackEvent, FeedbackRating } from '@/types/feedback';
import { generateDailyBrief, updateRecommendationStatus } from '@/lib/attention/generateBrief';
import { adaptProfileFromFeedback, applyCorrectionToMemories, createFeedbackEvent } from '@/lib/personalization/applyFeedback';
import { buildComingUp, buildTodayQuestions, TodayQuestion } from '@/lib/today/sections';
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
}

export const Today: React.FC<TodayProps> = ({ userId, project, scope, memories, feedbackEvents, onUpdateMemories, onFeedbackEvent, onUpdateProfile, profile, onAnswerQuestion }) => {
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [serverBrief, setServerBrief] = useState<DailyBrief | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<AttentionCandidate | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<TodayQuestion | null>(null);
  const [hiddenStatuses, setHiddenStatuses] = useState<Record<string, RecommendationStatus>>({});
  const [hiddenQuestionIds, setHiddenQuestionIds] = useState<string[]>([]);

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
  const questions = buildTodayQuestions({ project, brief, hiddenQuestionIds });
  const comingUp = buildComingUp(brief);

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-cyan-800 bg-cyan-950 p-2.5 text-cyan-300">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">TODAY</p>
              <h1 className="text-2xl font-extrabold text-slate-100">What deserves attention now</h1>
              <p className="text-xs text-slate-400">
                {recommendations.length} ranked attention items for {brief.period}
              </p>
              {scope.type === 'project' && (
                <p className="mt-1 text-xs font-semibold text-cyan-300">Focused on: {project.title}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setRefreshCounter((value) => value + 1)}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:text-cyan-300 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-extrabold text-slate-100">What deserves attention</h2>
        {recommendations.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {recommendations.map((recommendation) => (
              <RecommendationCard
                key={recommendation.id}
                recommendation={recommendation}
                onOpenWhy={setSelectedRecommendation}
                onFeedback={handleFeedback}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
            <h3 className="text-sm font-bold text-slate-100">No active recommendations</h3>
            <p className="mt-2 text-xs text-slate-500">Refresh after adding new context or memory.</p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-extrabold text-slate-100">Questions worth answering</h2>
        {questions.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {questions.map((question) => (
              <article key={question.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
                <h3 className="text-sm font-bold leading-snug text-slate-100">{question.question}</h3>
                <p className="text-xs text-slate-400">{question.reason}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onAnswerQuestion?.(question)}
                    className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950"
                  >
                    Answer
                  </button>
                  <button
                    type="button"
                    onClick={() => setHiddenQuestionIds((current) => [...current, question.id])}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300"
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedQuestion(question)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 flex items-center gap-1.5"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    Why?
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-xs text-slate-500">
            No high-value unresolved questions right now.
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h2 className="text-sm font-bold text-slate-100">Why this question?</h2>
            <p className="mt-3 text-sm text-slate-300">{selectedQuestion.question}</p>
            <p className="mt-3 text-xs text-slate-400">{selectedQuestion.reason}</p>
            <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-cyan-300">
              {selectedQuestion.provenance}
            </p>
            <button
              type="button"
              onClick={() => setSelectedQuestion(null)}
              className="mt-4 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
