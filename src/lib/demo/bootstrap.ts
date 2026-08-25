import { createGoldenDemoProject, DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { persistAskConversationContext } from '@/lib/ask/conversationContext';
import { persistAskProposal } from '@/lib/ask/conversationContext';
import { askGapswise, type AskResult } from '@/lib/ask/adkClient';
import { confirmDecision } from '@/lib/decisions/workspace';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { getCachedFocusAssessment } from '@/lib/focus/focusCache';
import {
  CAREER_CONFLICT_DEMO_ID,
  createCareerConflictDemoMemories,
  createCareerConflictDemoProject,
} from '@/lib/demo/careerConflict';
import {
  createHackathonDemoMemories,
  createHackathonDemoProject,
  HACKATHON_DEMO_ID,
} from '@/lib/demo/hackathon';
import {
  createKintaGenDemoMemories,
  createKintaGenDemoProject,
  KINTAGEN_DEMO_ID,
} from '@/lib/demo/kintagen';
import {
  BAKERY_DEMO_ID,
  createBakeryDemoMemories,
  createBakeryDemoProject,
} from '@/lib/demo/bakery';
import {
  BAKERY_JOURNEY_LOCATION_DECISION,
  BAKERY_JOURNEY_SOURCES,
  bakeryJourneyProjectInput,
  findBakeryLocationDecision,
} from '@/lib/demo/bakeryJourney';
import {
  NORTHSTAR_PILOT_CHAT_ID,
  NORTHSTAR_PILOT_CONVERSATIONS,
  NORTHSTAR_PILOT_CREATED_AT,
  NORTHSTAR_PILOT_DEMO_NAME,
  NORTHSTAR_PILOT_DEMO_ID,
  NORTHSTAR_PILOT_RESOLVED_SCOPE,
  ensureNorthstarReplayDecisions,
  findNorthstarTechnicalScopeDecision,
  northstarPilotProjectInput,
} from '@/lib/demo/northstarPilot';
import { getStorageProvider } from '@/lib/storage';
import { attachHistoryFocus } from '@/lib/history/projectHistory';
import { AppScope } from '@/types/scope';
import { Project, ProjectHistoryFocus } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import { clearTracesForUser, recordTrace } from '@/lib/observability/trace';
import { getAgentModelPolicy, getGapEscalationModelConfig } from '@/lib/agents/modelPolicy';
import { rankGaps } from '@/lib/tools/graphTools';
import type { TraceAgentRun, TraceGapAnalysis, TraceHandoff, TracePipelineStep } from '@/types/observability';
import { decisionValueForTrace } from '@/lib/observability/decisionValueTrace';
import type { AskChatMessage, AskChatSession } from '@/types/ask';
import { normalizeAskContextProposals, type AskContextProposal } from '@/types/ask';
import {
  HARBOR_HOTELS_ASKS,
  HARBOR_HOTELS_CHAT_ID,
  HARBOR_HOTELS_SOURCES,
  createHarborHotelsProject,
  sourcesForHarborCheckpoint,
  type HarborHotelsCheckpoint,
} from '@/lib/demo/harborHotels';

export interface GoldenDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  created: boolean;
}

export interface CareerConflictDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
  created: boolean;
}

export interface HackathonDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
  created: boolean;
}

export interface KintaGenDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
  created: boolean;
}

export interface BakeryDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
  created: boolean;
}

export interface BakeryJourneyDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
  created: boolean;
}

export interface NorthstarPilotDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
  created: boolean;
}

export interface HarborHotelsAskActionReport {
  ask: string;
  answerReturned: boolean;
  outcome?: AskResult['outcome'];
  proposalCount: number;
  dismissedProposalId?: string;
  addedProposalId?: string;
}

export interface HarborHotelsBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  created: boolean;
  checkpoint: HarborHotelsCheckpoint;
  askActions: HarborHotelsAskActionReport[];
}

