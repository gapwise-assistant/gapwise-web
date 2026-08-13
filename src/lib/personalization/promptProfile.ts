import { UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { citationDensity, questionPriorityThreshold, shouldSuggestTemporaryAssumptions } from '@/lib/personalization/preferences';

export interface PromptProfile {
  answerDensity: UserMemoryProfile['answer_density'];
  questionPriorityThreshold: number;
  challengeLevel: UserMemoryProfile['challenge_level'];
  citationLimit: number;
  suggestTemporaryAssumptions: boolean;
  memoryReasons: Array<{ id: string; text: string; why: string }>;
}

export function buildPromptProfile(profile: UserMemoryProfile, memories: DurableMemory[]): PromptProfile {
  return {
    answerDensity: profile.answer_density,
    questionPriorityThreshold: questionPriorityThreshold(profile),
    challengeLevel: profile.challenge_level,
    citationLimit: citationDensity(profile),
    suggestTemporaryAssumptions: shouldSuggestTemporaryAssumptions(profile),
    memoryReasons: memories
      .filter((memory) => !memory.forgotten_at)
      .slice(0, 8)
      .map((memory) => ({
        id: memory.id,
        text: memory.text,
        why: memory.why_remembered,
      })),
  };
}
