import { ContextPack } from '@/types/contextPack';
import { CAREER_CONFLICT_DEMO_ID } from '@/lib/demo/careerConflict';

const MAX_SUGGESTIONS = 3;
const MAX_TOTAL_SUGGESTIONS = MAX_SUGGESTIONS * 2;

export interface SuggestedQuestionGroups {
  top: string[];
  other: string[];
}

const CAREER_DEMO_SUGGESTIONS: SuggestedQuestionGroups = {
  top: [
    "Given Northstar's Product Engineer role is 70–80% frontend and I want backend or applied AI ownership, what would have to be true for this role to still be worth pursuing?",
    'What should I ask the Northstar recruiter to verify that the backend or applied AI path is real and manager-supported?',
    "For Northstar's $155k–$175k Product Engineer base range, what compensation details are still missing before I compare this opportunity?",
  ],
  other: [
    'What should I ask Northstar about the steady-state frontend workload after the customer-dashboard launch?',
    "How does Northstar's Product Engineer opportunity compare with my priorities: stable income, technical depth, commute, and career direction?",
    'What are the most important questions to ask during the Northstar Product Engineer recruiter call?',
  ],
};

function careerDemoSuggestions(): SuggestedQuestionGroups {
  return {
    top: [...CAREER_DEMO_SUGGESTIONS.top],
    other: [...CAREER_DEMO_SUGGESTIONS.other],
  };
}

export function buildSuggestionRequestMessage(scopeLabel: string): string {
  return [
    'This is an internal request for the Ask screen, not a normal conversation reply.',
    `The current Gapwise scope is: ${scopeLabel}.`,
    'Call get_context_pack first using the current user and the exact query __gapswise_ask_suggestions__. This special query includes the current scope sources and learned statements even when they do not match generic words.',
    'Generate exactly 6 concise suggested questions the user would genuinely benefit from asking next.',
    'Put the 3 highest-value questions in top_questions and 3 useful but less urgent or exploratory ideas in other_questions.',
    'Rank the top questions using urgency, impact, goal alignment, actionability, and confidence. Prioritize distinctive details and uncertainties from recent supplied source content before generic project questions. Make every question specific to the returned context. For a travel plan, ask about concrete missing costs or logistics; for a project, ask about its actual blockers or decisions. Do not invent facts or duplicate questions across the two groups.',
    'A sparse Context Pack or a pack with no exact phrase match is still a valid result, not an error. If any goals, gaps, evidence, decisions, preferences, or commitments are returned, use those details. If every collection is empty, return cautious questions about the most important missing information for this scope. Never refuse, say the Context Pack is empty, claim lack of access, or return an explanation instead of the requested JSON.',
    'Phrase questions from the user\'s perspective. For personal facts in the user context, use first-person wording such as "When is my birthday?" or "What is my preference?" Never phrase a user-personal question as "When is your birthday?" because that asks about the AI instead of the user.',
    'Return only valid JSON in this exact shape: {"top_questions":["question 1","question 2","question 3"],"other_questions":["question 4","question 5","question 6"]}. Do not put quotation marks inside the question text. No markdown, explanation, numbering, or extra keys.',
  ].join(' ');
}

function cleanQuestion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const question = value
    .replace(/^[-*\d.)\s]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([?.!,])/g, '$1')
    .replace(/\bwhen is your birthday\b/gi, 'When is my birthday')
    .replace(/\bwhat is your birthday\b/gi, 'What is my birthday')
    .trim();
  if (question.length < 12 || question.length > 180) return null;
  return question.endsWith('?') ? question : `${question}?`;
}

function uniqueQuestions(values: unknown[], limit = MAX_SUGGESTIONS): string[] {
  return Array.from(
    new Set(values.map(cleanQuestion).filter((question): question is string => Boolean(question)))
  ).slice(0, limit);
}

function objectArray(object: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key];
  }
  return [];
}

function splitLegacyQuestions(values: unknown[]): SuggestedQuestionGroups {
  const questions = uniqueQuestions(values, MAX_TOTAL_SUGGESTIONS);
  return {
    top: questions.slice(0, MAX_SUGGESTIONS),
    other: questions.slice(MAX_SUGGESTIONS, MAX_TOTAL_SUGGESTIONS),
  };
}

