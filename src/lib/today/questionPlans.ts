import type { TodayQuestion } from '@/lib/today/sections';

export interface TodayQuestionSuggestion {
  questionId: string;
  suggestedAnswer: string;
  whyItMatters: string;
}

export type TodayQuestionLike = Pick<TodayQuestion, 'id' | 'question' | 'reason' | 'provenance'>;

export interface TodayQuestionSuggestionInput {
  id: string;
  question: string;
  reason: string;
  provenance: string;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length >= 8 && text.length <= 240 ? text : null;
}

function isCalendarQuestion(question: TodayQuestionLike): boolean {
  return question.provenance.toLowerCase().includes('google calendar');
}

export function localQuestionSuggestion(question: TodayQuestionLike): TodayQuestionSuggestion {
  if (isCalendarQuestion(question)) {
    return {
      questionId: question.id,
      suggestedAnswer: 'I cannot confirm that you are prepared yet. Review the event details and identify the one preparation task still outstanding.',
      whyItMatters: question.reason,
    };
  }

  return {
    questionId: question.id,
    suggestedAnswer: 'There is not enough confirmed context to answer this yet. Review the linked evidence and add the missing fact, comparison, or decision.',
    whyItMatters: question.reason,
  };
}

export function localQuestionSuggestions(questions: TodayQuestionLike[]): TodayQuestionSuggestion[] {
  return questions.map(localQuestionSuggestion);
}

function parsedObject(answer: string): Record<string, unknown> | null {
  const normalized = answer.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const candidates = [normalized];
  const start = normalized.lastIndexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(normalized.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // Use deterministic suggestions for malformed or partial model output.
    }
  }
  return null;
}

function planEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
}

function questionKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseQuestionSuggestions(answer: string, questions: TodayQuestionLike[]): TodayQuestionSuggestion[] {
  const parsed = parsedObject(answer);
  const entries = planEntries(parsed?.suggestions ?? parsed?.plans);
  const byId = new Map<string, TodayQuestionSuggestion>();
  const byQuestion = new Map(questions.map((question) => [questionKey(question.question), question.id]));

  entries.forEach((entry) => {
    const rawId = typeof entry.questionId === 'string' ? entry.questionId : undefined;
    const rawQuestion = typeof entry.question === 'string' ? entry.question : undefined;
    const id = rawId && questions.some((question) => question.id === rawId)
      ? rawId
      : rawQuestion
        ? byQuestion.get(questionKey(rawQuestion))
        : undefined;
    if (!id) return;
    const suggestedAnswer = cleanText(entry.suggestedAnswer ?? entry.suggested_answer ?? entry.answer);
    const whyItMatters = cleanText(entry.whyItMatters ?? entry.why_it_matters);
    if (suggestedAnswer) {
      const question = questions.find((item) => item.id === id);
      byId.set(id, {
        questionId: id,
        suggestedAnswer,
        whyItMatters: whyItMatters ?? question?.reason ?? 'This question may affect the next project decision.',
      });
    }
  });

  return questions.map((question) => byId.get(question.id) ?? localQuestionSuggestion(question));
}

export function questionSuggestionRequestMessage(
  scopeLabel: string,
  questions: TodayQuestionSuggestionInput[]
): string {
  const questionList = questions
    .map((question) => `${question.id}: ${question.question} (${question.reason}; ${question.provenance})`)
    .join(' | ');
  return [
    'This is an internal Gapswise Today answer-suggestion request, not a normal chat reply.',
    `The current scope is: ${scopeLabel}.`,
    'Call get_context_pack first using the current user and the current scope before answering.',
    `Create an evidence-aware suggested answer for each of these questions: ${questionList}`,
    'For each question, provide a concise suggested answer or draft answer based only on the current Context Pack.',
    'Also provide one sentence explaining exactly why answering this question matters for the current project goal.',
    'Use the current goals, gaps, evidence, decisions, contradictions, and commitments when they are available.',
    'If evidence is missing, say what is missing in the suggested answer and do not invent facts.',
    'Do not return a generic plan instead of an answer when the context supports a specific answer.',
    'Return only valid JSON in this exact shape: {"suggestions":[{"questionId":"...","suggestedAnswer":"...","whyItMatters":"..."}]}.',
  ].join(' ');
}
