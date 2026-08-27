import type { TodayQuestion } from '@/lib/today/sections';
import { BOUNDED_ID_MAX_LENGTH } from '@/lib/ids/boundedId';

export const QUESTION_PLAN_MAX_QUESTIONS = 4;
export const QUESTION_PLAN_MAX_CONTEXT_ENTRIES = 6;
export const QUESTION_PLAN_ID_MAX_LENGTH = BOUNDED_ID_MAX_LENGTH + 40;
export const QUESTION_PLAN_SCOPE_LABEL_MAX_LENGTH = 120;
export const QUESTION_PLAN_QUESTION_MAX_LENGTH = 300;
export const QUESTION_PLAN_REASON_MAX_LENGTH = 500;
export const QUESTION_PLAN_PROVENANCE_MAX_LENGTH = 500;
export const QUESTION_PLAN_CONTEXT_MAX_LENGTH = 300;

export interface TodayQuestionSuggestion {
  questionId: string;
  suggestedAnswer: string;
  whyItMatters: string;
}

export interface TodayQuestionPresentation {
  questionId: string;
  title: string;
  summary: string;
}

export type TodayQuestionLike = Pick<TodayQuestion, 'id' | 'question' | 'reason' | 'provenance' | 'presentationContext'>;

export interface TodayQuestionSuggestionInput {
  id: string;
  question: string;
  reason: string;
  provenance: string;
  presentationContext?: string[];
}

export interface QuestionPlanRequestInput {
  userId?: string;
  projectId?: string;
  scopeLabel: string;
  questions: TodayQuestionSuggestionInput[];
}

