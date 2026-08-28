import { UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import {
  answerDensityInstruction,
  challengeInstruction,
  citationDensity,
  evidenceInstruction,
  questionPriorityThreshold,
  shouldSuggestTemporaryAssumptions,
} from '@/lib/personalization/preferences';

export interface PromptProfile {
  answerDensity: UserMemoryProfile['answer_density'];
  questionPriorityThreshold: number;
  challengeLevel: UserMemoryProfile['challenge_level'];
  citationLimit: number;
  suggestTemporaryAssumptions: boolean;
  answerInstruction: string;
  challengeInstruction: string;
  evidenceInstruction: string;
  memoryReasons: Array<{ id: string; text: string; why: string }>;
}

type PromptMemory = Pick<DurableMemory, 'id' | 'text' | 'why_remembered'> & Partial<Pick<DurableMemory, 'forgotten_at' | 'expires_at' | 'status'>>;

function activePromptMemories(memories: PromptMemory[]): PromptMemory[] {
  const now = Date.now();
  return memories.filter((memory) => {
    if (memory.forgotten_at || memory.status === 'forgotten') return false;
    if (!memory.expires_at) return true;
    return new Date(memory.expires_at).getTime() > now;
  });
}

export function buildPromptProfile(profile: UserMemoryProfile, memories: PromptMemory[]): PromptProfile {
  return {
    answerDensity: profile.answer_density,
    questionPriorityThreshold: questionPriorityThreshold(profile),
    challengeLevel: profile.challenge_level,
    citationLimit: citationDensity(profile),
    suggestTemporaryAssumptions: shouldSuggestTemporaryAssumptions(profile),
    answerInstruction: answerDensityInstruction(profile),
    challengeInstruction: challengeInstruction(profile),
    evidenceInstruction: evidenceInstruction(profile),
    memoryReasons: activePromptMemories(memories)
      .slice(0, 8)
      .map((memory) => ({
        id: memory.id,
        text: memory.text,
        why: memory.why_remembered,
      })),
  };
}
