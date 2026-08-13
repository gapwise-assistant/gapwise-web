import { describe, expect, it } from 'vitest';
import { buildSuggestionRequestMessage, contextualSuggestionsFromPack, parseSuggestedQuestions } from '@/lib/ask/suggestions';
import type { ContextPack } from '@/types/contextPack';

function contextPack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    id: 'ctx_test',
    query: 'questions',
    built_at: '2026-08-13T00:00:00.000Z',
    activeGoals: [],
    recentImportantEvents: [],
    unresolvedGaps: [],
    relevantEvidence: [],
    provenanceSources: [],
    userPreferences: [],
    upcomingCommitments: [],
    recentDecisions: [],
    contradictions: [],
    includedContextIds: [],
    ...overrides,
  };
}

describe('Ask contextual suggestions', () => {
  it('parses the strict JSON contract into three top and three other questions', () => {
    expect(parseSuggestedQuestions(JSON.stringify({
      top_questions: ['What is missing?', 'What is missing?', 'What changed?', 'Extra question?'],
      other_questions: ['What could wait?', 'What should I verify?', 'What should I verify?', 'What other idea?'],
    }))).toEqual({
      top: ['What is missing?', 'What changed?', 'Extra question?'],
      other: ['What could wait?', 'What should I verify?', 'What other idea?'],
    });
  });

  it('keeps compatibility with the previous flat questions contract', () => {
    expect(parseSuggestedQuestions(JSON.stringify({
      questions: ['What is missing?', 'What changed?', 'What should I verify?', 'What could wait?'],
    }))).toEqual({
      top: ['What is missing?', 'What changed?', 'What should I verify?'],
      other: ['What could wait?'],
    });
  });

  it('accepts numbered fallback output from a non-strict model response', () => {
    expect(parseSuggestedQuestions('1. What should I verify?\n2. What could block this?')).toEqual({
      top: ['What should I verify?', 'What could block this?'],
      other: [],
    });
  });

  it('recovers the final JSON after ADK partial streaming fragments', () => {
    const streamed = [
      '{"',
      'questions":["What is missing',
      ' from the plan?",',
      '"What should I verify?"]}',
      '{"questions":["What is missing from the plan?","What should I verify?","What changed?"]}',
    ].join('\n');

    expect(parseSuggestedQuestions(streamed)).toEqual({
      top: ['What is missing from the plan?', 'What should I verify?', 'What changed?'],
      other: [],
    });
  });

  it('recovers questions when the model leaves inner quotation marks unescaped', () => {
    expect(parseSuggestedQuestions(
      '{"top_questions":["What is the definition of "persistent partner criteria"?","What should I verify?"]}'
    )).toEqual({
      top: ['What is the definition of persistent partner criteria?', 'What should I verify?'],
      other: [],
    });
  });

  it('phrases a user birthday question from the user perspective', () => {
    expect(parseSuggestedQuestions(JSON.stringify({
      top_questions: ['When is your birthday?'],
      other_questions: [],
    }))).toEqual({
      top: ['When is my birthday?'],
      other: [],
    });
  });

  it('creates travel-specific questions from the available context', () => {
    const suggestions = contextualSuggestionsFromPack(contextPack({
      activeGoals: [{
        id: 'goal_trip',
        type: 'GOAL',
        text: 'Plan a trip to Japan',
        status: 'OPEN',
        confidence: 0.9,
        impact: 0.8,
        source_refs: [],
        created_by: 'user',
        created_at: '2026-08-13T00:00:00.000Z',
        updated_at: '2026-08-13T00:00:00.000Z',
      }],
    }));

    expect(suggestions.top).toContain('Have I estimated the full cost and key logistics for this trip?');
    expect(suggestions.top).toHaveLength(3);
    expect(suggestions.other).toHaveLength(3);
  });

  it('makes the AI request contract explicit about the selected scope', () => {
    const message = buildSuggestionRequestMessage('Japan trip');
    expect(message).toContain('The current Gapswise scope is: Japan trip.');
    expect(message).toContain('get_context_pack first');
    expect(message).toContain('{"top_questions"');
    expect(message).toContain('"other_questions"');
    expect(message).toContain('exactly 6');
    expect(message).toContain('When is my birthday?');
    expect(message).toContain('Never phrase a user-personal question as "When is your birthday?"');
  });
});
