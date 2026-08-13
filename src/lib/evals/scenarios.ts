import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { generateDailyBrief, clearBriefStoreForTests } from '@/lib/attention/generateBrief';
import { createDurableMemory } from '@/lib/memory/policy';
import { detectContextConflicts } from '@/lib/insights/conflicts';
import { detectLooseEnds } from '@/lib/insights/looseEnds';
import { detectStaleContext } from '@/lib/insights/stale';
import { retrieveDriveSignals } from '@/lib/google/drive';
import { createDemoConnectedState, createDisconnectedState } from '@/lib/google/auth';
import { collectWorkspaceSignals } from '@/lib/google/workspace';
import { runGapswiseOrchestrator } from '@/lib/agents/orchestrator';
import { applyCorrectionToMemories } from '@/lib/personalization/applyFeedback';
import { Project } from '@/types/clarity';

export interface EvalScenarioResult {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}

function addSource(project: Project, id: string, filename: string, content: string) {
  project.sources.push({
    id,
    filename,
    type: 'text',
    content,
    extracted_at: '2026-08-10T12:00:00Z',
    derived_node_ids: [],
    processing_status: 'completed',
  });
}

function scenario(id: string, title: string, passed: boolean, detail: string): EvalScenarioResult {
  return { id, title, passed, detail };
}