async function sharedHistoryFocus(userId: string, project: Project): Promise<ProjectHistoryFocus | undefined> {
  const contextPack = buildContextPack({
    userId,
    query: 'What needs my attention today?',
    project,
    profile: DEFAULT_USER_PROFILE,
    durableMemories: [],
    includeBroadContext: true,
  });
  const assessment = await getCachedFocusAssessment(userId, project, contextPack, DEFAULT_USER_PROFILE);
  if (!assessment) return undefined;
  return {
    title: assessment.title,
    actionNodeId: assessment.actionNodeId,
    sourceNodeIds: assessment.sourceNodeIds,
    sourceIds: assessment.sourceIds,
  };
}

function recordDemoDecisionMapActivity(userId: string, project: Project, route: string): void {
  // This event is explicitly a simulation: the route is shown as would_use,
  // while simulation=true makes it clear that no external call occurred.
  const execution: TracePipelineStep['execution'] = 'would_use';
  const nodeCount = (type: Project['nodes'][number]['type']) => project.nodes.filter((node) => node.type === type).length;
  const agentConfigs = Object.values(getAgentModelPolicy()).map((config) => ({
    agentName: `${config.role[0].toUpperCase()}${config.role.slice(1)} Agent`,
    model: config.model,
    thinkingLevel: config.thinkingLevel,
    maxOutputTokens: config.maxOutputTokens,
    execution: execution as 'not_used' | 'would_use',
  }));
  const sourceNames = project.sources.slice(0, 4).map((source) => source.filename).join(', ');
  const remainingSources = project.sources.length - Math.min(project.sources.length, 4);
  const sourceSummary = `${sourceNames}${remainingSources > 0 ? `, plus ${remainingSources} more` : ''}`;
  const edgeCount = project.edges.length;
  const openGapCount = project.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN').length;
  const decisionCount = nodeCount('DECISION');
  const candidates = rankGaps(project).slice(0, 5);
  const escalationConfig = getGapEscalationModelConfig();
  const nodeBreakdown = ['GOAL', 'DECISION', 'UNKNOWN', 'PREFERENCE', 'EVIDENCE', 'RISK', 'NEXT_ACTION']
    .map((type) => `${type.toLowerCase()} ${nodeCount(type as Project['nodes'][number]['type'])}`)
    .join(', ');
  const pipelineSteps: TracePipelineStep[] = [
    {
      name: 'Receive context sources',
      summary: `Would receive ${project.sources.length} project sources (${sourceSummary}) and select them for processing.`,
      execution: 'deterministic',
      contextCount: project.sources.length,
    },
    {
      name: 'Context Agent / extract graph statements',
      agentName: 'Context Agent',
      summary: `Would read the selected sources and extract ${project.nodes.length} candidate nodes (${nodeBreakdown}) plus ${edgeCount} relationships.`,
      execution,
      contextCount: project.sources.length,
    },
    {
      name: 'Assemble project graph',
      summary: `Would merge extracted statements into ${project.nodes.length} nodes and ${edgeCount} edges while preserving source links.`,
      execution: 'deterministic',
      contextCount: project.nodes.length,
    },
    {
      name: 'Gap Agent / find unresolved questions',
      agentName: 'Gap Agent',
      summary: `Would identify and rank ${openGapCount} open questions against the project goals and constraints.`,
      execution,
      contextCount: openGapCount,
    },
    {
      name: 'Attention Agent / rank what matters next',
      agentName: 'Attention Agent',
      summary: `Would rank the highest-value gaps, risks, and next actions for the current decision path (${decisionCount} decisions).`,
      execution,
      contextCount: project.nodes.length,
    },
    {
      name: 'Partner Agent / prepare the next action',
      agentName: 'Partner Agent',
      summary: 'Would turn the ranked graph state into concise guidance and a next recommended action.',
      execution,
      contextCount: project.nodes.length,
    },
    {
      name: 'Persist Decision Map state',
      summary: 'Would save the resulting nodes, edges, and source provenance for this project.',
      execution: 'deterministic',
      contextCount: project.nodes.length,
    },
    {
      name: 'Render Decision Map view',
      summary: 'The client lays out the resulting nodes and relationships with the deterministic graph renderer.',
      execution: 'deterministic',
      contextCount: project.nodes.length,
    },
  ];
  const agentRuns: TraceAgentRun[] = agentConfigs.map((config) => ({
    runId: `demo_simulation_${project.id}_${config.agentName.toLowerCase().replace(/\s+/g, '_')}`,
    agent: config.agentName,
    model: config.model,
    thinkingLevel: config.thinkingLevel,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    estimatedCost: 0,
    costSource: 'zero_cost_simulation',
    validationStatus: 'not_run',
    confidence: null,
    escalated: false,
    escalationReason: 'Simulation only; no retry was run.',
    execution: 'would_use',
    inputSummary: `${project.sources.length} seeded context sources`,
    outputSummary: 'Would produce sanitized structured graph or guidance output.',
  }));
  const gapAnalysis: TraceGapAnalysis = {
    candidates: candidates.map((candidate, index) => {
      const node = project.nodes.find((item) => item.id === candidate.node_id);
      return {
        id: candidate.node_id,
        rank: index + 1,
        priority: candidate.priority,
        confidence: Number((1 - candidate.uncertainty).toFixed(3)),
        summary: `${node?.type.toLowerCase() ?? 'gap'} · ${candidate.decision_value?.meaningful_effect_count ?? 0} affected targets · ${node?.source_refs.length ?? 0} evidence links`,
        decisionValue: decisionValueForTrace(candidate),
      };
    }),
    selectedGapId: candidates[0]?.node_id ?? null,
    selectionReason: candidates.length
      ? 'Simulation selects the actionable gap with the highest expected downstream decision value.'
      : 'No open high-impact gap was available in the seed.',
    confidence: candidates[0] ? Number((1 - candidates[0].uncertainty).toFixed(3)) : null,
    evidenceIds: candidates[0] ? project.nodes.find((node) => node.id === candidates[0].node_id)?.source_refs ?? [] : [],
    escalated: false,
    escalationReason: 'Simulation only; escalation is disabled and no stronger retry was run.',
    escalationModel: escalationConfig.model,
    escalationThinkingLevel: escalationConfig.thinkingLevel,
    escalationMaxOutputTokens: escalationConfig.maxOutputTokens,
  };
  const handoffs: TraceHandoff[] = [
    { id: `demo_${project.id}_context_gap`, from: 'Context', to: 'Gap', inputCount: project.sources.length, outputCount: candidates.length, selectedIds: candidates.map((candidate) => candidate.node_id), summary: 'Would hand extracted graph candidates to gap ranking.' },
    { id: `demo_${project.id}_gap_attention`, from: 'Gap', to: 'Attention', inputCount: candidates.length, outputCount: candidates[0] ? 1 : 0, selectedIds: candidates[0] ? [candidates[0].node_id] : [], summary: 'Would hand the ranked gap set to attention prioritization.' },
    { id: `demo_${project.id}_attention_partner`, from: 'Attention', to: 'Partner', inputCount: candidates.length, outputCount: candidates[0] ? 1 : 0, selectedIds: candidates[0] ? [candidates[0].node_id] : [], summary: 'Would hand the top recommendation to the partner response step.' },
    { id: `demo_${project.id}_partner_ui`, from: 'Partner', to: 'UI', inputCount: candidates[0] ? 1 : 0, outputCount: 1, selectedIds: candidates[0] ? [candidates[0].node_id] : [], summary: 'Would hand structured guidance to the Decision Map/Today UI.' },
  ];

  clearTracesForUser(userId);
  recordTrace({
    userId,
    route,
    label: 'Simulated initial Decision Map build from demo context',
    started_at: new Date().toISOString(),
    duration_ms: 0,
    agentNames: agentConfigs.map((config) => config.agentName),
    contextIds: project.nodes.map((node) => node.id),
    scores: [],
    toolCalls: ['demo seed', 'deterministic graph generation'],
    agentConfigs,
    agentRuns,
    gapAnalysis,
    handoffs,
    pipelineSteps,
    simulation: true,
    contextSummary: {
      scope: project.id,
      includedContextCount: project.nodes.length,
      goalCount: nodeCount('GOAL'),
      unresolvedGapCount: project.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN').length,
      evidenceCount: nodeCount('EVIDENCE'),
      preferenceCount: nodeCount('PREFERENCE'),
      decisionCount: nodeCount('DECISION'),
      commitmentCount: nodeCount('NEXT_ACTION'),
    },
  });
}

