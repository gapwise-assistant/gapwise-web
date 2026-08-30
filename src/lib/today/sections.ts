import { ClarityNode, Project } from '@/types/clarity';
import { DailyBrief } from '@/types/attention';
import { ContextPack } from '@/types/contextPack';
import { projectForReasoning } from '@/lib/context/sourceState';
import { relationshipReasons } from '@/lib/graph/relationshipContext';
import { canonicalQuestionGroups } from '@/lib/questions/canonical';
import { normalizeQuestionGrammar, resolveQuestionReferences } from '@/lib/questions/presentation';
import {
  calendarTimestampFromText,
  formatCalendarDateTime,
  formatCalendarSchedule,
  formatCalendarTimeUntil,
} from '@/lib/google/calendarFormatting';
import {
  calendarEventIdFromNode,
  isNormalizedCalendarCommitment,
} from '@/lib/today/calendarCommitments';

export {
  calendarEventIdFromNode,
  isCalendarBackedNode,
  isNormalizedCalendarCommitment,
} from '@/lib/today/calendarCommitments';

export interface TodayQuestion {
  id: string;
  question: string;
  reason: string;
  provenance: string;
  sourceNodeIds: string[];
  /**
   * Presentation-only copy. The graph question above remains the source of
   * truth for answer routing, persistence, and ranking.
   */
  presentationTitle?: string;
  presentationSummary?: string;
  presentationContext?: string[];
  mode?: 'answer' | 'edit';
  initialAnswer?: string;
  historyTimestamp?: string;
  projectId?: string;
  answerSuggestion?: {
    suggestedAnswer: string;
    whyItMatters: string;
  };
}

function presentationContextForNode(project: Project, node: ClarityNode): string[] {
  const relatedIds = project.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => edge.source === node.id ? edge.target : edge.source);
  const relatedNodes = relatedIds
    .map((id) => project.nodes.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is ClarityNode => Boolean(candidate))
    .filter((candidate) => candidate.id !== node.id)
    .sort((a, b) => (b.priority ?? b.impact) - (a.priority ?? a.impact));
  const sourceFacts = node.source_refs
    .map((sourceId) => project.sources.find((source) => source.id === sourceId))
    .filter(Boolean)
    .flatMap((source) => [source?.extraction_summary, source?.content.split(/[.!?]\s/)[0]])
    .filter((fact): fact is string => Boolean(fact));

  return [...sourceFacts, ...relatedNodes.map((candidate) => candidate.text)]
    .map((fact) => fact.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((fact, index, facts) => facts.indexOf(fact) === index)
    .slice(0, 6);
}

export interface TodayCommitment {
  id: string;
  title: string;
  time: string;
  provenance: string;
}

function parseCalendarTitle(text: string): string | undefined {
  return text.match(/^Google Calendar event: ([^.]+)\./)?.[1]?.trim() || undefined;
}

function parseTime(text: string, label: 'Starts' | 'Ends'): string | undefined {
  return calendarTimestampFromText(text, label);
}

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function contextPacksFromBrief(brief: DailyBrief): ContextPack[] {
  const seen = new Set<string>();
  return brief.recommendations
    .map((recommendation) => recommendation.context_pack)
    .filter((pack) => {
      if (seen.has(pack.id)) return false;
      seen.add(pack.id);
      return true;
    });
}

function bestContextPack(brief: DailyBrief): ContextPack | null {
  const packs = contextPacksFromBrief(brief);
  return packs.find((pack) => pack.upcomingCommitments.some(isNormalizedCalendarCommitment)) ?? packs[0] ?? null;
}

export function todayQuestionFromNode(project: Project, node: ClarityNode): TodayQuestion {
  const reasons = relationshipReasons(project, node.id, 2);
  const sourceText = node.source_refs
    .map((sourceId) => project.sources.find((source) => source.id === sourceId)?.content)
    .filter((content): content is string => Boolean(content))
    .join('\n');
  const question: TodayQuestion = {
    id: `question_${node.id}`,
    question: normalizeQuestionGrammar(resolveQuestionReferences(node.text, sourceText)),
    reason: [node.why_it_matters?.[0], ...reasons].filter(Boolean).slice(0, 2).join(' ') || 'This unresolved item can affect the next decision.',
    provenance: node.source_refs.length ? `Sources: ${node.source_refs.join(', ')}` : `Graph node: ${node.id}`,
    sourceNodeIds: [node.id],
  };
  const context = presentationContextForNode(project, node);
  if (context.length) question.presentationContext = context;
  return question;
}

export function countTodayOpenQuestions(project: Project, hiddenQuestionNodeIds: Iterable<string> = []): number {
  const hidden = new Set(hiddenQuestionNodeIds);
  return canonicalQuestionGroups(project)
    .filter((group) => ['UNKNOWN', 'ASSUMPTION'].includes(group.canonical.type) && group.canonical.status === 'OPEN')
    .filter((group) => !group.nodeIds.some((nodeId) => hidden.has(nodeId)))
    .length;
}