export function runEvaluationSuite(): EvalScenarioResult[] {
  clearBriefStoreForTests();
  const results: EvalScenarioResult[] = [];

  {
    const pack = buildContextPack({ userId: 'eval', query: 'target persona demo', project: createGoldenDemoProject(), profile: DEFAULT_USER_PROFILE });
    results.push(scenario('retrieval-1', 'Context Pack includes target-persona gap', pack.unresolvedGaps.some((gap) => gap.id === 'unknown_target_user'), `${pack.includedContextIds.length} context IDs`));
  }
  {
    const project = createGoldenDemoProject();
    addSource(project, 'src_recipe_eval', 'recipe.txt', 'Sourdough flour water salt.');
    const pack = buildContextPack({ userId: 'eval', query: 'target persona demo', project, profile: DEFAULT_USER_PROFILE });
    results.push(scenario('retrieval-2', 'Irrelevant recipe does not flood evidence', !pack.relevantEvidence.some((e) => e.source_id === 'src_recipe_eval'), 'recipe excluded'));
  }
  {
    const brief = generateDailyBrief({ userId: 'eval', project: createGoldenDemoProject(), memories: [], period: '2026-08-10', force: true });
    results.push(scenario('attention-1', 'Today shows <= 5 recommendations', brief.recommendations.length <= 5, `${brief.recommendations.length} recommendations`));
  }
  {
    const project = createGoldenDemoProject();
    addSource(project, 'src_recruiter_eval', 'recruiter-email.txt', 'Recruiter asked about a better-paying AI role.');
    const brief = generateDailyBrief({ userId: 'eval', project, memories: [createDurableMemory('Financial stability is my top priority for the next 3 months.')!], period: '2026-08-10', force: true });
    results.push(scenario('attention-2', 'Income priority ranks recruiter', brief.recommendations[0]?.id === 'rec_recruiter_src_recruiter_eval', brief.recommendations[0]?.id ?? 'none'));
  }
  {
    const project = createGoldenDemoProject();
    addSource(project, 'src_meeting_eval', 'calendar-note.txt', 'Demo meeting tomorrow requires target persona preparation.');
    const brief = generateDailyBrief({ userId: 'eval', project, memories: [], period: '2026-08-10', force: true });
    results.push(scenario('attention-3', 'Urgent meeting creates preparation recommendation', brief.recommendations[0]?.kind === 'preparation', brief.recommendations[0]?.kind ?? 'none'));
  }
  {
    const project = createGoldenDemoProject();
    project.nodes.push({ id: 'persona_founder_eval', type: 'DECISION', text: 'Primary target persona is a startup founder.', status: 'OPEN', confidence: 0.8, impact: 0.8, source_refs: [], created_by: 'user', created_at: '2026-08-10T10:00:00Z', updated_at: '2026-08-10T10:00:00Z' });
    project.nodes.push({ id: 'persona_student_eval', type: 'DECISION', text: 'Primary target persona is a student researcher.', status: 'OPEN', confidence: 0.8, impact: 0.8, source_refs: [], created_by: 'user', created_at: '2026-08-10T10:00:00Z', updated_at: '2026-08-10T10:00:00Z' });
    results.push(scenario('insight-1', 'Persona conflict detected', detectContextConflicts({ userId: 'eval', project, memories: [] }).length === 1, 'conflict count checked'));
  }
  {
    const project = createGoldenDemoProject();
    addSource(project, 'src_recruiter_loose_eval', 'recruiter-email.txt', 'Recruiter asked for a reply about a better-paying AI role.');
    results.push(scenario('insight-2', 'Recruiter reply loose end detected', detectLooseEnds({ userId: 'eval', project, memories: [createDurableMemory('Financial stability is my top priority for the next 3 months.')!] }).length > 0, 'loose end checked'));
  }
  {
    const stale = detectStaleContext({ userId: 'eval', project: createGoldenDemoProject(), memories: [{ id: 'mem_eval', category: 'current_priorities', text: 'Financial stability is my top priority.', source: 'explicit', source_refs: [], confidence: 0.9, created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T10:00:00Z', last_confirmed_at: '2026-07-01T10:00:00Z', why_remembered: 'Explicit priority.' }], now: new Date('2026-08-10T10:00:00Z') });
    results.push(scenario('insight-3', 'Stale priority detected', stale.length > 0, 'stale checked'));
  }
  {
    const drive = retrieveDriveSignals(createDemoConnectedState('drive', { selectedDriveIds: ['career-folder'] }));
    results.push(scenario('integration-1', 'Drive selected folder boundary', drive.files.length === 1 && drive.files[0].id === 'drive_cv_1', drive.files.map((f) => f.id).join(',')));
  }
  {
    const signals = collectWorkspaceSignals({ integrations: [createDisconnectedState('calendar'), createDisconnectedState('gmail'), createDisconnectedState('drive')], query: 'recruiter' });
    results.push(scenario('integration-2', 'Disconnected integrations retrieve nothing', signals.derivedSources.length === 0, `${signals.derivedSources.length} sources`));
  }
  {
    const turn = runGapswiseOrchestrator({ userId: 'eval', input: 'What should I decide next?', project: createGoldenDemoProject(), profile: DEFAULT_USER_PROFILE });
    results.push(scenario('agent-1', 'Agent trace has four agents', turn.trace.agentEvents.length === 4, turn.trace.agentEvents.map((e) => e.agentName).join(' -> ')));
  }
  {
    const low = runGapswiseOrchestrator({ userId: 'eval', input: 'What should I decide next?', project: createGoldenDemoProject(), profile: { ...DEFAULT_USER_PROFILE, question_frequency: 'low' } });
    results.push(scenario('personalization-1', 'Low question frequency still returns valid partner mode', ['ask_question', 'recommend_action', 'acknowledge'].includes(low.partner.mode), low.partner.mode));
  }
  {
    const memories = applyCorrectionToMemories({ memories: [], explanation: 'Financial stability is my top priority for the next 3 months.' });
    results.push(scenario('personalization-2', 'Priority correction creates memory', memories.some((m) => m.category === 'current_priorities'), `${memories.length} memories`));
  }
  {
    const project = createGoldenDemoProject();
    const brief = generateDailyBrief({ userId: 'eval', project, memories: [], period: '2026-08-10', force: true });
    results.push(scenario('explainability-1', 'Recommendations include context packs', brief.recommendations.every((r) => r.context_pack.includedContextIds.length > 0), 'context pack checked'));
  }
  {
    const project = createGoldenDemoProject();
    const resetA = JSON.stringify(project);
    const resetB = JSON.stringify(createGoldenDemoProject());
    results.push(scenario('demo-1', 'Golden Demo seed is deterministic enough for reset', resetA === resetB, 'seed compared'));
  }

  return results;
}