/**
 * Copy the reusable Golden Demo seed into one user's storage. The canonical
 * project ID makes this operation idempotent without touching demo-user.
 */
export async function loadGoldenDemoForUser(userId: string): Promise<GoldenDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.find((project) => project.id === 'hackathon_demo');
  const project = existingDemo ?? createGoldenDemoProject();
  const created = !existingDemo;

  if (created) {
    await storage.saveProject(userId, project);
  }

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);
  recordDemoDecisionMapActivity(userId, project, '/api/projects/demo');

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    created,
  };
}

/** Loads a fresh, repeatable career-preference conflict demo into user-scoped storage. */
export async function loadCareerConflictDemoForUser(userId: string): Promise<CareerConflictDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.find((project) => project.id === CAREER_CONFLICT_DEMO_ID);
  const project = createCareerConflictDemoProject();
  const memories = createCareerConflictDemoMemories();

  await storage.resetUserData(userId);
  await storage.saveProject(userId, project);
  await storage.replaceMemories(userId, memories);

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);
  recordDemoDecisionMapActivity(userId, project, '/api/projects/career-demo');

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories,
    created: !existingDemo,
  };
}

/** Loads a fresh, repeatable non-meta hackathon project into user-scoped storage. */
export async function loadHackathonDemoForUser(userId: string): Promise<HackathonDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.some((candidate) => candidate.id === HACKATHON_DEMO_ID);
  const project = createHackathonDemoProject();
  const memories = createHackathonDemoMemories();

  await storage.resetUserData(userId);
  await storage.saveProject(userId, project);
  await storage.replaceMemories(userId, memories);

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);
  recordDemoDecisionMapActivity(userId, project, '/api/projects/hackathon-demo');

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories,
    created: !existingDemo,
  };
}