/** Pending user-owned choices shown in Today's dedicated Decisions section. */
export function openTodayDecisions(project: Project): ClarityNode[] {
  return projectForReasoning(project).nodes
    .filter((node) => node.type === 'DECISION' && node.status === 'OPEN')
    .sort((left, right) =>
      (right.priority ?? right.impact) - (left.priority ?? left.impact)
      || right.confidence - left.confidence
      || left.created_at.localeCompare(right.created_at)
    );
}

function calendarQuestion(node: ClarityNode, now: Date): TodayQuestion | null {
  const start = parseTime(node.text, 'Starts');
  const startTime = timestamp(start);
  if (!startTime) return null;
  const hoursUntilStart = (startTime - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntilStart < -1 || hoursUntilStart > 48) return null;
  const title = parseCalendarTitle(node.text);
  if (!title) return null;
  const readableStart = formatCalendarDateTime(start);
  return {
    id: `question_prepare_${node.id}`,
    question: `Are you prepared for ${title}?`,
    reason: 'Your Calendar shows it is approaching.',
    provenance: `Source: Google Calendar${readableStart ? `, ${readableStart}` : ''}`,
    sourceNodeIds: [node.id],
    presentationContext: [node.text],
  };
}

export function buildTodayQuestions(params: {
  project: Project;
  brief: DailyBrief;
  now?: Date;
  hiddenQuestionIds?: string[];
  excludedQuestionNodeIds?: string[];
}): TodayQuestion[] {
  const now = params.now ?? new Date();
  const hidden = new Set(params.hiddenQuestionIds ?? []);
  const excludedNodeIds = new Set(params.excludedQuestionNodeIds ?? []);
  const reasoningProject = projectForReasoning(params.project);
  const contextPack = bestContextPack(params.brief);
  const questions: TodayQuestion[] = [];
  const addQuestion = (question: TodayQuestion) => {
    if (questions.some((existing) => existing.id === question.id)) return;
    if (question.sourceNodeIds.some((nodeId) => excludedNodeIds.has(nodeId))) return;
    if (hidden.has(question.id)) return;
    questions.push(question);
  };

  contextPack?.unresolvedGaps.forEach((node) => addQuestion(todayQuestionFromNode(reasoningProject, node)));
  // A contradiction/risk is evidence for an unresolved gap, not itself a
  // question the user should answer from the Today list.
  contextPack?.contradictions
    .filter((node) => ['UNKNOWN', 'ASSUMPTION'].includes(node.type))
    .forEach((node) => addQuestion(todayQuestionFromNode(reasoningProject, node)));
  contextPack?.upcomingCommitments.filter(isNormalizedCalendarCommitment).forEach((node) => {
    const question = calendarQuestion(node, now);
    if (question) addQuestion(question);
  });

  // Context Packs intentionally stay small. Once Recommended Focus is
  // removed, backfill from the canonical ranked graph so Today can still
  // show its full question allowance without duplicating the focus item.
  if (excludedNodeIds.size > 0) {
    reasoningProject.nodes
      // Risks and negative facts remain evidence for an unresolved question;
      // they should not become answerable Today questions on their own.
      .filter((node) => node.status === 'OPEN' && ['UNKNOWN', 'ASSUMPTION'].includes(node.type))
      .sort((a, b) => (b.priority ?? b.impact) - (a.priority ?? a.impact))
      .forEach((node) => addQuestion(todayQuestionFromNode(reasoningProject, node)));
  }

  return questions.slice(0, 4);
}

export function buildComingUp(
  brief: DailyBrief,
  now = new Date(),
  limit = 4,
  excludedCommitmentIds: Iterable<string> = []
): TodayCommitment[] {
  const excluded = new Set(excludedCommitmentIds);
  const commitments = contextPacksFromBrief(brief)
    .flatMap((pack) => pack.upcomingCommitments)
    .filter(isNormalizedCalendarCommitment)
    .filter((node) => !excluded.has(node.id))
    .filter((node) => {
      const end = timestamp(parseTime(node.text, 'Ends')) || timestamp(parseTime(node.text, 'Starts'));
      return end === 0 || end > now.getTime();
    })
    .sort((a, b) => timestamp(parseTime(a.text, 'Starts')) - timestamp(parseTime(b.text, 'Starts')));

  const seenEventIds = new Set<string>();
  return commitments
    .filter((node) => {
      const eventId = calendarEventIdFromNode(node);
      if (!eventId || !parseCalendarTitle(node.text) || !parseTime(node.text, 'Starts')) return false;
      if (seenEventIds.has(eventId)) return false;
      seenEventIds.add(eventId);
      return true;
    })
    .slice(0, limit)
    .map((node) => {
      const start = parseTime(node.text, 'Starts');
      const end = parseTime(node.text, 'Ends');
      const timing = formatCalendarTimeUntil(start, end, now);
      return {
        id: node.id,
        title: parseCalendarTitle(node.text)!,
        time: formatCalendarSchedule(start, end, now) ?? timing ?? 'Upcoming',
        provenance: 'Google Calendar',
      };
    });
}
