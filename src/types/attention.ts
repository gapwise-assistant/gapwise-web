import { ContextPack } from '@/types/contextPack';

export type RecommendationStatus = 'active' | 'not_now' | 'done';
export type RecommendationKind = 'gap' | 'commitment' | 'opportunity' | 'risk' | 'preparation';

export interface AttentionScoreFactors {
  goal_alignment: number;
  impact: number;
  urgency: number;
  actionability: number;
  evidence_confidence: number;
  unresolved_risk: number;
  momentum: number;
  estimated_effort: number;
}

export interface AttentionCandidate {
  id: string;
  kind: RecommendationKind;
  title: string;
  reason: string;
  next_action: string;
  source_node_ids: string[];
  source_ids: string[];
  context_pack: ContextPack;
  factors: AttentionScoreFactors;
  score: number;
  status: RecommendationStatus;
}

export interface DailyBrief {
  id: string;
  userId: string;
  period: string;
  generated_at: string;
  recommendations: AttentionCandidate[];
}
