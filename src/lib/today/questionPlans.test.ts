import { describe, expect, it } from 'vitest';
import { TodayQuestion, todayQuestionFromNode } from '@/lib/today/sections';
import { CAREER_CONFLICT_QUESTION_ID, createCareerConflictDemoState } from '@/lib/demo/careerConflict';
import {
  hasUsefulSuggestedAnswer,
  localQuestionPresentation,
  localQuestionSuggestion,
  parseQuestionPresentations,
  parseQuestionSuggestions,
  questionSuggestionRequestMessage,
} from '@/lib/today/questionPlans';

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
  it('creates action-oriented deterministic presentation copy without changing the graph question', () => {
    const roleQuestion: TodayQuestion = {
      id: 'question_role',
      question: 'Does this primarily frontend role remain acceptable given your preference to avoid frontend-heavy roles?',
      reason: 'This determines whether to prepare for or decline the recruiter call.',
      provenance: 'Sources: job-description.pdf',
      sourceNodeIds: ['unknown_role'],
      presentationContext: [
        'The job document describes the position as 70–80% frontend during the first year',
        'Avoid positions dominated by frontend delivery',
      ],
    };
    const presentation = localQuestionPresentation(roleQuestion);

    expect(presentation).toEqual({
      questionId: 'question_role',
      title: 'Decide if this primarily frontend role is worth pursuing',
      summary: 'The role is 70–80% frontend during the first year, which conflicts with your preference to avoid frontend-heavy work.',
    });
    expect(roleQuestion.question).toContain('remain acceptable');
  });

  it('parses only valid action-oriented AI copy and fills missing questions deterministically', () => {
    expect(parseQuestionPresentations(JSON.stringify({
      presentations: [{
        questionId: 'question_budget',
        title: 'Decide what to spend on the trip',
        summary: 'The budget determines which hotels are affordable.',
      }],
    }), questions)).toEqual([
      {
        questionId: 'question_budget',
        title: 'Decide what to spend on the trip',
        summary: 'The budget determines which hotels are affordable.',
      },
      localQuestionPresentation(questions[1]),
    ]);
  });

  it('removes the internal question wrapper from deterministic titles', () => {
    const presentation = localQuestionPresentation({
      id: 'question_wrapper',
      question: 'What should we do about: the launch date?',
      reason: 'The date affects the release plan.',
      provenance: 'Graph node: launch_date',
    });

    expect(presentation.title).toBe('Find out the launch date');
    expect(presentation.title).not.toContain('What should we do about');
  });

  it('keeps confirmation titles grammatical for yes/no questions', () => {
    expect(localQuestionPresentation({
      id: 'question_path',
      question: 'Is there a funded path into applied AI?',
      reason: 'The path affects long-term role fit.',
      provenance: 'Graph node: path',
    }).title).toBe('Confirm there is a funded path into applied AI');
  });

  it('uses supported career-demo details in deterministic fallback copy', () => {
    const state = createCareerConflictDemoState();
    const node = state.project.nodes.find((candidate) => candidate.id === CAREER_CONFLICT_QUESTION_ID)!;
    const question = todayQuestionFromNode(state.project, node);
    const presentation = localQuestionPresentation(question);
    const suggestion = localQuestionSuggestion(question);

    expect(presentation.title).toBe('Decide if the Northstar Labs role is worth pursuing');
    expect(presentation.summary).toContain('70–80% frontend');
    expect(suggestion.suggestedAnswer).toContain('financial stability');
    expect(hasUsefulSuggestedAnswer(suggestion)).toBe(true);
  });

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
