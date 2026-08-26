import { AppScope } from '@/types/scope';
import { AskResult, AskSource } from '@/types/ask';
import { ContextPack } from '@/types/contextPack';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { createCareerConflictDemoMemories, createCareerConflictDemoProject } from '@/lib/demo/careerConflict';
import { createKintaGenDemoMemories, createKintaGenDemoProject } from '@/lib/demo/kintagen';
import { createLocalDemoProjects, demoCalendarEvents, demoCareerConflictCalendarEvents, demoKintaGenCalendarEvents } from '@/lib/demo/localFixtures';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { memoriesFromProfile } from '@/lib/memory/store';
import { loadProjectForScope } from '@/lib/storage';
import { contextualSuggestionsFromPack } from '@/lib/ask/suggestions';
import { CAREER_CONFLICT_DEMO_ID } from '@/lib/demo/careerConflict';
import { KINTAGEN_DEMO_ID } from '@/lib/demo/kintagen';

const EVERYTHING_SCOPE: AppScope = { type: 'everything' };
const localContextInstruction = 'Deterministic local demo response based only on the selected project context.';
const localAskExecution = {
  route: 'internal_context' as const,
  agent: 'Local demo Ask',
  toolCalls: [],
  mode: 'simulated' as const,
  fixtureId: 'local-context',
  fixtureVersion: 1,
};

async function loadLocalAskContext(params: {
  userId: string;
  projectId?: string;
  query: string;
  includeBroadContext?: boolean;
  excludeMessageId?: string;
  excludeSourceId?: string;
}): Promise<{ project: { id: string; title: string; goal: string }; pack: ContextPack }> {
  try {
    const loaded = await loadProjectForScope(params.userId, params.projectId);
    const memories = memoriesFromProfile(DEFAULT_USER_PROFILE);
    return {
      project: loaded.project,
      pack: await buildContextPackForUser({
        userId: params.userId,
        query: params.query,
        project: loaded.project,
        profile: DEFAULT_USER_PROFILE,
        durableMemories: memories,
        includeBroadContext: params.includeBroadContext,
        scope: loaded.scope,
        excludeMessageId: params.excludeMessageId,
        excludeSourceId: params.excludeSourceId,
      }),
    };
  } catch (error) {
    const fixtures = [...createLocalDemoProjects(), createCareerConflictDemoProject(), createKintaGenDemoProject()];
    const project = fixtures.find((item) => item.id === params.projectId) ?? fixtures[0];
    const fallbackMemories = project.id === CAREER_CONFLICT_DEMO_ID
      ? createCareerConflictDemoMemories()
      : project.id === KINTAGEN_DEMO_ID
        ? createKintaGenDemoMemories()
        : memoriesFromProfile(DEFAULT_USER_PROFILE);
    const now = new Date();
    const fallbackCalendarEvents = project.id === CAREER_CONFLICT_DEMO_ID
      ? demoCareerConflictCalendarEvents(now)
      : project.id === KINTAGEN_DEMO_ID
        ? demoKintaGenCalendarEvents(now)
        : demoCalendarEvents(now);
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Gapwise demo Ask] Local context unavailable; using deterministic fixtures.', {
        error: error instanceof Error ? error.message : 'Unknown local context error',
      });
    }
    return {
      project,
      pack: buildContextPack({
        userId: params.userId,
        query: params.query,
        project,
        profile: DEFAULT_USER_PROFILE,
        durableMemories: fallbackMemories,
        includeBroadContext: params.includeBroadContext,
        calendarCommitments: calendarEventsToCommitmentNodes(fallbackCalendarEvents, now, 10),
        scope: params.projectId ? { type: 'project', projectId: project.id } : EVERYTHING_SCOPE,
        excludeMessageId: params.excludeMessageId,
        excludeSourceId: params.excludeSourceId,
      }),
    };
  }
}

function sourcesFromPack(pack: ContextPack): AskSource[] {
  const evidence: AskSource[] = [...pack.provenanceSources, ...pack.relevantEvidence].map((source) => ({
    id: source.source_id,
    title: source.filename,
    excerpt: source.excerpt,
    score: source.score,
    kind: 'source',
    supports: source.supports,
    reason: source.supports?.length ? `Supports: ${source.supports.slice(0, 2).join(' · ')}` : 'Matched the local context.',
  }));
  const graph: AskSource[] = [
    ...pack.activeGoals,
    ...pack.unresolvedGaps,
    ...pack.recentDecisions,
    ...pack.contradictions,
  ].filter((node) => !node.source_refs.length).map((node) => ({
    id: node.id,
    title: `${node.type.replaceAll('_', ' ')} in Gapwise`,
    excerpt: node.text,
    kind: 'graph',
    supports: [node.text],
    reason: node.why_it_matters?.[0] ?? 'Stored in the local understanding graph.',
  }));
  const memories: AskSource[] = pack.userPreferences.map((memory) => ({
    id: memory.id,
    title: `Remembered ${memory.category.replaceAll('_', ' ')}`,
    excerpt: memory.text,
    kind: 'memory',
    supports: [memory.text],
    reason: memory.why_remembered,
  }));
  const calendar: AskSource[] = pack.upcomingCommitments
    .filter((node) => node.source_refs.some((sourceId) => sourceId.startsWith('gcal_demo_')))
    .map((node) => ({
      id: node.id,
      title: 'Demo Calendar',
      excerpt: node.text,
      kind: 'calendar',
      supports: [node.text],
      reason: 'Deterministic local Calendar fixture.',
    }));
  return Array.from(new Map([...evidence, ...graph, ...memories, ...calendar].map((source) => [source.id, source])).values()).slice(0, 8);
}

