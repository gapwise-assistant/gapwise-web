import { describe, expect, it } from 'vitest';
import { buildSuggestionRequestMessage, contextualSuggestionsFromPack, parseSuggestedQuestions } from '@/lib/ask/suggestions';
import type { ContextPack } from '@/types/contextPack';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import {
  CAREER_CONFLICT_DEMO_ID,
  createCareerConflictDemoMemories,
  createCareerConflictDemoProject,
} from '@/lib/demo/careerConflict';
import { buildContextPack } from '@/lib/retrieval/contextPack';

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

  it('uses the seeded Career Demo facts for specific, non-duplicated questions', () => {
    const project = createCareerConflictDemoProject();
    const pack = buildContextPack({
      userId: 'demo-user',
      query: 'What important questions should I consider next?',
      project,
      profile: DEFAULT_USER_PROFILE,
      durableMemories: createCareerConflictDemoMemories(),
      includeBroadContext: true,
    });

    const suggestions = contextualSuggestionsFromPack(pack, { projectId: CAREER_CONFLICT_DEMO_ID });

    expect(suggestions.top).toEqual([
      "Given Northstar's Product Engineer role is 70–80% frontend and I want backend or applied AI ownership, what would have to be true for this role to still be worth pursuing?",
      'What should I ask the Northstar recruiter to verify that the backend or applied AI path is real and manager-supported?',
      "For Northstar's $155k–$175k Product Engineer base range, what compensation details are still missing before I compare this opportunity?",
    ]);
    expect(suggestions.other).toEqual([
      'What should I ask Northstar about the steady-state frontend workload after the customer-dashboard launch?',
      "How does Northstar's Product Engineer opportunity compare with my priorities: stable income, technical depth, commute, and career direction?",
      'What are the most important questions to ask during the Northstar Product Engineer recruiter call?',
    ]);
    expect(new Set([...suggestions.top, ...suggestions.other]).size).toBe(6);
  });

  it('makes the AI request contract explicit about the selected scope', () => {
    const message = buildSuggestionRequestMessage('Japan trip');
    expect(message).toContain('The current Gapwise scope is: Japan trip.');
    expect(message).toContain('get_context_pack first');
    expect(message).toContain('{"top_questions"');
    expect(message).toContain('"other_questions"');
    expect(message).toContain('exactly 6');
    expect(message).toContain('When is my birthday?');
    expect(message).toContain('Never phrase a user-personal question as "When is your birthday?"');
    expect(message).toContain('A sparse Context Pack or a pack with no exact phrase match is still a valid result');
  });
});
