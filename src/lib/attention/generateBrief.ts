import { DailyBrief, RecommendationStatus } from '@/types/attention';
import { Project } from '@/types/clarity';
import { ContextPack, DurableMemory } from '@/types/contextPack';
import { FeedbackEvent } from '@/types/feedback';
import { generateAttentionCandidates } from '@/lib/attention/candidates';

const briefStore = new Map<string, DailyBrief>();
const feedbackStore = new Map<string, RecommendationStatus>();

export function periodForDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function generateDailyBrief(params: {
  userId: string;
  project: Project;
  memories: DurableMemory[];
  feedbackEvents?: FeedbackEvent[];
  period?: string;
  force?: boolean;
  contextPack?: ContextPack;
  now?: Date;
}): DailyBrief {
  const period = params.period ?? periodForDate();
  const key = `${params.userId}:${params.project.id}:${period}`;
  if (!params.force && briefStore.has(key)) return briefStore.get(key)!;

  const recommendations = generateAttentionCandidates(params)
    .map((candidate) => ({
      ...candidate,
      status: feedbackStore.get(candidate.id) ?? candidate.status,
    }))
    .filter((candidate) => {
      const activeFeedbackSuppression = (params.feedbackEvents ?? []).some((event) => {
        if (event.targetId !== candidate.id) return false;
        if (!event.suppress_until) return false;
        return new Date(event.suppress_until).getTime() > Date.now();
      });
      return !activeFeedbackSuppression;
    })
    .filter((candidate) => candidate.status === 'active')
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const brief: DailyBrief = {
    id: `brief_${params.userId}_${period}`,
    userId: params.userId,
    period,
    generated_at: new Date().toISOString(),
    recommendations,
  };
  briefStore.set(key, brief);
  return brief;
}

export function updateRecommendationStatus(recommendationId: string, status: RecommendationStatus): void {
  feedbackStore.set(recommendationId, status);
  for (const [key, brief] of briefStore.entries()) {
    briefStore.set(key, {
      ...brief,
      recommendations: brief.recommendations.map((recommendation) =>
        recommendation.id === recommendationId ? { ...recommendation, status } : recommendation
      ),
    });
  }
}

export function clearBriefStoreForTests(): void {
  briefStore.clear();
  feedbackStore.clear();
}
