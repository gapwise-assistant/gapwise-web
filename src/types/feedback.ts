export type FeedbackTargetType = 'question' | 'recommendation' | 'memory' | 'insight';
export type FeedbackRating =
  | 'useful'
  | 'not_useful'
  | 'already_done'
  | 'wrong_assumption'
  | 'not_now';

export interface FeedbackEvent {
  id: string;
  userId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  rating: FeedbackRating;
  explanation?: string;
  created_at: string;
  suppress_until?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface FeedbackSummary {
  notUsefulByKind: Record<string, number>;
  suppressedTargetIds: string[];
}
