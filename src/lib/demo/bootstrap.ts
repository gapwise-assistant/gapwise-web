import { createGoldenDemoProject } from '@/lib/demo/seed';
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
import { getStorageProvider } from '@/lib/storage';
import { AppScope } from '@/types/scope';
import { Project } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';
import { clearTracesForUser, recordTrace } from '@/lib/observability/trace';
import { getAgentModelPolicy, getGapEscalationModelConfig } from '@/lib/agents/modelPolicy';
import { rankGaps } from '@/lib/tools/graphTools';
import type { TraceAgentRun, TraceGapAnalysis, TraceHandoff, TracePipelineStep } from '@/types/observability';
import { decisionValueForTrace } from '@/lib/observability/decisionValueTrace';

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