/** Loads a fresh, repeatable scientific AI assistant project into user-scoped storage. */
export async function loadKintaGenDemoForUser(userId: string): Promise<KintaGenDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.some((candidate) => candidate.id === KINTAGEN_DEMO_ID);
  const project = createKintaGenDemoProject();
  const memories = createKintaGenDemoMemories();

  await storage.resetUserData(userId);
  await storage.saveProject(userId, project);
  await storage.replaceMemories(userId, memories);

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);
  recordDemoDecisionMapActivity(userId, project, '/api/projects/kintagen-demo');

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories,
    created: !existingDemo,
  };
}

/** Loads a fresh, repeatable weekend bakery pop-up project into user-scoped storage. */
export async function loadBakeryDemoForUser(userId: string): Promise<BakeryDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.some((candidate) => candidate.id === BAKERY_DEMO_ID);
  const project = createBakeryDemoProject();
  const memories = createBakeryDemoMemories();

  await storage.resetUserData(userId);
  await storage.saveProject(userId, project);
  await storage.replaceMemories(userId, memories);

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);
  recordDemoDecisionMapActivity(userId, project, '/api/projects/bakery-demo');

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories,
    created: !existingDemo,
  };
}

/**
 * Replays a realistic bakery project journey through the production mutation
 * paths. This intentionally does not seed nodes, edges, or history events.
 */