function normalizeGroups(topValues: unknown[], otherValues: unknown[]): SuggestedQuestionGroups {
  const top = uniqueQuestions(topValues);
  const topSet = new Set(top.map((question) => question.toLowerCase()));
  const other = uniqueQuestions(otherValues)
    .filter((question) => !topSet.has(question.toLowerCase()))
    .slice(0, MAX_SUGGESTIONS);
  return { top, other };
}

function groupsFromParsed(value: unknown): SuggestedQuestionGroups {
  if (Array.isArray(value)) return splitLegacyQuestions(value);
  if (!value || typeof value !== 'object') return { top: [], other: [] };

  const object = value as Record<string, unknown>;
  const top = objectArray(object, ['top_questions', 'topQuestions', 'priority_questions', 'priorityQuestions']);
  const other = objectArray(object, ['other_questions', 'otherQuestions', 'secondary_questions', 'secondaryQuestions', 'other_ideas', 'otherIdeas']);
  if (top.length || other.length) return normalizeGroups(top, other);

  return splitLegacyQuestions(objectArray(object, ['questions']));
}

function parseLooseQuestions(value: string, keys: string[]): string[] {
  const escapedKeys = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const keyMatch = new RegExp(`["']?(?:${escapedKeys.join('|')})["']?\\s*:\\s*\\[`, 'i').exec(value);
  if (!keyMatch || keyMatch.index === undefined) return [];
  const arrayStart = value.indexOf('[', keyMatch.index);
  const arrayEnd = value.lastIndexOf(']');
  if (arrayEnd <= arrayStart) return [];

  const values: string[] = [];
  let cursor = arrayStart + 1;
  while (cursor < arrayEnd) {
    const openingQuote = value.indexOf('"', cursor);
    if (openingQuote < 0 || openingQuote >= arrayEnd) break;
    let closingQuote = openingQuote + 1;
    while (closingQuote < arrayEnd) {
      if (value[closingQuote] === '"' && value[closingQuote - 1] !== '\\') {
        const afterQuote = value.slice(closingQuote + 1).match(/^\s*([,\]])/);
        if (afterQuote) break;
      }
      closingQuote += 1;
    }
    if (closingQuote >= arrayEnd) break;
    values.push(value.slice(openingQuote + 1, closingQuote).replace(/\\"/g, '"').replace(/"/g, ''));
    cursor = closingQuote + 1;
  }
  return uniqueQuestions(values);
}

export function parseSuggestedQuestions(answer: string): SuggestedQuestionGroups {
  const normalized = answer.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const jsonCandidates = [normalized];
  // ADK streaming can emit partial JSON fragments followed by the complete
  // response. Prefer the last object/array so those fragments do not corrupt it.
  const objectStart = normalized.lastIndexOf('{');
  const objectEnd = normalized.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    jsonCandidates.push(normalized.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = normalized.lastIndexOf('[');
  const arrayEnd = normalized.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    jsonCandidates.push(normalized.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of jsonCandidates) {
    try {
      const groups = groupsFromParsed(JSON.parse(candidate) as unknown);
      if (groups.top.length || groups.other.length) return groups;
    } catch {
      // Fall through to loose parsing for a useful response from a non-strict model.
    }
  }

  const looseTop = parseLooseQuestions(normalized, ['top_questions', 'topQuestions', 'priority_questions', 'priorityQuestions']);
  const looseOther = parseLooseQuestions(normalized, ['other_questions', 'otherQuestions', 'secondary_questions', 'secondaryQuestions', 'other_ideas', 'otherIdeas']);
  if (looseTop.length || looseOther.length) return normalizeGroups(looseTop, looseOther);

  const looseLegacy = parseLooseQuestions(normalized, ['questions']);
  if (looseLegacy.length) return splitLegacyQuestions(looseLegacy);

  return splitLegacyQuestions(
    normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line))
  );
}

