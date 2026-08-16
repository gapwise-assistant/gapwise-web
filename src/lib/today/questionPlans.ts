import type { TodayQuestion } from '@/lib/today/sections';

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

function titleValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = compact(value).replace(/[.!?]+$/g, '');
  if (normalized.length < 8 || normalized.length > 120) return null;
  if (normalized.split(/\s+/).length > 14) return null;
  if (!/^(decide|confirm|clarify|find out|verify|check)\b/i.test(normalized)) return null;
  return normalized;
}

function summaryValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = compact(value);
  if (normalized.length < 8 || normalized.length > 240) return null;
  if (/^(?:blocks?|affects?)\b|^this (?:question|answer)\b.*\b(?:decision|interview)\b/i.test(normalized)) return null;
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? normalized;
  return sentence(firstSentence);
}

function questionWithoutPunctuation(question: string): string {
  const normalized = compact(question).replace(/[?!.]+$/g, '').trim();
  return normalized.replace(/^what should we do about:\s*/i, '').trim();
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function namedCompany(facts: string[]): string | undefined {
  for (const fact of facts) {
    const match = fact.match(/\b(?:at|for)\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/);
    if (match?.[1]) return match[1].replace(/[,.]$/, '');
  }
  return undefined;
}

function roleFitFallback(question: TodayQuestionLike): TodayQuestionPresentation | null {
  const raw = questionWithoutPunctuation(question.question);
  const match = raw.match(/^Does\s+(.+?)\s+remain acceptable\b/i);
  if (!match) return null;
  const facts = question.presentationContext ?? [];
  const company = namedCompany(facts);
  const subject = company ? `the ${company} role` : match[1].replace(/^this\s+/i, 'this ');
  const roleFact = facts.find((fact) => /\bfrontend\b/i.test(fact));
  const preferenceFact = facts.find((fact) => /avoid|preference|preferred direction|dominated by frontend/i.test(fact));
  let summary = 'The role may conflict with your preferred direction.';
  if (roleFact && preferenceFact) {
    const roleMatch = roleFact.match(/(\d+\s*[–-]\s*\d+%\s+frontend(?:\s+(?:during|in)\s+[^,.]+)?)/i);
    const role = roleMatch?.[1] ?? 'primarily frontend';
    summary = `The role is ${role}, which conflicts with your preference to avoid frontend-heavy work.`;
  } else if (roleFact) {
    summary = `${sentence(roleFact, 150).replace(/\.$/, '')}, so role fit still needs a decision.`;
  }
  return {
    questionId: question.id,
    title: `Decide if ${subject} is worth pursuing`,
    summary: sentence(summary),
  };
}

function deterministicPresentation(question: TodayQuestionLike): TodayQuestionPresentation {
  const roleFit = roleFitFallback(question);
  if (roleFit) return roleFit;

  const wrappedQuestion = /^what should we do about:/i.test(question.question);
  const raw = questionWithoutPunctuation(question.question);
  const lower = lowerFirst(raw);
  let title: string;
  if (wrappedQuestion || /^what percentage\b/i.test(raw)) title = `Find out ${lower}`;
  else if (/^what\b/i.test(raw)) title = `Find out ${lower}`;
  else if (/^which\b/i.test(raw)) title = `Clarify ${lower}`;
  else if (/^is there\b/i.test(raw)) title = `Confirm there is ${lower.replace(/^is there\s+/i, '')}`;
  else if (/^is\b/i.test(raw)) title = `Confirm ${lower.replace(/^is\s+/i, '')}`;
  else if (/^(are|does|do|can|will|should)\b/i.test(raw)) title = `Confirm ${lower.replace(/^(are|does|do|can|will|should)\s+/i, 'that ')}`;
  else title = `Clarify ${lower}`;

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
    title: sentence(title, 120).replace(/\.$/, ''),
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

  const roleFit = roleFitFallback(question);
  if (roleFit && question.presentationContext?.length) {
    const roleFact = question.presentationContext.find((fact) => /\bfrontend\b/i.test(fact));
    const roleMatch = roleFact?.match(/(\d+\s*[–-]\s*\d+%\s+frontend(?:\s+(?:during|in)\s+[^,.]+)?)/i);
    const role = roleMatch?.[1] ?? 'primarily frontend';
    return {
      questionId: question.id,
      suggestedAnswer: `The role is ${role} in the documented period. Decide whether financial stability makes that tradeoff acceptable despite the preference to avoid frontend-heavy work.`,
      whyItMatters: question.reason,
    };
  }

  if (/what percentage.*normal week|steady-state.*frontend/i.test(question.question) && question.presentationContext?.length) {
    return {
      questionId: question.id,
      suggestedAnswer: 'Find out the normal-week frontend percentage after the dashboard launch before deciding whether the role fits.',
      whyItMatters: question.reason,
    };
  }

  if (/funded.*manager-supported|path into backend|path into applied ai/i.test(question.question)) {
    return {
      questionId: question.id,
      suggestedAnswer: 'Confirm whether the path beyond frontend work is funded, manager-supported, and tied to a real team need.',
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
    const title = titleValue(entry.title);
    const summary = summaryValue(entry.summary);
    if (title && summary) byId.set(id, { questionId: id, title, summary });
  });

  return questions.map((question) => byId.get(question.id) ?? localQuestionPresentation(question));
}

export function questionSuggestionRequestMessage(
  scopeLabel: string,
  questions: TodayQuestionSuggestionInput[]
): string {
  const questionList = questions
    .map((question) => `${question.id}: ${question.question} (${question.reason}; ${question.provenance}${question.presentationContext?.length ? `; context: ${question.presentationContext.join(' | ')}` : ''})`)
    .join(' | ');
  return [
    'This is an internal Gapswise Today presentation request, not a normal chat reply.',
    `The current scope is: ${scopeLabel}.`,
    'Call get_context_pack first using the current user and the current scope before answering.',
    `Create an evidence-aware presentation and suggested answer for each of these questions: ${questionList}`,
    'For each question, create presentation copy with only a short action-oriented title and one-sentence summary.',
    'Prefer title verbs Decide, Confirm, Clarify, or Find out. Do not repeat the raw graph question, expose graph/system wording, or use generic text such as “Blocks interview decision.”',
    'Use concrete names and details only when they are supported by the current Context Pack. Never invent facts.',
    'For each question, provide a concise suggested answer or draft answer based only on the current Context Pack.',
    'Also provide one sentence explaining exactly why answering this question matters for the current project goal.',
    'Use the current goals, gaps, evidence, decisions, contradictions, and commitments when they are available.',
    'If evidence is missing, say what is missing in the suggested answer and do not invent facts.',
    'Do not return a generic plan instead of an answer when the context supports a specific answer.',
    'Return only valid JSON in this exact shape: {"suggestions":[{"questionId":"...","suggestedAnswer":"...","whyItMatters":"..."}],"presentations":[{"questionId":"...","title":"...","summary":"..."}]}.',
  ].join(' ');
}