export async function loadBakeryJourneyDemoForUser(userId: string): Promise<BakeryJourneyDemoBootstrapResult> {
  const storage = getStorageProvider();
  await storage.resetUserData(userId);
  clearTracesForUser(userId);

  let project = createProjectFromInput(bakeryJourneyProjectInput(), '2026-08-23T11:00:00.000Z');
  await storage.saveProject(userId, project);

  for (const source of BAKERY_JOURNEY_SOURCES) {
    const processed = await processContextSource(project, {
      sourceId: source.id,
      filename: source.filename,
      content: source.content,
      type: 'note',
      origin: 'user',
    }, DEFAULT_USER_PROFILE, {
      captureProcessingLog: process.env.NODE_ENV !== 'production',
    });
    const refreshed = await refreshProjectGapRuntime({
      userId,
      project: processed.project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      route: '/api/projects/bakery-journey',
      label: `Bakery journey · ${source.filename}`,
    });
    project = refreshed.project;
    await storage.saveProject(userId, project);
  }

  const locationDecision = findBakeryLocationDecision(project);
  if (!locationDecision) {
    throw new Error('The bakery journey could not find the launch-location decision after processing its sources.');
  }
  const focusBeforeDecision = await sharedHistoryFocus(userId, project);
  project = confirmDecision(project, {
    decisionNodeId: locationDecision.id,
    customDecision: BAKERY_JOURNEY_LOCATION_DECISION,
  });
  const refreshedAfterDecision = await refreshProjectGapRuntime({
    userId,
    project,
    profile: DEFAULT_USER_PROFILE,
    memories: [],
    route: '/api/projects/bakery-journey',
    label: 'Bakery journey · location decision resolved',
  });
  project = refreshedAfterDecision.project;
  const focusAfterDecision = await sharedHistoryFocus(userId, project);
  project = attachHistoryFocus(project, {
    eventType: 'decision_resolved',
    before: focusBeforeDecision,
    after: focusAfterDecision,
  });
  await storage.saveProject(userId, project);

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories: [],
    created: true,
  };
}

/**
 * Replays the Northstar pilot conversation through the production user-message
 * ingestion path. Assistant replies are persisted as chat history only. The
 * third user turn is deliberately promoted through the real decision
 * confirmation flow, and the replay stops with the security acceptance gap
 * unresolved for manual testing.
 */
export async function loadNorthstarPilotDemoForUser(userId: string): Promise<NorthstarPilotDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const created = !existingProjects.some((project) => project.id === NORTHSTAR_PILOT_DEMO_ID);
  await storage.resetUserData(userId);
  clearTracesForUser(userId);

  let project = createProjectFromInput(northstarPilotProjectInput(), NORTHSTAR_PILOT_CREATED_AT);
  await storage.saveProject(userId, project);

  const chat: AskChatSession = {
    id: NORTHSTAR_PILOT_CHAT_ID,
    userId,
    scopeType: 'project',
    projectId: project.id,
    title: NORTHSTAR_PILOT_DEMO_NAME,
    createdAt: NORTHSTAR_PILOT_CONVERSATIONS[0]?.createdAt ?? project.created_at,
    updatedAt: project.created_at,
  };
  await storage.saveAskChat(userId, chat);

  for (const [index, conversation] of NORTHSTAR_PILOT_CONVERSATIONS.entries()) {
    const turn = index + 1;
    const userMessage: AskChatMessage = {
      id: `${NORTHSTAR_PILOT_CHAT_ID}_user_${turn}`,
      chatId: NORTHSTAR_PILOT_CHAT_ID,
      userId,
      projectId: project.id,
      role: 'user',
      text: conversation.user,
      sources: [],
      createdAt: conversation.createdAt,
    };
    await storage.saveAskMessage(userId, userMessage);

    const ingested = await persistAskConversationContext({
      userId,
      chatId: NORTHSTAR_PILOT_CHAT_ID,
      messageId: userMessage.id,
      text: conversation.user,
      projectId: project.id,
      captureProcessingLog: process.env.NODE_ENV !== 'production',
    });
    const ingestedProject = await storage.getProject(userId, project.id);
    if (!ingestedProject) throw new Error('The Northstar pilot project disappeared during Ask ingestion.');
    project = ingestedProject;
    if (index === 0) {
      project = ensureNorthstarReplayDecisions(project, ingested.sourceId);
    }

    const refreshed = await refreshProjectGapRuntime({
      userId,
      project,
      profile: DEFAULT_USER_PROFILE,
      memories: [],
      route: '/api/projects/northstar-pilot',
      label: `Northstar pilot · Ask turn ${turn}`,
    });
    project = refreshed.project;
    await storage.saveProject(userId, project);
    await sharedHistoryFocus(userId, project);

    await storage.saveAskMessage(userId, {
      ...userMessage,
      openQuestionIds: ingested.openQuestionIds,
      openQuestions: ingested.openQuestions,
    });

    if (index === 2) {
      const technicalScopeDecision = findNorthstarTechnicalScopeDecision(project);
      if (!technicalScopeDecision) {
        throw new Error('The Northstar pilot could not find the extracted technical-scope decision.');
      }
      const focusBeforeDecision = await sharedHistoryFocus(userId, project);
      project = confirmDecision(project, {
        decisionNodeId: technicalScopeDecision.id,
        customDecision: NORTHSTAR_PILOT_RESOLVED_SCOPE,
        reason: 'Northstar accepted the reduced pilot scope for phase one.',
      });
      const refreshedAfterDecision = await refreshProjectGapRuntime({
        userId,
        project,
        profile: DEFAULT_USER_PROFILE,
        memories: [],
        route: '/api/projects/northstar-pilot',
        label: 'Northstar pilot · technical scope decision resolved',
      });
      project = refreshedAfterDecision.project;
      await storage.saveProject(userId, project);
      const focusAfterDecision = await sharedHistoryFocus(userId, project);
      project = attachHistoryFocus(project, {
        eventType: 'decision_resolved',
        before: focusBeforeDecision,
        after: focusAfterDecision,
      });
      await storage.saveProject(userId, project);
    }

    const assistantMessage: AskChatMessage = {
      id: `${NORTHSTAR_PILOT_CHAT_ID}_assistant_${turn}`,
      chatId: NORTHSTAR_PILOT_CHAT_ID,
      userId,
      projectId: project.id,
      role: 'assistant',
      text: conversation.assistant,
      sources: [],
      createdAt: conversation.createdAt,
      outcome: index === 4 ? 'recommendation' : undefined,
    };
    await storage.saveAskMessage(userId, assistantMessage);
    await storage.saveAskChat(userId, {
      ...chat,
      updatedAt: conversation.createdAt,
    });
  }

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories: [],
    created,
  };
}

