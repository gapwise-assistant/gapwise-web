import { describe, expect, it } from 'vitest';
import { TodayQuestion } from '@/lib/today/sections';
import { hasUsefulSuggestedAnswer, localQuestionSuggestion, parseQuestionSuggestions, questionSuggestionRequestMessage } from '@/lib/today/questionPlans';

const questions: TodayQuestion[] = [
  {
    id: 'question_budget',
    question: 'What is the trip budget?',
    reason: 'It blocks the hotel decision.',
    provenance: 'Sources: japan-trip.txt',
    sourceNodeIds: ['unknown_budget'],
  },
  {
    id: 'question_demo',
    question: 'Are you prepared for the demo?',
    reason: 'Your Calendar shows it is approaching.',
    provenance: 'Source: Google Calendar, 2026-08-14T10:00:00Z',
    sourceNodeIds: ['gcal_demo'],
  },
];

describe('Today question suggestions', () => {
  it('provides a safe deterministic fallback answer and existing importance reason', () => {
    expect(localQuestionSuggestion(questions[0])).toEqual({
      questionId: 'question_budget',
      suggestedAnswer: 'There is not enough confirmed context to answer this yet. Review the linked evidence and add the missing fact, comparison, or decision.',
      whyItMatters: 'It blocks the hotel decision.',
    });
    expect(localQuestionSuggestion(questions[1]).suggestedAnswer).toContain('event details');
  });

  it('parses AI answer suggestions and fills any missing question with a fallback', () => {
    expect(parseQuestionSuggestions(JSON.stringify({
      suggestions: [{
        questionId: 'question_budget',
        suggestedAnswer: 'The trip budget is not recorded yet.',
        whyItMatters: 'It determines which hotels are affordable.',
      }],
    }), questions)).toEqual([
      {
        questionId: 'question_budget',
        suggestedAnswer: 'The trip budget is not recorded yet.',
        whyItMatters: 'It determines which hotels are affordable.',
      },
      localQuestionSuggestion(questions[1]),
    ]);
  });

  it('includes scope, Context Pack use, and answer rationale rules in the AI request', () => {
    const message = questionSuggestionRequestMessage('Japan trip', questions);
    expect(message).toContain('The current scope is: Japan trip.');
    expect(message).toContain('Call get_context_pack first');
    expect(message).toContain('suggested answer');
    expect(message).toContain('why answering this question matters');
    expect(message).toContain('question_budget');
    expect(message).toContain('{"suggestions"');
  });

  it('only marks an answer suggestion useful when it contains actionable evidence', () => {
    expect(hasUsefulSuggestedAnswer({
      questionId: 'question_budget',
      suggestedAnswer: 'The trip budget is not recorded yet.',
      whyItMatters: 'It determines which hotels are affordable.',
    })).toBe(false);
    expect(hasUsefulSuggestedAnswer({
      questionId: 'question_budget',
      suggestedAnswer: 'The notes put the monthly budget at $2,000.',
      whyItMatters: 'It determines which hotels are affordable.',
    })).toBe(true);
  });
});
