import { Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AttentionCandidate, RecommendationStatus } from '@/types/attention';
import { FeedbackEvent, FeedbackRating, FeedbackTargetType } from '@/types/feedback';
import { createDurableMemory } from '@/lib/memory/policy';
import { forgetMemory } from '@/lib/memory/store';

function makeFeedbackId(targetType: FeedbackTargetType, targetId: string): string {
  return `fb_${targetType}_${targetId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createFeedbackEvent(params: {
  userId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  rating: FeedbackRating;
  explanation?: string;
  suppressDays?: number;
  suppressMinutes?: number;
  suppressUntil?: string;
  metadata?: FeedbackEvent['metadata'];
}): FeedbackEvent {
  const now = new Date();
  return {
    id: makeFeedbackId(params.targetType, params.targetId),
    userId: params.userId,
    targetType: params.targetType,
    targetId: params.targetId,
    rating: params.rating,
    explanation: params.explanation,
    created_at: now.toISOString(),
    suppress_until: params.suppressUntil ?? (
      params.suppressMinutes
        ? new Date(now.getTime() + params.suppressMinutes * 60 * 1000).toISOString()
        : params.suppressDays
          ? new Date(now.getTime() + params.suppressDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined
    ),
    metadata: params.metadata,
  };
}

export function statusFromFeedback(rating: FeedbackRating): RecommendationStatus | null {
  if (rating === 'already_done') return 'done';
  if (rating === 'not_now') return 'not_now';
  return null;
}

export function applyCorrectionToMemories(params: {
  memories: DurableMemory[];
  explanation: string;
}): DurableMemory[] {
  const created = createDurableMemory(params.explanation.startsWith('Remember that') ? params.explanation : `Remember that ${params.explanation}`);
  if (!created) return params.memories;

  const lower = created.text.toLowerCase();
  const superseded = params.memories.map((memory) => {
    const old = memory.text.toLowerCase();
    const samePriority =
      memory.category === created.category &&
      (lower.includes('priority') || old.includes('priority')) &&
      !memory.forgotten_at;
    const frontendCorrection = lower.includes('frontend') && old.includes('frontend') && !memory.forgotten_at;
    return samePriority || frontendCorrection ? forgetMemory([memory], memory.id)[0] : memory;
  });

  return [created, ...superseded];
}

export function applyWrongAssumptionToProject(project: Project, targetId: string, explanation?: string): Project {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const target = updated.nodes.find((node) => node.id === targetId);
  if (target) {
    target.status = 'DEPRECATED';
    target.updated_at = new Date().toISOString();
    if (explanation) {
      updated.nodes.push({
        id: `correction_${Date.now()}`,
        type: 'KNOWN',
        text: explanation,
        status: 'RESOLVED',
        confidence: 0.9,
        impact: target.impact,
        source_refs: target.source_refs,
        created_by: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }
  updated.updated_at = new Date().toISOString();
  return updated;
}

export function recommendationKind(candidate: AttentionCandidate): string {
  return candidate.kind;
}

export function adaptProfileFromFeedback(profile: UserMemoryProfile, event: FeedbackEvent): UserMemoryProfile {
  if (event.targetType === 'question' && event.rating === 'not_useful') {
    return {
      ...profile,
      question_frequency: profile.question_frequency === 'high' ? 'moderate' : 'low',
    };
  }
  if (event.rating === 'wrong_assumption') {
    return {
      ...profile,
      challenge_level: 'high',
      uncertainty_style: 'explicit',
    };
  }
  return profile;
}