function assertHarborLiveAi(): void {
  if (process.env.GAPSWISE_DEMO_MODE?.trim().toLowerCase() === 'true') {
    throw new Error('Harbor Hotels checkpoints require live AI. Start Gapwise with GAPSWISE_DEMO_MODE=false.');
  }
  if (process.env.GAP_AGENT_MODE?.trim().toLowerCase() !== 'live') {
    throw new Error('Harbor Hotels checkpoints require the live Gap Agent. Start Gapwise with "npm run dev:ai".');
  }
}

async function replayHarborSource(userId: string, project: Project, source: (typeof HARBOR_HOTELS_SOURCES)[number]): Promise<Project> {
  const processed = await processContextSource(project, {
    sourceId: source.id,
    filename: source.filename,
    content: source.content,
    type: 'note',
    origin: 'user',
  }, DEFAULT_USER_PROFILE, {
    captureProcessingLog: process.env.NODE_ENV !== 'production',
  });
  if (processed.error) throw new Error(processed.error);

  const refreshed = await refreshProjectGapRuntime({
    userId,
    project: processed.project,
    profile: DEFAULT_USER_PROFILE,
    memories: [],
    route: '/api/projects/harbor-hotels',
    label: `Harbor Hotels · ${source.filename}`,
  });
  const nextProject = refreshed.project;
  await getStorageProvider().saveProject(userId, nextProject);
  return nextProject;
}

function harborAssistantMessageId(userMessageId: string): string {
  return `ask_assistant_${userMessageId}`;
}

function harborUserMessageId(turn: number): string {
  return `harbor_hotels_user_${turn}`;
}

function harborAskCreatedAt(turn: number): string {
  return `2026-08-24T12:${String(20 + turn).padStart(2, '0')}:00.000Z`;
}

