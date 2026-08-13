import { UserMemoryProfile } from '@/types/clarity';

export function questionPriorityThreshold(profile: UserMemoryProfile): number {
  if (profile.question_frequency === 'low') return 0.78;
  if (profile.question_frequency === 'high') return 0.45;
  return 0.6;
}

export function citationDensity(profile: UserMemoryProfile): number {
  if (profile.evidence_preference === 'strict_data') return 5;
  if (profile.evidence_preference === 'research_first') return 3;
  return 1;
}

export function shouldSuggestTemporaryAssumptions(profile: UserMemoryProfile): boolean {
  return profile.uncertainty_style === 'explicit';
}
