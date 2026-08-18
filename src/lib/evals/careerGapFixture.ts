import { createCareerConflictDemoState } from '@/lib/demo/careerConflict';
import { demoCareerConflictCalendarEvents } from '@/lib/demo/localFixtures';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPack, calendarEventsToCommitmentNodes } from '@/lib/retrieval/contextPack';
import type { ClarityNode, ContextSource, Project } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import type { SafeCalendarEvent } from '@/types/google';
import {
  CAREER_GAP_FIXTURE_VERSION,
  CAREER_GAP_NODE_BY_CONCEPT,
  type CareerGapGoldenCase,
  type CareerGapMutation,
  type CareerGapStrategyInput,
} from '@/lib/evals/careerGapTypes';

export const CAREER_GAP_FIXED_NOW = '2026-08-17T18:00:00.000Z';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function source(id: string, filename: string, content: string, nodeIds: string[]): ContextSource {
  return {
    id,
    filename,
    type: 'note',
    content,
    extracted_at: CAREER_GAP_FIXED_NOW,
    derived_node_ids: nodeIds,
    processing_status: 'completed',
    origin: 'user',
    extraction_summary: content,
  };
}

function addResolution(
  project: Project,
  nodeId: string,
  sourceId: string,
  text: string,
): void {
  const gap = project.nodes.find((node) => node.id === nodeId);
  if (!gap) throw new Error(`CareerGap fixture cannot resolve missing node ${nodeId}`);
  gap.status = 'RESOLVED';
  gap.confidence = 1;
  gap.updated_at = CAREER_GAP_FIXED_NOW;
  if (!gap.source_refs.includes(sourceId)) gap.source_refs.push(sourceId);
  if (!project.sources.some((item) => item.id === sourceId)) {
    project.sources.push(source(sourceId, `${sourceId}.txt`, text, [nodeId]));
  }
  const knownId = `known_eval_${nodeId}_${sourceId}`;
  project.nodes.push({
    id: knownId,
    type: 'KNOWN',
    text,
    status: 'RESOLVED',
    confidence: 1,
    impact: gap.impact,
    source_refs: [sourceId],
    created_by: 'user',
    created_at: CAREER_GAP_FIXED_NOW,
    updated_at: CAREER_GAP_FIXED_NOW,
  });
  project.edges.push({
    id: `edge_eval_${knownId}_resolves_${nodeId}`,
    source: knownId,
    target: nodeId,
    type: 'resolves',
  });
}

function addMemory(memories: DurableMemory[], id: string, text: string): void {
  memories.push({
    id,
    category: 'career',
    text,
    source: 'user_confirmed',
    source_refs: [],
    confidence: 1,
    created_at: CAREER_GAP_FIXED_NOW,
    updated_at: CAREER_GAP_FIXED_NOW,
    last_confirmed_at: CAREER_GAP_FIXED_NOW,
    why_remembered: 'Added by a hand-authored CareerGap Golden Set mutation.',
  });
}

function resolveLowerValueUnknowns(project: Project, except: string[] = []): void {
  Object.values(CAREER_GAP_NODE_BY_CONCEPT)
    .filter((nodeId) => !except.includes(nodeId))
    .forEach((nodeId) => {
      const node = project.nodes.find((candidate) => candidate.id === nodeId);
      if (node?.status === 'OPEN') {
        addResolution(project, nodeId, `src_eval_resolved_${nodeId}`, `The ${nodeId} question was answered for this evaluation case.`);
      }
    });
}

function setRecruiterOffset(events: SafeCalendarEvent[], minutes: number): void {
  const event = events.find((candidate) => candidate.id === 'demo_career_recruiter_call');
  if (!event) throw new Error('CareerGap fixture is missing the Northstar recruiter call.');
  const start = new Date(new Date(CAREER_GAP_FIXED_NOW).getTime() + minutes * 60_000);
  event.start = start.toISOString();
  event.end = new Date(start.getTime() + 45 * 60_000).toISOString();
  const prep = events.find((candidate) => candidate.id === 'demo_career_coach_prep');
  if (prep) {
    const prepStart = new Date(start.getTime() - 60 * 60_000);
    prep.start = prepStart.toISOString();
    prep.end = new Date(prepStart.getTime() + 30 * 60_000).toISOString();
  }
}

