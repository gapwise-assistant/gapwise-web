import { ClarityNode, Project } from '@/types/clarity';
import { DailyBrief } from '@/types/attention';
import { ContextPack } from '@/types/contextPack';
import { projectForReasoning } from '@/lib/context/sourceState';
import { relationshipReasons } from '@/lib/graph/relationshipContext';
import {
  calendarTimestampFromText,
  formatCalendarDateTime,
  formatCalendarSchedule,
  formatCalendarTimeUntil,
} from '@/lib/google/calendarFormatting';

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

function parseCalendarTitle(text: string): string {
  return text.match(/^Google Calendar event: ([^.]+)\./)?.[1] ?? 'Calendar event';
}

function parseTime(text: string, label: 'Starts' | 'Ends'): string | undefined {
  return calendarTimestampFromText(text, label);
}

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isCalendarNode(node: ClarityNode): boolean {
  return node.source_refs.some((ref) => ref.startsWith('gcal_')) || node.why_it_matters?.includes('Source: Google Calendar') === true;
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
  return packs.find((pack) => pack.upcomingCommitments.some(isCalendarNode)) ?? packs[0] ?? null;
}

export function todayQuestionFromNode(project: Project, node: ClarityNode): TodayQuestion {
  const reasons = relationshipReasons(project, node.id, 2);
  const question: TodayQuestion = {
    id: `question_${node.id}`,
    question: node.text.endsWith('?') ? node.text : `What should we do about: ${node.text}?`,
    reason: [node.why_it_matters?.[0], ...reasons].filter(Boolean).slice(0, 2).join(' ') || 'This unresolved item can affect the next decision.',
    provenance: node.source_refs.length ? `Sources: ${node.source_refs.join(', ')}` : `Graph node: ${node.id}`,
    sourceNodeIds: [node.id],
  };
  const context = presentationContextForNode(project, node);
  if (context.length) question.presentationContext = context;
  return question;
}

function calendarQuestion(node: ClarityNode, now: Date): TodayQuestion | null {
  const start = parseTime(node.text, 'Starts');
  const startTime = timestamp(start);
  if (!startTime) return null;
  const hoursUntilStart = (startTime - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntilStart < -1 || hoursUntilStart > 48) return null;
  const title = parseCalendarTitle(node.text);
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
}): TodayQuestion[] {
  const now = params.now ?? new Date();
  const hidden = new Set(params.hiddenQuestionIds ?? []);
  const reasoningProject = projectForReasoning(params.project);
  const contextPack = bestContextPack(params.brief);
  const questions: TodayQuestion[] = [];

  contextPack?.unresolvedGaps.forEach((node) => questions.push(todayQuestionFromNode(reasoningProject, node)));
  contextPack?.contradictions.forEach((node) => questions.push(todayQuestionFromNode(reasoningProject, node)));
  contextPack?.upcomingCommitments.filter(isCalendarNode).forEach((node) => {
    const question = calendarQuestion(node, now);
    if (question) questions.push(question);
  });

  if (!questions.length) {
    reasoningProject.nodes
      .filter((node) => node.status === 'OPEN' && ['UNKNOWN', 'ASSUMPTION', 'RISK'].includes(node.type))
      .sort((a, b) => (b.priority ?? b.impact) - (a.priority ?? a.impact))
      .forEach((node) => questions.push(todayQuestionFromNode(reasoningProject, node)));
  }

  const seen = new Set<string>();
  return questions
    .filter((question) => !hidden.has(question.id))
    .filter((question) => {
      if (seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    })
    .slice(0, 4);
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
    .filter(isCalendarNode)
    .filter((node) => !excluded.has(node.id))
    .filter((node) => {
      const end = timestamp(parseTime(node.text, 'Ends')) || timestamp(parseTime(node.text, 'Starts'));
      return end === 0 || end > now.getTime();
    })
    .sort((a, b) => timestamp(parseTime(a.text, 'Starts')) - timestamp(parseTime(b.text, 'Starts')));

  const seen = new Set<string>();
  return commitments
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    })
    .slice(0, limit)
    .map((node) => {
      const start = parseTime(node.text, 'Starts');
      const end = parseTime(node.text, 'Ends');
      const timing = formatCalendarTimeUntil(start, end, now);
      return {
        id: node.id,
        title: parseCalendarTitle(node.text),
        time: formatCalendarSchedule(start, end, now) ?? timing ?? 'Upcoming',
        provenance: 'Google Calendar',
      };
    });
}