function contextText(pack: ContextPack): string {
  return [
    ...pack.activeGoals.map((node) => node.text),
    ...pack.unresolvedGaps.map((node) => node.text),
    ...pack.contradictions.map((node) => node.text),
    ...pack.relevantEvidence.map((source) => `${source.filename} ${source.excerpt}`),
    ...pack.userPreferences.map((memory) => memory.text),
    ...pack.upcomingCommitments.map((node) => node.text),
  ].join(' ');
}

function firstTopic(pack: ContextPack): string | null {
  const source = pack.relevantEvidence[0];
  if (source?.filename) return source.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const goal = pack.activeGoals[0]?.text;
  return goal ? goal.replace(/[.!?]+$/, '') : null;
}

function buildLocalGroups(topCandidates: string[], otherCandidates: string[]): SuggestedQuestionGroups {
  const top = uniqueQuestions(topCandidates);
  const topSet = new Set(top.map((question) => question.toLowerCase()));
  const other = uniqueQuestions(otherCandidates, MAX_TOTAL_SUGGESTIONS)
    .filter((question) => !topSet.has(question.toLowerCase()))
    .slice(0, MAX_SUGGESTIONS);
  return { top, other };
}

export function contextualSuggestionsFromPack(
  pack: ContextPack,
  options: { projectId?: string } = {},
): SuggestedQuestionGroups {
  const allText = contextText(pack);
  const lowerText = allText.toLowerCase();
  const isCareerDemo = options.projectId === CAREER_CONFLICT_DEMO_ID
    || (/70[–-]80% frontend/.test(lowerText)
      && /backend or applied ai/.test(lowerText)
      && /\$155(?:,000|k)[–-]\$175(?:,000|k)/.test(lowerText));
  if (isCareerDemo) return careerDemoSuggestions();

  const topCandidates: string[] = [];
  const otherCandidates: string[] = [];
  const gap = pack.unresolvedGaps[0];
  const goal = pack.activeGoals[0];
  const commitment = pack.upcomingCommitments[0];
  const topic = firstTopic(pack);

  if (gap) {
    topCandidates.push(gap.text.endsWith('?') ? gap.text : `What do I need to clarify about ${gap.text}?`);
  }
  if (/\b(japan|trip|travel|flight|hotel|itinerary)\b/.test(lowerText)) {
    topCandidates.push('Have I estimated the full cost and key logistics for this trip?');
  } else if (commitment) {
    const title = commitment.text.match(/Google Calendar event: ([^.]+)/)?.[1] ?? 'my next commitment';
    topCandidates.push(`What do I need to prepare for ${title.trim()}?`);
  } else if (goal) {
    topCandidates.push(`What is the biggest missing piece or risk for ${goal.text.replace(/[.!?]+$/, '')}?`);
  }

  if (/\b(need to know|don't know|do not know|unclear|not sure|unknown|might be better)\b/.test(lowerText)) {
    topCandidates.push('What important detail in my supplied context should I clarify first?');
  }
  for (const fallback of [
    'What should I clarify first based on what Gapwise knows?',
    'What would most reduce uncertainty around my current direction?',
  ]) {
    if (topCandidates.length >= MAX_SUGGESTIONS) break;
    topCandidates.push(fallback);
  }

  if (topic) {
    otherCandidates.push(`What important information is still missing from ${topic}?`);
    otherCandidates.push(`What should I verify next about ${topic}?`);
  } else if (pack.userPreferences[0]) {
    otherCandidates.push(`What should I prioritize next given that ${pack.userPreferences[0].text.replace(/[.!?]+$/, '')}?`);
  }
  if (commitment && !/\b(japan|trip|travel|flight|hotel|itinerary)\b/.test(lowerText)) {
    const title = commitment.text.match(/Google Calendar event: ([^.]+)/)?.[1] ?? 'my next commitment';
    otherCandidates.push(`What can I do now to make ${title.trim()} easier?`);
  }
  otherCandidates.push('What changed recently that may affect my next step?');
  otherCandidates.push('What useful idea can wait until after the current priority?');

  return buildLocalGroups(topCandidates, otherCandidates);
}