function applyMutation(
  mutation: CareerGapMutation,
  project: Project,
  memories: DurableMemory[],
  events: SafeCalendarEvent[],
): void {
  switch (mutation.type) {
    case 'record_conditional_frontend_acceptance':
      addResolution(
        project,
        CAREER_GAP_NODE_BY_CONCEPT.role_acceptability,
        'src_eval_conditional_acceptance',
        'The Northstar role is acceptable only if the frontend-heavy period has a credible, manager-supported end state.',
      );
      addMemory(memories, 'career_gap_conditional_acceptance', 'I would accept temporary frontend-heavy work only with a credible transition into backend or applied AI ownership.');
      return;
    case 'confirm_backend_ai_transition':
      addResolution(
        project,
        CAREER_GAP_NODE_BY_CONCEPT.transition_credibility,
        'src_eval_confirmed_transition',
        'The hiring manager confirmed a funded backend platform opening after six months with explicit manager sponsorship.',
      );
      return;
    case 'resolve_total_compensation':
      addResolution(
        project,
        CAREER_GAP_NODE_BY_CONCEPT.total_compensation,
        'src_eval_full_compensation',
        'The complete Northstar equity grant, vesting terms, refresh policy, bonus, and first-year compensation are confirmed.',
      );
      return;
    case 'resolve_steady_state_work_mix':
      addResolution(
        project,
        CAREER_GAP_NODE_BY_CONCEPT.steady_state_work_mix,
        'src_eval_work_mix_answer',
        `After launch, the normal-week frontend workload is ${mutation.frontendPercent ?? 40}%.`,
      );
      return;
    case 'reject_permanent_frontend_and_complete_decision':
      addResolution(
        project,
        CAREER_GAP_NODE_BY_CONCEPT.role_acceptability,
        'src_eval_role_rejected',
        'The user confirmed that a permanently frontend-dominant Northstar role is not acceptable.',
      );
      resolveLowerValueUnknowns(project);
      project.nodes.find((node) => node.id === 'career_decision_continue')!.status = 'RESOLVED';
      addMemory(memories, 'career_gap_reject_permanent_frontend', 'I will not pursue the Northstar role if frontend delivery remains the permanent majority of the work.');
      return;
    case 'add_conflicting_work_mix_evidence': {
      const gapId = CAREER_GAP_NODE_BY_CONCEPT.steady_state_work_mix;
      const gap = project.nodes.find((node) => node.id === gapId)!;
      gap.impact = 1;
      gap.confidence = 0.05;
      const evidence = [
        ['src_eval_work_mix_40', 'Recruiter notes say the steady-state role is 40% frontend. Explicit conflict marker.'],
        ['src_eval_work_mix_80', 'Hiring-manager notes say the steady-state role remains 80% frontend. Explicit conflict marker.'],
      ] as const;
      evidence.forEach(([sourceId, text], index) => {
        project.sources.push(source(sourceId, `${sourceId}.txt`, text, [gapId]));
        const nodeId = `known_eval_work_mix_${index}`;
        project.nodes.push({
          id: nodeId,
          type: 'EVIDENCE',
          text,
          status: 'RESOLVED',
          confidence: 0.9,
          impact: 0.9,
          source_refs: [sourceId],
          created_by: 'agent',
          created_at: CAREER_GAP_FIXED_NOW,
          updated_at: CAREER_GAP_FIXED_NOW,
        });
        project.edges.push({ id: `edge_eval_work_mix_conflict_${index}`, source: nodeId, target: gapId, type: 'contradicts' });
      });
      return;
    }
    case 'add_conflicting_transition_evidence': {
      const gapId = CAREER_GAP_NODE_BY_CONCEPT.transition_credibility;
      const evidence = [
        ['src_eval_transition_funded', 'Recruiter notes say a funded backend transfer is approved after six months. Explicit conflict marker.'],
        ['src_eval_transition_unfunded', 'Hiring-manager notes say there is no funded transfer path or manager commitment. Explicit conflict marker.'],
      ] as const;
      evidence.forEach(([sourceId, text], index) => {
        project.sources.push(source(sourceId, `${sourceId}.txt`, text, [gapId]));
        const nodeId = `known_eval_transition_${index}`;
        project.nodes.push({
          id: nodeId,
          type: 'EVIDENCE',
          text,
          status: 'RESOLVED',
          confidence: 0.9,
          impact: 0.94,
          source_refs: [sourceId],
          created_by: 'agent',
          created_at: CAREER_GAP_FIXED_NOW,
          updated_at: CAREER_GAP_FIXED_NOW,
        });
        project.edges.push({ id: `edge_eval_transition_conflict_${index}`, source: nodeId, target: gapId, type: 'contradicts' });
      });
      return;
    }
    case 'remove_backend_ai_preference':
      memories.forEach((item) => {
        if (/backend|applied AI/i.test(item.text)) item.forgotten_at = CAREER_GAP_FIXED_NOW;
      });
      project.nodes
        .filter((node) => node.id === 'career_growth_goal' || node.id === 'career_risk_ai_path')
        .forEach((node) => { node.status = 'DEPRECATED'; });
      project.nodes.find((node) => node.id === CAREER_GAP_NODE_BY_CONCEPT.transition_credibility)!.impact = 0.3;
      return;
    case 'make_financial_stability_dominant':
      addMemory(memories, 'career_gap_financial_dominant', 'My immediate overriding priority is stable income; compensation fit dominates career-direction tradeoffs for this decision.');
      project.nodes.find((node) => node.id === CAREER_GAP_NODE_BY_CONCEPT.total_compensation)!.impact = 1;
      project.nodes.find((node) => node.id === CAREER_GAP_NODE_BY_CONCEPT.total_compensation)!.source_refs.push('src_career_finance_snapshot');
      project.nodes.find((node) => node.id === CAREER_GAP_NODE_BY_CONCEPT.transition_credibility)!.impact = 0.45;
      return;
    case 'remove_financial_concern':
      memories.forEach((item) => {
        if (/financial stability|stable income/i.test(item.text)) item.forgotten_at = CAREER_GAP_FIXED_NOW;
      });
      project.nodes
        .filter((node) => ['career_financial_goal', 'career_risk_financial_pressure'].includes(node.id))
        .forEach((node) => { node.status = 'DEPRECATED'; });
      project.nodes.find((node) => node.id === CAREER_GAP_NODE_BY_CONCEPT.total_compensation)!.impact = 0.35;
      return;
    case 'set_recruiter_call_offset':
      setRecruiterOffset(events, mutation.minutes);
      return;
    case 'replace_calendar_with_unrelated_event': {
      events.splice(0, events.length, {
        id: 'eval_unrelated_dentist',
        summary: 'Dentist appointment',
        description: 'Routine cleaning and dental checkup.',
        start: new Date(new Date(CAREER_GAP_FIXED_NOW).getTime() + mutation.minutes * 60_000).toISOString(),
        end: new Date(new Date(CAREER_GAP_FIXED_NOW).getTime() + (mutation.minutes + 45) * 60_000).toISOString(),
      });
      return;
    }
    case 'add_semantic_transition_answer':
      addResolution(
        project,
        CAREER_GAP_NODE_BY_CONCEPT.transition_credibility,
        'src_eval_semantic_transition_answer',
        'A budgeted platform team seat is guaranteed in month seven, and the receiving manager has approved the transfer plan.',
      );
      return;
    case 'supersede_frontend_preference': {
      memories.forEach((item) => {
        if (/avoid frontend-heavy/i.test(item.text)) item.forgotten_at = CAREER_GAP_FIXED_NOW;
      });
      const oldPreference = project.nodes.find((node) => node.id === 'career_preference_frontend');
      if (oldPreference) oldPreference.status = 'DEPRECATED';
      addResolution(
        project,
        CAREER_GAP_NODE_BY_CONCEPT.role_acceptability,
        'src_eval_frontend_preference_superseded',
        'The user now explicitly accepts frontend-heavy work for up to one year when the role restores stable income.',
      );
      addMemory(memories, 'career_gap_frontend_preference_superseded', 'I now accept a frontend-heavy first year when it restores stable income; this supersedes my earlier blanket preference.');
      return;
    }
    case 'make_transition_and_compensation_close': {
      const transition = project.nodes.find((node) => node.id === CAREER_GAP_NODE_BY_CONCEPT.transition_credibility)!;
      const compensation = project.nodes.find((node) => node.id === CAREER_GAP_NODE_BY_CONCEPT.total_compensation)!;
      transition.impact = 0.9;
      transition.confidence = 0.12;
      compensation.impact = 0.9;
      compensation.confidence = 0.12;
      return;
    }
    case 'resolve_lower_value_unknowns':
      resolveLowerValueUnknowns(project, [
        CAREER_GAP_NODE_BY_CONCEPT.transition_credibility,
        CAREER_GAP_NODE_BY_CONCEPT.total_compensation,
      ]);
      return;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function materializeCareerGapCase(goldenCase: CareerGapGoldenCase): CareerGapStrategyInput {
  const state = createCareerConflictDemoState();
  const project = clone(state.project);
  const memories = clone(state.memories);
  const calendarEvents = clone(demoCareerConflictCalendarEvents(new Date(CAREER_GAP_FIXED_NOW)));
  goldenCase.mutations.forEach((mutation) => applyMutation(mutation, project, memories, calendarEvents));
  const contextPack = buildContextPack({
    userId: 'career-gap-eval',
    query: `What is the smallest unresolved fact that could change the Northstar interview decision? ${project.goal}`,
    project,
    profile: DEFAULT_USER_PROFILE,
    durableMemories: memories,
    calendarCommitments: calendarEventsToCommitmentNodes(calendarEvents, new Date(CAREER_GAP_FIXED_NOW)),
    includeBroadContext: true,
  });
  contextPack.id = `ctx_${CAREER_GAP_FIXTURE_VERSION}_${goldenCase.id}`;
  contextPack.built_at = CAREER_GAP_FIXED_NOW;

  const snapshot = {
    fixtureVersion: CAREER_GAP_FIXTURE_VERSION,
    caseId: goldenCase.id,
    fixedNow: CAREER_GAP_FIXED_NOW,
    project,
    memories,
    calendarEvents,
    contextPack,
  };
  return {
    ...snapshot,
    fixtureHash: `fnv1a:${fnv1a(stableStringify(snapshot))}`,
  };
}
