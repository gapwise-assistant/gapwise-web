import { ContextPack, ContextPackInput, DurableMemory } from '@/types/contextPack';
import { ClarityNode } from '@/types/clarity';
import { SafeCalendarEvent } from '@/types/google';
import { rankNodes, rankSources, relevanceScore, tokenize } from '@/lib/retrieval/relevance';
import { memoriesFromProfile } from '@/lib/memory/store';
import { projectForReasoning } from '@/lib/context/sourceState';

const DEFAULT_LIMITS = {
  activeGoals: 3,
  recentImportantEvents: 3,
  unresolvedGaps: 4,
  recentlyResolvedGaps: 3,
  relevantEvidence: 5,
  userPreferences: 5,
  upcomingCommitments: 10,
  recentDecisions: 4,
  contradictions: 3,
};

function newestFirst(a: ClarityNode, b: ClarityNode): number {
  return b.updated_at.localeCompare(a.updated_at);
}

function activeMemories(memories: DurableMemory[]): DurableMemory[] {
  const now = Date.now();
  return memories.filter((memory) => {
    if (memory.forgotten_at) return false;
    if (!memory.expires_at) return true;
    return new Date(memory.expires_at).getTime() > now;
  });
}

function normalizedMemoryText(memory: DurableMemory): string {
  return memory.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function projectReasoningText(project: ContextPackInput['project']): string {
  return [
    project.title,
    project.goal,
    project.one_sentence_context,
    ...project.nodes.map((node) => node.text),
    ...project.sources.flatMap((source) => [source.filename, source.extraction_summary, source.content]),
  ].filter(Boolean).join(' ');
}

function exactTokenOverlap(query: string, text: string): number {
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return 0;
  const textTerms = new Set(tokenize(text));
  return queryTerms.filter((term) => textTerms.has(term)).length / queryTerms.length;
}

function hasSpecificTokenOverlap(value: string, text: string): boolean {
  const textTerms = new Set(tokenize(text));
  return tokenize(value).some((term) => term.length >= 6 && textTerms.has(term));
}

function rankMemories(
  query: string,
  memories: DurableMemory[],
  limit: number,
  project?: ContextPackInput['project']
): DurableMemory[] {
  const projectText = project ? projectReasoningText(project) : '';
  const deduped = Array.from(
    activeMemories(memories).reduce((byText, memory) => {
      const key = normalizedMemoryText(memory);
      const existing = byText.get(key);
      if (!existing || memory.updated_at > existing.updated_at || memory.confidence > existing.confidence) {
        byText.set(key, memory);
      }
      return byText;
    }, new Map<string, DurableMemory>()).values()
  );

  return deduped
    .map((memory) => ({
      memory,
      score: exactTokenOverlap(query, `${memory.category} ${memory.text} ${memory.why_remembered}`),
      projectScore: project ? exactTokenOverlap(memory.text, projectText) : 0,
      hasProjectAnchor: project ? hasSpecificTokenOverlap(memory.text, projectText) : false,
    }))
    .filter((item) => project
      ? item.memory.category === 'communication'
        || item.score >= 0.12
        || (item.projectScore >= 0.3 && item.hasProjectAnchor)
      : item.score > 0
        || item.memory.category === 'communication'
        || item.memory.category === 'current_priorities')
    .sort((a, b) =>
      b.score + b.projectScore * 0.35 + b.memory.confidence * 0.15
      - (a.score + a.projectScore * 0.35 + a.memory.confidence * 0.15)
    )
    .slice(0, limit)
    .map((item) => item.memory);
}

function sourceTimestamp(source: ContextPackInput['project']['sources'][number]): number {
  const time = new Date(source.processed_at ?? source.extracted_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function newestResolutionSources(
  project: ContextPackInput['project'],
  resolvedGaps: ClarityNode[]
): Set<string> {
  const sourceById = new Map(project.sources.map((source) => [source.id, source]));
  return new Set(resolvedGaps.flatMap((gap) => {
    const candidates = gap.source_refs
      .map((sourceId) => sourceById.get(sourceId))
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    const newest = candidates.sort((a, b) => sourceTimestamp(b) - sourceTimestamp(a))[0];
    return newest ? [newest.id] : [];
  }));
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function eventTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function eventEndTimestamp(event: SafeCalendarEvent): number {
  return eventTimestamp(event.end ?? event.start);
}

function calendarEventText(event: SafeCalendarEvent): string {
  return [
    `Google Calendar event: ${event.summary || 'Untitled event'}.`,
    event.start ? `Starts ${event.start}.` : '',
    event.end ? `Ends ${event.end}.` : '',
    event.location ? `Location ${event.location}.` : '',
    event.description ? event.description : '',
  ].filter(Boolean).join(' ');
}

export function calendarEventsToCommitmentNodes(
  events: SafeCalendarEvent[],
  now = new Date(),
  limit = 10
): ClarityNode[] {
  const nowTime = now.getTime();
  return events
    .filter((event) => {
      const end = eventEndTimestamp(event);
      return end === 0 || end > nowTime;
    })
    .sort((a, b) => eventTimestamp(a.start) - eventTimestamp(b.start))
    .slice(0, limit)
    .map((event) => {
      const id = `gcal_commitment_${sanitizeId(event.id || event.summary || event.start || 'event')}`;
      return {
        id,
        type: 'NEXT_ACTION',
        text: calendarEventText(event),
        status: 'OPEN',
        confidence: 0.95,
        impact: 0.72,
        source_refs: event.id ? [`gcal_${event.id}`] : [],
        why_it_matters: [
          'Source: Google Calendar',
          event.id ? `Event ID: ${event.id}` : '',
          event.start ? `Start: ${event.start}` : '',
          event.end ? `End: ${event.end}` : '',
          event.location ? `Location: ${event.location}` : '',
        ].filter(Boolean),
        created_by: 'agent',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
    });
}

export function buildContextPack(input: ContextPackInput): ContextPack {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const profileMemories = memoriesFromProfile(input.profile);
  const memories = input.durableMemories ?? profileMemories;
  const reasoningProject = projectForReasoning(input.project);

  const activeGoals = rankNodes(
    input.query,
    reasoningProject.nodes.filter((node) => node.type === 'GOAL' && node.status !== 'DEPRECATED'),
    limits.activeGoals
  );
  const unresolvedGaps = rankNodes(
    input.query,
    reasoningProject.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN'),
    limits.unresolvedGaps
  );
  const recentlyResolvedGaps = reasoningProject.nodes
    .filter((node) => node.type === 'UNKNOWN' && node.status === 'RESOLVED')
    .map((node) => ({
      node,
      relevance: relevanceScore(input.query, `${node.text} ${node.why_it_matters?.join(' ') ?? ''}`),
    }))
    .filter((item) => item.relevance >= 0.12)
    .sort((a, b) => b.relevance - a.relevance || newestFirst(a.node, b.node))
    .slice(0, limits.recentlyResolvedGaps)
    .map((item) => item.node);
  const upcomingCommitments = rankNodes(
    input.query,
    reasoningProject.nodes.filter((node) => node.type === 'NEXT_ACTION' && node.status === 'OPEN'),
    limits.upcomingCommitments
  )
    .concat(input.calendarCommitments ?? [])
    .slice(0, limits.upcomingCommitments);
  const recentDecisions = reasoningProject.nodes
    .filter((node) => node.type === 'DECISION')
    .sort(newestFirst)
    .slice(0, limits.recentDecisions);
  const contradictions = rankNodes(
    input.query,
    reasoningProject.nodes.filter((node) => node.type === 'RISK' || node.type === 'ASSUMPTION'),
    limits.contradictions
  );
  const sourceCandidates = input.includeBroadContext
    ? reasoningProject.sources.filter((source) => source.origin !== 'connector')
    : reasoningProject.sources;
  const relevantEvidence = rankSources(
    input.query,
    sourceCandidates,
    limits.relevantEvidence,
    {
      includeUnmatched: input.includeBroadContext,
      preferredSourceIds: newestResolutionSources(reasoningProject, recentlyResolvedGaps),
      recencyWeight: 0.16,
      minimumSemanticScore: input.scope?.type === 'project' && !input.includeBroadContext ? 0.2 : undefined,
    }
  );
  const userPreferences = rankMemories(
    input.query,
    memories,
    limits.userPreferences,
    input.scope?.type === 'project' ? reasoningProject : undefined
  );
  const recentImportantEvents = input.project.history
    .slice(-limits.recentImportantEvents)
    .reverse()
    .map((item) => `${item.question} -> ${item.answer}`);

  const selectedNodes = [
    ...activeGoals,
    ...unresolvedGaps,
    ...recentlyResolvedGaps,
    ...upcomingCommitments,
    ...recentDecisions,
    ...contradictions,
  ];
  const supportBySourceId = new Map<string, string[]>();
  selectedNodes.forEach((node) => {
    node.source_refs.forEach((sourceId) => {
      if (sourceId.startsWith('gcal_')) return;
      const current = supportBySourceId.get(sourceId) ?? [];
      supportBySourceId.set(sourceId, [...current, node.text]);
    });
  });
  const relevantSourceIds = new Set(relevantEvidence.map((source) => source.source_id));
  const provenanceSources = reasoningProject.sources
    .filter((source) => supportBySourceId.has(source.id))
    .filter((source) => relevantSourceIds.size === 0 || relevantSourceIds.has(source.id))
    .map((source) => ({
      source_id: source.id,
      filename: source.filename,
      excerpt: (source.extraction_summary || source.content || 'No source summary available.').slice(0, 320),
      score: relevanceScore(input.query, `${source.filename} ${source.extraction_summary ?? ''} ${source.content}`),
      derived_node_ids: source.derived_node_ids,
      supports: Array.from(new Set(supportBySourceId.get(source.id) ?? [])),
    }))
    .sort((a, b) => {
      const relevantOrderA = relevantEvidence.findIndex((item) => item.source_id === a.source_id);
      const relevantOrderB = relevantEvidence.findIndex((item) => item.source_id === b.source_id);
      const normalizedA = relevantOrderA < 0 ? Number.MAX_SAFE_INTEGER : relevantOrderA;
      const normalizedB = relevantOrderB < 0 ? Number.MAX_SAFE_INTEGER : relevantOrderB;
      return normalizedA - normalizedB || b.score - a.score;
    })
    .slice(0, limits.relevantEvidence);

  const includedContextIds = new Set<string>();
  [
    ...activeGoals,
    ...unresolvedGaps,
    ...recentlyResolvedGaps,
    ...upcomingCommitments,
    ...recentDecisions,
    ...contradictions,
  ].forEach((node) => includedContextIds.add(node.id));
  relevantEvidence.forEach((evidence) => includedContextIds.add(evidence.source_id));
  provenanceSources.forEach((evidence) => includedContextIds.add(evidence.source_id));
  userPreferences.forEach((memory) => includedContextIds.add(memory.id));

  return {
    id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    query: input.query,
    built_at: new Date().toISOString(),
    activeGoals,
    recentImportantEvents,
    unresolvedGaps,
    recentlyResolvedGaps,
    relevantEvidence,
    provenanceSources,
    userPreferences,
    upcomingCommitments,
    recentDecisions,
    contradictions,
    includedContextIds: Array.from(includedContextIds),
  };
}