function contextUsedFromPack(pack: ContextPack, projectTitle: string): { projectTitle: string; items: string[] } {
  const compact = (value: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length > 420 ? `${text.slice(0, 419)}…` : text;
  };
  const items = [
    ...pack.activeGoals.map((node) => `Goal: ${compact(node.text)}`),
    ...pack.userPreferences.map((memory) => `Preference: ${compact(memory.text)}`),
    ...pack.unresolvedGaps.map((node) => `Open question: ${compact(node.text)}`),
    ...pack.recentDecisions.map((node) => `Decision: ${compact(node.text)}`),
    ...[...pack.provenanceSources, ...pack.relevantEvidence].slice(0, 8).map((source) => `Source ${source.filename}: ${compact(source.excerpt)}`),
    ...pack.upcomingCommitments.slice(0, 3).map((commitment) => `Upcoming: ${compact(commitment.text)}`),
  ].filter(Boolean).slice(0, 16);
  return { projectTitle, items };
}

function promptUsedFromContext(message: string, contextUsed: { projectTitle: string; items: string[] }): string {
  return [
    localContextInstruction,
    `Project: ${contextUsed.projectTitle}`,
    contextUsed.items.length ? `Context:\n${contextUsed.items.map((item) => `- ${item}`).join('\n')}` : 'Context: No matching project facts were found.',
    `User question:\n${message}`,
  ].join('\n\n');
}

function eventSummary(pack: ContextPack): string {
  if (!pack.upcomingCommitments.length) return 'There are no upcoming demo commitments in this scope.';
  return pack.upcomingCommitments.slice(0, 3).map((event) => {
    const title = event.text.match(/^Google Calendar event: ([^.]+)\./)?.[1] ?? event.text;
    const start = event.text.match(/Starts ([^.]+)\./)?.[1];
    return `- **${title}**${start ? ` — ${new Date(start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`;
  }).join('\n');
}

function deterministicAnswer(message: string, pack: ContextPack, projectTitle: string, projectGoal: string): string {
  const query = message.toLowerCase();
  const gap = pack.unresolvedGaps[0];
  const goal = pack.activeGoals[0];
  const assumption = pack.contradictions.find((node) => node.type === 'ASSUMPTION');
  if (/coming up|calendar|schedule|upcoming/.test(query)) {
    return `## Coming up\n\n${eventSummary(pack)}\n\nThese are local demo Calendar fixtures.`;
  }
  if (/what do you know|about this project|summari[sz]e/.test(query)) {
    return `## ${projectTitle}\n\n**Goal:** ${goal?.text ?? projectGoal}\n\n${gap ? `**Still unclear:** ${gap.text}` : 'There are no open questions in the selected scope.'}\n\nGapwise is answering from the currently selected local scope.`;
  }
  if (/assumption/.test(query)) {
    return assumption
      ? `## Assumption to validate\n\n${assumption.text}\n\nConfirm this before it drives an expensive decision.`
      : 'No open assumption is currently prominent in this scope.';
  }
  if (/focus|attention|neglect|decide next/.test(query)) {
    return gap
      ? `## What to focus on\n\nYour highest-value unresolved question is:\n\n**${gap.text}**\n\n${gap.why_it_matters?.[0] ?? 'Answering it would reduce uncertainty around your active goal.'}`
      : `## What to focus on\n\nKeep moving the active goal forward: **${goal?.text ?? projectGoal}**.`;
  }
  return `## Current understanding\n\nYour active direction is **${goal?.text ?? projectGoal}**.${gap ? `\n\nThe clearest unresolved question is **${gap.text}**.` : ''}`;
}

export async function askGapswiseLocally(params: {
  userId: string;
  message: string;
  sessionId?: string;
  projectId?: string;
  excludeMessageId?: string;
  excludeSourceId?: string;
}): Promise<AskResult> {
  const { project, pack } = await loadLocalAskContext({
    userId: params.userId,
    projectId: params.projectId,
    query: params.message,
    excludeMessageId: params.excludeMessageId,
    excludeSourceId: params.excludeSourceId,
  });
  const contextUsed = contextUsedFromPack(pack, project.title);
  return {
    answer: deterministicAnswer(params.message, pack, project.title, project.goal),
    outcome: 'exploration',
    sessionId: params.sessionId?.trim() || `demo_${params.projectId ?? 'everything'}_${Date.now()}`,
    sources: sourcesFromPack(pack),
    execution: localAskExecution,
    promptUsed: promptUsedFromContext(params.message, contextUsed),
    contextUsed,
  };
}

export async function generateLocalAskSuggestions(params: {
  userId: string;
  projectId?: string;
}): Promise<ReturnType<typeof contextualSuggestionsFromPack>> {
  const { pack } = await loadLocalAskContext({
    userId: params.userId,
    projectId: params.projectId,
    query: 'What important questions, risks, commitments, and missing information should I consider next?',
    includeBroadContext: true,
  });
  return contextualSuggestionsFromPack(pack, { projectId: params.projectId });
}