async function runHarborAsk(params: {
  userId: string;
  project: Project;
  message: string;
  turn: number;
  sessionId?: string;
}): Promise<{ project: Project; result: AskResult; assistantMessageId: string; proposal: AskContextProposal | undefined }> {
  const storage = getStorageProvider();
  const userMessageId = harborUserMessageId(params.turn);
  const assistantMessageId = harborAssistantMessageId(userMessageId);
  const createdAt = harborAskCreatedAt(params.turn);
  const existingChat = (await storage.getAskChats(params.userId)).find((chat) => chat.id === HARBOR_HOTELS_CHAT_ID);
  const chat: AskChatSession = {
    id: HARBOR_HOTELS_CHAT_ID,
    userId: params.userId,
    scopeType: 'project',
    projectId: params.project.id,
    title: 'Harbor Hotels MVP evaluation',
    ...(existingChat?.adkSessionId || params.sessionId
      ? { adkSessionId: existingChat?.adkSessionId ?? params.sessionId }
      : {}),
    createdAt: existingChat?.createdAt ?? createdAt,
    updatedAt: createdAt,
  };
  await storage.saveAskChat(params.userId, chat);

  const ingested = await persistAskConversationContext({
    userId: params.userId,
    chatId: HARBOR_HOTELS_CHAT_ID,
    messageId: userMessageId,
    text: params.message,
    projectId: params.project.id,
    captureProcessingLog: process.env.NODE_ENV !== 'production',
  });
  const projectAfterUserMessage = await storage.getProject(params.userId, params.project.id);
  if (!projectAfterUserMessage) throw new Error('The Harbor Hotels project disappeared during Ask ingestion.');

  const result = await askGapswise({
    userId: params.userId,
    message: params.message,
    ...(chat.adkSessionId ? { sessionId: chat.adkSessionId } : {}),
    projectId: params.project.id,
    chatId: HARBOR_HOTELS_CHAT_ID,
    excludeMessageId: userMessageId,
    excludeSourceId: ingested.sourceId,
    openQuestions: ingested.openQuestions,
  });
  const contextProposals = normalizeAskContextProposals(
    result.contextProposals?.length ? result.contextProposals : result.proposals,
  ).map((proposal, index) => ({
    ...proposal,
    id: proposal.id ?? `proposal_${assistantMessageId}_${index}`,
    sourceMessageId: proposal.sourceMessageId ?? assistantMessageId,
  }));

  await storage.saveAskMessage(params.userId, {
    id: userMessageId,
    chatId: HARBOR_HOTELS_CHAT_ID,
    userId: params.userId,
    projectId: params.project.id,
    role: 'user',
    text: params.message,
    sources: [],
    createdAt,
    openQuestionIds: ingested.openQuestionIds,
    openQuestions: ingested.openQuestions,
  });
  await storage.saveAskMessage(params.userId, {
    id: assistantMessageId,
    chatId: HARBOR_HOTELS_CHAT_ID,
    userId: params.userId,
    projectId: params.project.id,
    role: 'assistant',
    text: result.answer,
    sources: result.sources,
    createdAt,
    openQuestionIds: result.openQuestionIds ?? ingested.openQuestionIds,
    openQuestions: result.openQuestions ?? ingested.openQuestions,
    ...(result.outcome ? { outcome: result.outcome } : {}),
    ...(result.resolvesQuestionId ? { resolvesQuestionId: result.resolvesQuestionId } : {}),
    ...(result.conclusion ? { conclusion: result.conclusion } : {}),
    ...(contextProposals.length ? { contextProposals, proposals: contextProposals } : {}),
    ...(result.execution ? { execution: result.execution } : {}),
  });
  await storage.saveAskChat(params.userId, {
    ...chat,
    ...(result.sessionId ? { adkSessionId: result.sessionId } : {}),
    updatedAt: createdAt,
  });

  return {
    project: projectAfterUserMessage,
    result: { ...result, contextProposals, proposals: contextProposals },
    assistantMessageId,
    proposal: contextProposals.find((candidate) => candidate.type === 'RISK') ?? contextProposals[0],
  };
}

async function markHarborProposalAdded(params: {
  userId: string;
  projectId: string;
  assistantMessageId: string;
  proposal: AskContextProposal;
}): Promise<Project> {
  const project = await persistAskProposal(params);
  const storage = getStorageProvider();
  const messages = await storage.getAskMessages(params.userId);
  const assistant = messages.find((message) => message.id === params.assistantMessageId);
  if (assistant) {
    const proposals = normalizeAskContextProposals(assistant.contextProposals ?? assistant.proposals)
      .map((candidate) => candidate.id === params.proposal.id
        ? { ...candidate, confirmationStatus: 'added' as const }
        : candidate);
    await storage.saveAskMessage(params.userId, {
      ...assistant,
      contextProposals: proposals,
      proposals,
    });
  }
  return project;
}

