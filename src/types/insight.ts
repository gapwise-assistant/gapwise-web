import { ContextPack, EvidenceExcerpt } from '@/types/contextPack';

export type InsightType = 'LOOSE_END' | 'POSSIBLE_CONTEXT_CHANGE' | 'STALE_CONTEXT';
export type InsightStatus = 'open' | 'confirmed' | 'dismissed' | 'updated';
export type InsightAction = 'confirm' | 'dismiss' | 'still_true' | 'changed' | 'not_relevant';

export interface InsightEvidence {
  node_ids: string[];
  source_ids: string[];
  excerpts: EvidenceExcerpt[];
}

export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  summary: string;
  question: string;
  priority: number;
  status: InsightStatus;
  created_at: string;
  updated_at: string;
  suppress_until?: string;
  evidence: InsightEvidence;
  context_pack: ContextPack;
}
