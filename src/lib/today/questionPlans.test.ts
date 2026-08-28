import { describe, expect, it } from 'vitest';
import { TodayQuestion, todayQuestionFromNode } from '@/lib/today/sections';
import { CAREER_CONFLICT_QUESTION_ID, createCareerConflictDemoState } from '@/lib/demo/careerConflict';
import {
  hasUsefulSuggestedAnswer,
  localQuestionPresentation,
  localQuestionSuggestion,
  normalizeQuestionPlanRequest,
  parseQuestionPresentations,
  parseQuestionSuggestions,
  QUESTION_PLAN_ID_MAX_LENGTH,
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
  it('normalizes request text without truncating canonical question IDs', () => {
    const id = `question_${'x'.repeat(QUESTION_PLAN_ID_MAX_LENGTH - 'question_'.length)}`;
    const normalized = normalizeQuestionPlanRequest({
      scopeLabel: '  Japan\n trip  ',
      questions: [{
        id,
        question: '  What\n is the budget?  ',
        reason: '  It affects the decision. ',
        provenance: '  Source note  ',
        presentationContext: ['  First\ncontext  ', '   ', 'Second context'],
      }],
    });

    expect(normalized.questions).toEqual([{
      id,
      question: 'What is the budget?',
      reason: 'It affects the decision.',
      provenance: 'Source note',
      presentationContext: ['First context', 'Second context'],
    }]);
  });

  it('bounds presentation context and keeps only the supported question count', () => {
    const normalized = normalizeQuestionPlanRequest({
      scopeLabel: 'Project',
      questions: Array.from({ length: 5 }, (_, index) => ({
        id: `question_${index}`,
        question: `Question ${index}`,
        reason: 'Reason',
        provenance: 'Source',
        presentationContext: Array.from({ length: 8 }, (_, contextIndex) => `${contextIndex} ${'x'.repeat(400)}`),
      })),
    });

    expect(normalized.questions).toHaveLength(4);
    expect(normalized.questions[0].presentationContext).toHaveLength(6);
    expect(normalized.questions[0].presentationContext?.every((entry) => entry.length <= 300)).toBe(true);
  });

  it('keeps the canonical graph question as deterministic presentation copy', () => {
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
      title: roleQuestion.question,
      summary: 'This determines whether to prepare for or decline the recruiter call.',
    });
    expect(roleQuestion.question).toContain('remain acceptable');
  });

  it('keeps canonical titles while accepting concise AI summaries', () => {
    expect(parseQuestionPresentations(JSON.stringify({
      presentations: [{
        questionId: 'question_budget',
        title: 'Clarify the normal frontend workload after launch',
        summary: 'Supported by: "The first-year estimate". The steady-state role may be less frontend-heavy.',
      }],
    }), questions)[0]).toEqual({
      questionId: 'question_budget',
      title: 'What is the trip budget?',
      summary: 'The steady-state role may be less frontend-heavy.',
    });
  });

  it('parses valid AI summaries and fills missing questions deterministically', () => {
    expect(parseQuestionPresentations(JSON.stringify({
      presentations: [{
        questionId: 'question_budget',
        title: 'What is the trip budget?',
        summary: 'The budget determines which hotels are affordable.',
      }],
    }), questions)).toEqual([
      {
        questionId: 'question_budget',
        title: 'What is the trip budget?',
        summary: 'The budget determines which hotels are affordable.',
      },
      localQuestionPresentation(questions[1]),
    ]);
  });

  it('does not rewrite canonical question wrappers in presentation code', () => {
    const presentation = localQuestionPresentation({
      id: 'question_wrapper',
      question: 'What should we do about: the launch date?',
      reason: 'The date affects the release plan.',
      provenance: 'Graph node: launch_date',
    });

    expect(presentation.title).toBe('What should we do about: the launch date?');
  });

  it('preserves canonical yes/no question grammar', () => {
    expect(localQuestionPresentation({
      id: 'question_path',
      question: 'Is there a funded path into applied AI?',
      reason: 'The path affects long-term role fit.',
      provenance: 'Graph node: path',
    }).title).toBe('Is there a funded path into applied AI?');

    expect(localQuestionPresentation({
      id: 'question_retry',
      question: 'Can the offline queue retry without creating duplicate EHR records?',
      reason: 'Blocks the pilot decision.',
      provenance: 'Graph node: retry',
    }).title).toBe('Can the offline queue retry without creating duplicate EHR records?');

    expect(localQuestionPresentation({
      id: 'question_budget_approval',
      question: 'Has Finance approved spending above $45,000 for the pilot?',
      reason: 'Budget approval is still missing.',
      provenance: 'Graph node: budget',
    }).title).toBe('Has Finance approved spending above $45,000 for the pilot?');

    expect(localQuestionPresentation({
      id: 'question_build_budget',
      question: 'Can the final configuration stay under the $1,600 all-in budget after tax and shipping?',
      reason: 'Determines budget compliance.',
      provenance: 'Graph node: budget',
    }).title).toBe('Can the final configuration stay under the $1,600 all-in budget after tax and shipping?');

    expect(localQuestionPresentation({
      id: 'question_fit',
      question: 'Will the PC run too hot or loud inside the tightly constrained desk opening?',
      reason: 'Determines acoustic and thermal comfort.',
      provenance: 'Graph node: fit',
    }).title).toBe('Will the PC run too hot or loud inside the tightly constrained desk opening?');

    expect(localQuestionPresentation({
      id: 'question_wifi',
      question: 'Does the build need built-in Wi-Fi, or can an Ethernet cable be used temporarily?',
      reason: 'Affects networking requirements.',
      provenance: 'Graph node: wifi',
    }).title).toBe('Does the build need built-in Wi-Fi, or can an Ethernet cable be used temporarily?');

    expect(localQuestionPresentation({
      id: 'question_bios',
      question: 'Has the retailer confirmed that the motherboard BIOS supports the selected CPU?',
      reason: 'Prevents an out-of-box boot failure.',
      provenance: 'Graph node: bios',
    }).title).toBe('Has the retailer confirmed that the motherboard BIOS supports the selected CPU?');
  });

  it('preserves advice-shaped canonical questions for consistent identity', () => {
    const presentation = localQuestionPresentation({
      id: 'question_requirements',
      question: 'Do I need to change any regular settings before the scheduled event?',
      reason: 'The required instructions have not been confirmed.',
      provenance: 'Sources: event-note.txt',
      presentationContext: ['The responsible team has not confirmed the required settings before the scheduled event.'],
    });

    expect(presentation.title).toBe('Do I need to change any regular settings before the scheduled event?');
  });

  it('uses supported career-demo details in deterministic fallback copy', () => {
    const state = createCareerConflictDemoState();
    const node = state.project.nodes.find((candidate) => candidate.id === CAREER_CONFLICT_QUESTION_ID)!;
    const question = todayQuestionFromNode(state.project, node);
    const presentation = localQuestionPresentation(question);
    const suggestion = localQuestionSuggestion(question);

    expect(presentation.title).toBe(question.question);
    expect(presentation.summary.length).toBeGreaterThan(20);
    expect(suggestion.suggestedAnswer).toContain('not enough confirmed context');
    expect(hasUsefulSuggestedAnswer(suggestion)).toBe(false);
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