/**
 * Builds a Harbor Hotels checkpoint by replaying user-authored sources through
 * live Context Agent, ProjectPatch, graph persistence, Gap Agent, and Ask
 * flows. It intentionally has no precomputed nodes, edges, or simulated
 * Decision Map trace.
 */
export async function loadHarborHotelsCheckpointForUser(
  userId: string,
  checkpoint: HarborHotelsCheckpoint,
): Promise<HarborHotelsBootstrapResult> {
  assertHarborLiveAi();
  const storage = getStorageProvider();
  const existing = (await storage.listProjects(userId)).find((project) => project.id === `harbor-hotels-${checkpoint}`);
  await storage.resetUserData(userId);
  clearTracesForUser(userId);

  let project = createHarborHotelsProject(checkpoint);
  await storage.saveProject(userId, project);
  for (const source of sourcesForHarborCheckpoint('early')) {
    project = await replayHarborSource(userId, project, source);
  }

  const askActions: HarborHotelsAskActionReport[] = [];
  let sessionId: string | undefined;
  if (checkpoint !== 'early') {
    for (const source of HARBOR_HOTELS_SOURCES.slice(3, 5)) {
      project = await replayHarborSource(userId, project, source);
    }

    const retentionAsk = await runHarborAsk({
      userId,
      project,
      message: HARBOR_HOTELS_ASKS.retentionRisk,
      turn: 1,
      sessionId,
    });
    sessionId = retentionAsk.result.sessionId;
    project = retentionAsk.project;
    askActions.push({
      ask: HARBOR_HOTELS_ASKS.retentionRisk,
      answerReturned: Boolean(retentionAsk.result.answer),
      outcome: retentionAsk.result.outcome,
      proposalCount: retentionAsk.result.contextProposals?.length ?? 0,
      ...(retentionAsk.proposal ? { dismissedProposalId: retentionAsk.proposal.id } : {}),
    });

    const reliabilityAsk = await runHarborAsk({
      userId,
      project,
      message: HARBOR_HOTELS_ASKS.dataReliabilityRisk,
      turn: 2,
      sessionId,
    });
    sessionId = reliabilityAsk.result.sessionId;
    project = reliabilityAsk.project;
    let addedProposalId: string | undefined;
    if (reliabilityAsk.proposal) {
      project = await markHarborProposalAdded({
        userId,
        projectId: project.id,
        assistantMessageId: reliabilityAsk.assistantMessageId,
        proposal: reliabilityAsk.proposal,
      });
      const refreshed = await refreshProjectGapRuntime({
        userId,
        project,
        profile: DEFAULT_USER_PROFILE,
        memories: [],
        route: '/api/projects/harbor-hotels',
        label: 'Harbor Hotels · added Ask proposal',
      });
      project = refreshed.project;
      await storage.saveProject(userId, project);
      addedProposalId = reliabilityAsk.proposal.id;
    }
    askActions.push({
      ask: HARBOR_HOTELS_ASKS.dataReliabilityRisk,
      answerReturned: Boolean(reliabilityAsk.result.answer),
      outcome: reliabilityAsk.result.outcome,
      proposalCount: reliabilityAsk.result.contextProposals?.length ?? 0,
      ...(addedProposalId ? { addedProposalId } : {}),
    });
  }

  if (checkpoint === 'late') {
    for (const source of HARBOR_HOTELS_SOURCES.slice(5)) {
      project = await replayHarborSource(userId, project, source);
    }

    const weekendSupportAsk = await runHarborAsk({
      userId,
      project,
      message: HARBOR_HOTELS_ASKS.weekendSupportTradeoff,
      turn: 3,
      sessionId,
    });
    project = weekendSupportAsk.project;
    askActions.push({
      ask: HARBOR_HOTELS_ASKS.weekendSupportTradeoff,
      answerReturned: Boolean(weekendSupportAsk.result.answer),
      outcome: weekendSupportAsk.result.outcome,
      proposalCount: weekendSupportAsk.result.contextProposals?.length ?? 0,
    });
  }

  await storage.saveProject(userId, project);
  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    created: !existing,
    checkpoint,
    askActions,
  };
}
