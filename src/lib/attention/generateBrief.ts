import { DailyBrief, RecommendationStatus } from '@/types/attention';
import { Project, UserMemoryProfile } from '@/types/clarity';
import { ContextPack, DurableMemory } from '@/types/contextPack';
import { FeedbackEvent } from '@/types/feedback';
import { generateAttentionCandidates } from '@/lib/attention/candidates';
import { questionPriorityThreshold } from '@/lib/personalization/preferences';

const briefStore = new Map<string, DailyBrief>();
const feedbackStore = new Map<string, RecommendationStatus>();

function attentionStateKey(params: {
  project: Project;
  memories: DurableMemory[];
  profile?: UserMemoryProfile;
  contextPack?: ContextPack;
}): string {
  return JSON.stringify({
    project: {
      id: params.project.id,
      title: params.project.title,
      goal: params.project.goal,
      deadline: params.project.deadline ?? null,
      nodes: params.project.nodes
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
      edges: params.project.edges
        .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }))
        .sort((left, right) => `${left.source}:${left.type}:${left.target}`.localeCompare(`${right.source}:${right.type}:${right.target}`)),
      sources: params.project.sources
        .map((source) => ({
          id: source.id,
          filename: source.filename,
          type: source.type,
          content: source.content,
          derived_node_ids: [...source.derived_node_ids].sort(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      history: params.project.history
        .map((entry) => ({ question: entry.question, answer: entry.answer, graph_diff_summary: entry.graph_diff_summary }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    },
    memories: params.memories
      .map((memory) => ({
        category: memory.category,
        text: memory.text,
        source: memory.source,
        confidence: memory.confidence,
        status: memory.status ?? 'active',
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    profile: params.profile
      ? {
        answer_density: params.profile.answer_density,
        question_frequency: params.profile.question_frequency,
        challenge_level: params.profile.challenge_level,
        evidence_preference: params.profile.evidence_preference,
        durable_notes: [...(params.profile.durable_notes ?? [])].sort(),
      }
      : null,
    commitments: (params.contextPack?.upcomingCommitments ?? [])
      .map((node) => ({
        type: node.type,
        text: node.text,
        status: node.status,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

export function periodForDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function generateDailyBrief(params: {
  userId: string;
  project: Project;
  memories: DurableMemory[];
  profile?: UserMemoryProfile;
  feedbackEvents?: FeedbackEvent[];
  period?: string;
  force?: boolean;
  contextPack?: ContextPack;
  now?: Date;
}): DailyBrief {
  const period = params.period ?? periodForDate();
  const key = `${params.userId}:${params.project.id}:${period}:${attentionStateKey(params)}`;
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
    .filter((candidate) => !params.profile
      || candidate.kind !== 'gap'
      || candidate.score >= questionPriorityThreshold(params.profile))
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
