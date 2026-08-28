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

export function answerDensityInstruction(profile: UserMemoryProfile): string {
  if (profile.answer_density === 'concise') return 'Keep answers concise and focused on the most useful point.';
  if (profile.answer_density === 'detailed') return 'Provide enough explanation and tradeoff detail to make the reasoning clear.';
  return 'Keep answers balanced: explain the key reasoning without producing an exhaustive plan.';
}

export function challengeInstruction(profile: UserMemoryProfile): string {
  if (profile.challenge_level === 'low') return 'Challenge assumptions gently and only when a material issue is apparent.';
  if (profile.challenge_level === 'high') return 'Actively test important assumptions and name material counterarguments or risks.';
  return 'Test important assumptions when doing so would materially improve the recommendation.';
}

export function evidenceInstruction(profile: UserMemoryProfile): string {
  if (profile.evidence_preference === 'strict_data') return 'Prefer verified project evidence and clearly label anything not supported by data.';
  if (profile.evidence_preference === 'research_first') return 'Prefer evidence and external research when factual verification would improve the answer.';
  return 'Use project evidence where available, while allowing clearly labeled judgment when evidence is limited.';
}