export interface NormalizedQuestionPlanRequest {
  userId?: string;
  projectId?: string;
  scopeLabel: string;
  questions: TodayQuestionSuggestionInput[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function boundedText(value: string, maxLength: number): string {
  return normalizeWhitespace(value).slice(0, maxLength).trim();
}

/**
 * Keeps the client and endpoint on the same bounded request contract. IDs are
 * intentionally never shortened: they are canonical lookup keys.
 */
export function normalizeQuestionPlanRequest(
  input: QuestionPlanRequestInput,
): NormalizedQuestionPlanRequest {
  return {
    ...(input.userId ? { userId: normalizeWhitespace(input.userId) } : {}),
    ...(input.projectId ? { projectId: normalizeWhitespace(input.projectId) } : {}),
    scopeLabel: boundedText(input.scopeLabel, QUESTION_PLAN_SCOPE_LABEL_MAX_LENGTH),
    questions: input.questions
      .slice(0, QUESTION_PLAN_MAX_QUESTIONS)
      .map((question) => {
        const presentationContext = (question.presentationContext ?? [])
          .map((entry) => boundedText(entry, QUESTION_PLAN_CONTEXT_MAX_LENGTH))
          .filter(Boolean)
          .slice(0, QUESTION_PLAN_MAX_CONTEXT_ENTRIES);
        return {
          id: question.id,
          question: boundedText(question.question, QUESTION_PLAN_QUESTION_MAX_LENGTH),
          reason: boundedText(question.reason, QUESTION_PLAN_REASON_MAX_LENGTH),
          provenance: boundedText(question.provenance, QUESTION_PLAN_PROVENANCE_MAX_LENGTH),
          ...(presentationContext.length ? { presentationContext } : {}),
        };
      }),
  };
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length >= 8 && text.length <= 240 ? text : null;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[-*•\s]+/, '').trim();
}

function sentence(value: string, maxLength = 220): string {
  const normalized = compact(value).replace(/[.!?]+$/g, '');
  if (!normalized) return '';
  const shortened = normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).replace(/\s+\S*$/, '')}…` : normalized;
  return `${shortened}.`;
}

function summaryValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = compact(value)
    .replace(/\b(?:supported|informed) by:\s*["“][^"”]+["”]\s*\.?/gi, '')
    .replace(/"([^"]+)"/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (normalized.length < 8 || normalized.length > 180) return null;
  if (/^(?:blocks?|affects?)\b|\bblocks?:\s*["“]|^explicitly blocks\b|^this (?:question|answer)\b.*\b(?:decision|interview)\b/i.test(normalized)) return null;
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? normalized;
  return sentence(firstSentence, 150);
}

function deterministicPresentation(question: TodayQuestionLike): TodayQuestionPresentation {
  const context = question.presentationContext?.find(Boolean);
  const reason = question.reason.trim();
  const genericReason = /^(blocks?|affects?|this unresolved item|a decision depends|resolve these)/i.test(reason);
  let summary = genericReason
    ? (context ? 'The available evidence still needs confirmation before this decision can be made.' : 'Clarify this before choosing the next step.')
    : reason;
  if (/google calendar/i.test(question.provenance)) {
    summary = 'Confirm the preparation details before the upcoming commitment.';
  }

  return {
    questionId: question.id,
    title: question.question,
    summary: sentence(summary),
  };
}

export function localQuestionPresentation(question: TodayQuestionLike): TodayQuestionPresentation {
  return deterministicPresentation(question);
}

export function localQuestionPresentations(questions: TodayQuestionLike[]): TodayQuestionPresentation[] {
  return questions.map(localQuestionPresentation);
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

export function hasUsefulSuggestedAnswer(suggestion: TodayQuestionSuggestion): boolean {
  return !/(not enough|not recorded|no confirmed|cannot confirm|can't confirm|unable to|do not have enough|don't have enough|missing information|not available|unknown)/i.test(
    suggestion.suggestedAnswer
  );
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

export function parseQuestionPresentations(answer: string, questions: TodayQuestionLike[]): TodayQuestionPresentation[] {
  const parsed = parsedObject(answer);
  const entries = planEntries(parsed?.presentations ?? parsed?.questionCopies ?? parsed?.copy);
  const byId = new Map<string, TodayQuestionPresentation>();
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
    const summary = summaryValue(entry.summary);
    if (summary) {
      const question = questions.find((item) => item.id === id);
      if (question) byId.set(id, { questionId: id, title: question.question, summary });
    }
  });

  return questions.map((question) => ({
    ...(byId.get(question.id) ?? localQuestionPresentation(question)),
    title: question.question,
  }));
}

export function questionSuggestionRequestMessage(
  scopeLabel: string,
  questions: TodayQuestionSuggestionInput[]
): string {
  const normalized = normalizeQuestionPlanRequest({ scopeLabel, questions });
  const questionList = normalized.questions
    .map((question) => `${question.id}: ${question.question} (${question.reason}; ${question.provenance}${question.presentationContext?.length ? `; context: ${question.presentationContext.join(' | ')}` : ''})`)
    .join(' | ');
  return [
    'This is an internal Gapwise Today presentation request, not a normal chat reply.',
    `The current scope is: ${scopeLabel}.`,
    'Call get_context_pack first using the current user and the current scope before answering.',
    `Create an evidence-aware presentation and suggested answer for each of these questions: ${questionList}`,
    'For each question, keep the canonical question text as the title and provide only a one-sentence summary. The title is immutable: do not rewrite, shorten, or replace it.',
    'Use concrete names and details only when they are supported by the current Context Pack. Never invent facts.',
    'For each question, provide a concise suggested answer or draft answer based only on the current Context Pack.',
    'Also provide one sentence explaining exactly why answering this question matters for the current project goal.',
    'Use the current goals, gaps, evidence, decisions, contradictions, and commitments when they are available.',
    'If evidence is missing, say what is missing in the suggested answer and do not invent facts.',
    'Do not return a generic plan instead of an answer when the context supports a specific answer.',
    'Return only valid JSON in this exact shape: {"suggestions":[{"questionId":"...","suggestedAnswer":"...","whyItMatters":"..."}],"presentations":[{"questionId":"...","title":"...","summary":"..."}]}.',
  ].join(' ');
}
