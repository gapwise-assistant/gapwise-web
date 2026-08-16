import type { ClarityNode, NodeType, Project } from '@/types/clarity';

export type AnswerUnderstandingType = Extract<
  NodeType,
  'CONSTRAINT' | 'PREFERENCE' | 'KNOWN' | 'EVIDENCE' | 'DECISION' | 'NEXT_ACTION'
>;

export interface AnswerClassification {
  type: AnswerUnderstandingType;
  text: string;
  supersedesOriginal: boolean;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function amountFrom(answer: string): string | null {
  return answer.match(/(?:[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*(?:month|mo|year|week))?)/i)?.[0] ?? null;
}

function isBudgetLimit(question: string, answer: string): boolean {
  const text = `${question} ${answer}`;
  return Boolean(amountFrom(answer)) &&
    /\b(?:budget|cost|costs|rent|housing|apartment|monthly|afford|utilities|limit|maximum|cap)\b/i.test(text) &&
    /\b(?:above|over|more than|exceed|below|under|at most|no more|limit|maximum|cap|afford|don't want|do not want|can't afford|cannot afford)\b/i.test(answer);
}

function isCorrection(questionNode: ClarityNode, answer: string): boolean {
  return questionNode.type === 'ASSUMPTION' &&
    /\b(?:actually|was wrong|not true|correct(?:ion|ed)?|instead|no longer|i thought .* but)\b/i.test(answer);
}

function constraintText(question: string, answer: string): string {
  const amount = amountFrom(answer);
  if (!amount) return normalized(answer);
  const subject = /\b(?:housing|apartment|rent|utilities|home)\b/i.test(`${question} ${answer}`)
    ? 'Housing-related costs'
    : /\bmonthly\b/i.test(`${question} ${answer}`)
      ? 'Monthly costs'
      : 'Costs';
  if (/\b(?:at least|minimum|no less than)\b/i.test(answer)) {
    return `${subject} should be at least ${amount}.`;
  }
  return `${subject} should stay at or below ${amount}.`;
}

/**
 * Classifies the user's meaning without another model call. The question
 * answer is already a user-confirmed statement, so conservative heuristics
 * are preferable to silently storing every answer as a decision.
 */
export function classifyAnswer(
  questionNode: Pick<ClarityNode, 'type' | 'text'>,
  answer: string,
  _project?: Pick<Project, 'nodes' | 'edges'>,
): AnswerClassification {
  const cleanAnswer = normalized(answer);
  const question = normalized(questionNode.text);

  if (isBudgetLimit(question, cleanAnswer)) {
    return { type: 'CONSTRAINT', text: constraintText(question, cleanAnswer), supersedesOriginal: false };
  }

  if (isCorrection(questionNode as ClarityNode, cleanAnswer)) {
    return { type: 'KNOWN', text: cleanAnswer, supersedesOriginal: true };
  }

  if (/\b(?:i will|i'll|we will|we'll|going to|plan to|need to|must|commit(?:ted)? to|schedule)\b/i.test(cleanAnswer)) {
    return { type: 'NEXT_ACTION', text: cleanAnswer, supersedesOriginal: false };
  }

  if (/\b(?:choose|chose|pick|picked|select|selected|go with|my choice|the choice is|decided|decision)\b/i.test(cleanAnswer)) {
    return { type: 'DECISION', text: cleanAnswer, supersedesOriginal: false };
  }

  if (/\b(?:prefer|would rather|like|love|don't like|do not like|dislike|want|priorit(?:y|ize)|important to me)\b/i.test(cleanAnswer)) {
    return { type: 'PREFERENCE', text: cleanAnswer, supersedesOriginal: false };
  }

  return {
    type: /\b(?:evidence|source|observed|measured|tested|confirmed)\b/i.test(cleanAnswer) ? 'EVIDENCE' : 'KNOWN',
    text: cleanAnswer,
    supersedesOriginal: false,
  };
}

