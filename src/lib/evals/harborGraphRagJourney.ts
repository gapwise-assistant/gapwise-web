import { Type } from '@google/genai';
import { z } from 'zod';
import {
  HARBOR_HOTELS_ASKS,
  HARBOR_HOTELS_SOURCES,
  harborHotelsProjectInput,
} from '@/lib/demo/harborHotels';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { persistAskConversationContext, persistAskProposal } from '@/lib/ask/conversationContext';
import { askGapswise, type AskResult } from '@/lib/ask/adkClient';
import { normalizeAskContextProposals, type AskChatSession, type AskContextProposal, type AskSource } from '@/types/ask';
import { getStorageProvider, listProjects, saveProject, setAppScope } from '@/lib/storage';
import { clearTracesForUser } from '@/lib/observability/trace';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { loadDurableMemories } from '@/lib/memory/serverStore';
import { getCachedFocusAssessment } from '@/lib/focus/focusCache';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { generateDailyBrief } from '@/lib/attention/generateBrief';
import { buildTodayQuestions, openTodayDecisions, type TodayQuestion } from '@/lib/today/sections';
import { getAgentModelConfig, getAgentModelPolicy } from '@/lib/agents/modelPolicy';
import { getVertexGenAIClient } from '@/lib/google/genai';
import type { ClarityNode, Project } from '@/types/clarity';
import type { AskRetrievedEvidence } from '@/types/ask';
import type { DailyBrief } from '@/types/attention';
import { boundedId } from '@/lib/ids/boundedId';

export interface HarborGraphRagJourneyOptions {
  userId: string;
  runId: string;
  confirmLiveAiCost: boolean;
}

export type EvaluationCheckStatus = 'pass' | 'warn' | 'fail';

export interface EvaluationCheck {
  id: string;
  phase: string;
  area: string;
  status: EvaluationCheckStatus;
  details: string;
}

export type HarborSemanticPhase = 'pilot_brief' | 'technical_scope' | 'middle' | 'late';

export interface HarborAskScenario {
  id: string;
  phase: 'early' | 'middle' | 'late';
  query: string;
  expectedRoute: 'internal_context' | 'graph_reasoning';
  expectedReasoningMode?: 'factual' | 'reasoning' | 'impact' | 'decision' | 'focus';
}

export interface HarborFocusContext {
  title?: string;
  targetNodeId?: string;
  targetText?: string;
  executionNodeId?: string;
  executionText?: string;
}

export const HARBOR_ASK_SCENARIOS: readonly HarborAskScenario[] = [
  {
    id: 'pilot-budget',
    phase: 'early',
    query: 'What is Harbor’s maximum pilot budget?',
    expectedRoute: 'internal_context',
    expectedReasoningMode: 'factual',
  },
  {
    id: 'scope-reasoning',
    phase: 'early',
    query: 'Why is the nightly CSV approach a better fit for this pilot than a real-time integration?',
    expectedRoute: 'graph_reasoning',
    expectedReasoningMode: 'reasoning',
  },
  {
    id: 'scope-reasoning-after',
    phase: 'early',
    query: 'Why is the nightly CSV approach a better fit for this pilot than a real-time integration?',
    expectedRoute: 'graph_reasoning',
    expectedReasoningMode: 'reasoning',
  },
  {
    id: 'retention-impact',
    phase: 'middle',
    query: HARBOR_HOTELS_ASKS.retentionRisk,
    expectedRoute: 'graph_reasoning',
    expectedReasoningMode: 'impact',
  },
  {
    id: 'middle-focus',
    phase: 'middle',
    query: 'What should I focus on next to keep the November 1 launch on track?',
    expectedRoute: 'graph_reasoning',
    expectedReasoningMode: 'focus',
  },
  {
    id: 'weekend-support-tradeoff',
    phase: 'late',
    query: HARBOR_HOTELS_ASKS.weekendSupportTradeoff,
    expectedRoute: 'graph_reasoning',
    expectedReasoningMode: 'reasoning',
  },
  {
    id: 'late-focus',
    phase: 'late',
    query: 'What should I focus on next to keep the November 1 launch on track?',
    expectedRoute: 'graph_reasoning',
    expectedReasoningMode: 'focus',
  },
];

function harborAskScenario(id: string): HarborAskScenario {
  const scenario = HARBOR_ASK_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Missing Harbor Ask scenario: ${id}.`);
  return scenario;
}

export interface HarborNodeSnapshot {
  id: string;
  type: string;
  status: string;
  text: string;
}

export interface HarborAskEvaluationTurn {
  id: string;
  scenarioId: string;
  phase: 'early' | 'middle' | 'late';
  query: string;
  expectedRoute: HarborAskScenario['expectedRoute'];
  expectedReasoningMode?: HarborAskScenario['expectedReasoningMode'];
  selectedRoute?: string;
  reasoningMode?: string;
  seedNodeIds: string[];
  expandedNodeIds: string[];
  relationshipIds: string[];
  sourceIds: string[];
  paths: Array<{ nodeIds: string[]; edgeIds: string[] }>;
  retrievedEvidence: AskRetrievedEvidence[];
  selectedNodes: HarborNodeSnapshot[];
  citedSources: Array<{ id: string; title: string; url?: string }>;
  answer: string;
  execution?: AskResult['execution'];
  outcome?: string;
  proposals: AskContextProposal[];
  focusContext?: HarborFocusContext;
  checks: EvaluationCheck[];
}

export interface HarborJourneySnapshot {
  step: number;
  label: string;
  timestamp: string;
  projectId: string;
  reloadedProjectId: string;
  sourceId?: string;
  processingStatus?: string;
  derivedNodeIds?: string[];
  nodeCount: number;
  edgeCount: number;
  sourceCount: number;
  historyCount: number;
  openUnknowns: Array<{ id: string; text: string }>;
  openDecisions: Array<{ id: string; text: string }>;
  resolvedDecisions: Array<{ id: string; text: string; outcome?: string }>;
  openActions: Array<{ id: string; text: string }>;
  saveCompleted: boolean;
}

export interface HarborFocusEvaluation {
  phase: 'middle' | 'late';
  assessment: FocusAssessment | null;
  targetNode?: HarborNodeSnapshot;
  executionNode?: HarborNodeSnapshot;
  representedNodes: HarborNodeSnapshot[];
  today: {
    recommendedFocusTitle?: string;
    primaryAction: 'resolve' | 'decide' | 'complete' | null;
    visibleOpenQuestions: Array<{ id: string; text: string; sourceNodeIds: string[] }>;
    visibleDecisions: Array<{ id: string; text: string }>;
    duplicatedRepresentedNodeIds: string[];
  };
  checks: EvaluationCheck[];
}

export interface HarborAiEvaluation {
  overallScore: number;
  dimensions: {
    extractionQuality: number;
    graphCoherence: number;
    retrievalQuality: number;
    sourceGrounding: number;
    decisionStatusAccuracy: number;
    focusConsistency: number;
    answerUsefulness: number;
  };
  failures: Array<{
    severity: 'critical' | 'major' | 'minor';
    area: string;
    evidence: string;
    recommendation: string;
  }>;
  strengths: string[];
  summary: string;
}

export interface HarborGraphRagEvaluationReport {
  runId: string;
  userId: string;
  projectId: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  failureStage?: string;
  models: Record<string, string>;
  pipeline: Record<string, 'used' | 'passed' | 'failed' | 'not_run'>;
  timeline: HarborJourneySnapshot[];
  askTurns: HarborAskEvaluationTurn[];
  focusEvaluations: HarborFocusEvaluation[];
  deterministicChecks: EvaluationCheck[];
  aiEvaluation: HarborAiEvaluation | null;
  finalProject: Project | null;
}

type JourneyState = {
  project: Project;
  timeline: HarborJourneySnapshot[];
  askTurns: HarborAskEvaluationTurn[];
  focusEvaluations: HarborFocusEvaluation[];
  checks: EvaluationCheck[];
  step: number;
  chat: AskChatSession;
  sessionId?: string;
};

const aiEvaluationSchema = z.object({
  overallScore: z.number().min(0).max(1),
  dimensions: z.object({
    extractionQuality: z.number().min(0).max(1),
    graphCoherence: z.number().min(0).max(1),
    retrievalQuality: z.number().min(0).max(1),
    sourceGrounding: z.number().min(0).max(1),
    decisionStatusAccuracy: z.number().min(0).max(1),
    focusConsistency: z.number().min(0).max(1),
    answerUsefulness: z.number().min(0).max(1),
  }),
  failures: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor']),
    area: z.string().min(1),
    evidence: z.string().min(1),
    recommendation: z.string().min(1),
  })).max(12),
  strengths: z.array(z.string().min(1)).max(12),
  summary: z.string().min(1).max(1200),
});

function expectedUserId(runId: string): string {
  return `harbor-graphrag-eval-${runId}`;
}

export function assertHarborLiveEvaluation(options: HarborGraphRagJourneyOptions): void {
  if (!options.confirmLiveAiCost || process.env.CONFIRM_LIVE_AI_COST !== 'true') {
    throw new Error('Harbor GraphRAG evaluation requires CONFIRM_LIVE_AI_COST=true.');
  }
  if (process.env.GAPSWISE_DEMO_MODE !== 'false') {
    throw new Error('Harbor GraphRAG evaluation requires GAPSWISE_DEMO_MODE=false.');
  }
  if (process.env.GAP_AGENT_MODE?.trim().toLowerCase() !== 'live') {
    throw new Error('Harbor GraphRAG evaluation requires GAP_AGENT_MODE=live.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(options.runId) || options.userId !== expectedUserId(options.runId)) {
    throw new Error(`Harbor evaluation user must be exactly ${expectedUserId(options.runId)}.`);
  }
}

function cleanTokens(value: string): Set<string> {
  return new Set(value.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .map((token) => token.endsWith('s') ? token.slice(0, -1) : token));
}

function matchesConcept(text: string, alternatives: string[]): boolean {
  const tokens = cleanTokens(text);
  return alternatives.some((alternative) => {
    const wanted = cleanTokens(alternative);
    return wanted.size > 0 && Array.from(wanted).every((token) => tokens.has(token));
  });
}

function matchingNodes(project: Project, alternatives: string[], types?: string[], statuses?: string[]): ClarityNode[] {
  return project.nodes.filter((node) =>
    node.status !== 'DEPRECATED'
      && (!types || types.includes(node.type))
      && (!statuses || statuses.includes(node.status))
      && matchesConcept(`${node.text} ${node.decision_outcome ?? ''}`, alternatives)
  );
}

function snapshotNode(node: ClarityNode | undefined): HarborNodeSnapshot | undefined {
  return node ? { id: node.id, type: node.type, status: node.status, text: node.text } : undefined;
}

function check(
  checks: EvaluationCheck[],
  id: string,
  phase: string,
  area: string,
  status: EvaluationCheckStatus,
  details: string,
): EvaluationCheck {
  const result = { id, phase, area, status, details };
  checks.push(result);
  return result;
}

function findNodeById(project: Project, id: string | undefined): ClarityNode | undefined {
  return id ? project.nodes.find((node) => node.id === id) : undefined;
}

async function reloadProject(userId: string, projectId: string): Promise<Project> {
  const project = (await listProjects(userId)).find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Project ${projectId} was not found after persistence.`);
  return project;
}

function snapshotProject(
  state: JourneyState,
  label: string,
  reloaded: Project,
  metadata: { sourceId?: string; processingStatus?: string; derivedNodeIds?: string[]; saveCompleted: boolean } = { saveCompleted: true },
): void {
  const previous = state.timeline[state.timeline.length - 1];
  if (state.project.id !== reloaded.id) {
    check(state.checks, `reload-project-id-${state.step}`, label, 'persistence', 'fail', 'The project ID changed across save/reload.');
  }
  if (previous && reloaded.nodes.length < previous.nodeCount) {
    check(state.checks, `reload-node-regression-${state.step}`, label, 'persistence', 'fail', `Node count regressed from ${previous.nodeCount} to ${reloaded.nodes.length}.`);
  }
  if (previous && reloaded.edges.length < previous.edgeCount) {
    check(state.checks, `reload-edge-regression-${state.step}`, label, 'persistence', 'fail', `Edge count regressed from ${previous.edgeCount} to ${reloaded.edges.length}.`);
  }
  state.step += 1;
  state.timeline.push({
    step: state.step,
    label,
    timestamp: new Date().toISOString(),
    projectId: state.project.id,
    reloadedProjectId: reloaded.id,
    ...metadata,
    nodeCount: reloaded.nodes.length,
    edgeCount: reloaded.edges.length,
    sourceCount: reloaded.sources.length,
    historyCount: reloaded.history.length,
    openUnknowns: reloaded.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN').map(({ id, text }) => ({ id, text })),
    openDecisions: reloaded.nodes.filter((node) => node.type === 'DECISION' && node.status === 'OPEN').map(({ id, text }) => ({ id, text })),
    resolvedDecisions: reloaded.nodes.filter((node) => node.type === 'DECISION' && node.status === 'RESOLVED').map(({ id, text, decision_outcome }) => ({ id, text, outcome: decision_outcome })),
    openActions: reloaded.nodes.filter((node) => node.type === 'NEXT_ACTION' && node.status === 'OPEN').map(({ id, text }) => ({ id, text })),
    saveCompleted: metadata.saveCompleted,
  });
}

async function saveAndReload(state: JourneyState, userId: string, project: Project, label: string, metadata?: Omit<Parameters<typeof snapshotProject>[3], 'saveCompleted'>): Promise<Project> {
  let reloaded: Project;
  try {
    await saveProject(userId, project);
    reloaded = await reloadProject(userId, project.id);
  } catch (error) {
    throw new Error(`persistence: ${error instanceof Error ? error.message : 'save/reload failed.'}`);
  }
  state.project = reloaded;
  snapshotProject(state, label, reloaded, { ...(metadata ?? {}), saveCompleted: true });
  return reloaded;
}

function semanticStageChecks(project: Project, phase: HarborSemanticPhase, checks: EvaluationCheck[]): void {
  const expected: Array<{ id: string; label: string; terms: string[]; types?: string[]; statuses?: string[] }> = phase === 'pilot_brief'
    ? [
        { id: 'pilot-budget', label: 'pilot budget', terms: ['maximum pilot budget', 'pilot budget'], types: ['KNOWN', 'CONSTRAINT', 'DECISION'] },
        { id: 'launch-date', label: 'November launch', terms: ['November 1', 'starting November 1', 'launch'], types: ['KNOWN', 'CONSTRAINT', 'GOAL'] },
        { id: 'energy-target', label: 'energy reduction target', terms: ['12% reduction', 'energy cost'], types: ['KNOWN', 'CONSTRAINT', 'GOAL'] },
        { id: 'margin-target', label: 'gross margin requirement', terms: ['40% gross margin', 'gross margin'], types: ['KNOWN', 'CONSTRAINT', 'GOAL'] },
      ]
    : phase === 'technical_scope'
      ? [
          { id: 'scope-decision', label: 'open technical-scope choice', terms: ['technical scope', 'integration'], types: ['DECISION', 'UNKNOWN'] },
          { id: 'csv-option', label: 'nightly CSV option', terms: ['nightly CSV', 'CSV exports'], types: ['KNOWN', 'EVIDENCE', 'PREFERENCE', 'DECISION'] },
          { id: 'realtime-option', label: 'real-time integration option', terms: ['real-time integration', 'building-management'], types: ['KNOWN', 'EVIDENCE', 'DECISION'] },
          { id: 'engineering-effort', label: 'engineering effort evidence', terms: ['70 to 90 engineering hours', 'four to six weeks'], types: ['KNOWN', 'EVIDENCE', 'CONSTRAINT'] },
          { id: 'custom-engineering', label: 'customer-specific engineering constraint', terms: ['customer-specific engineering', 'specific to Harbor'], types: ['CONSTRAINT', 'KNOWN', 'EVIDENCE'] },
        ]
      : phase === 'middle'
        ? [
            { id: 'scope-resolved', label: 'resolved technical decision', terms: ['technical scope', 'integration', 'nightly CSV'], types: ['DECISION'], statuses: ['RESOLVED'] },
            { id: 'nightly-csv-selected', label: 'nightly CSV selected outcome', terms: ['nightly CSV', 'CSV exports'], types: ['DECISION'], statuses: ['RESOLVED'] },
            { id: 'security-approval', label: 'security approval', terms: ['security approval'], types: ['UNKNOWN', 'CONSTRAINT', 'KNOWN', 'DECISION'] },
            { id: 'procurement', label: 'procurement dependency', terms: ['procurement', 'purchase order'], types: ['CONSTRAINT', 'KNOWN', 'EVIDENCE', 'UNKNOWN'] },
            { id: 'retention', label: 'data-retention uncertainty', terms: ['deleted within 30 days', '30 days', 'data-retention'], types: ['UNKNOWN', 'CONSTRAINT', 'EVIDENCE', 'DECISION'] },
            { id: 'questionnaire', label: 'security questionnaire/package readiness', terms: ['retention questionnaire', 'security package'], types: ['NEXT_ACTION', 'UNKNOWN', 'KNOWN', 'EVIDENCE'] },
          ]
        : [
            { id: 'retention-confirmed', label: 'deletion capability confirmation', terms: ['automatically deleted within 30 days', 'data can be automatically deleted'], types: ['KNOWN', 'EVIDENCE', 'CONSTRAINT'] },
            { id: 'support-hours', label: 'support-hour estimate', terms: ['25 to 35 support hours', 'support hours'], types: ['KNOWN', 'EVIDENCE', 'CONSTRAINT'] },
            { id: 'pricing', label: 'pricing decision', terms: ['finalized pricing', 'proposed price', 'pricing'], types: ['DECISION', 'UNKNOWN', 'CONSTRAINT'] },
            { id: 'margin-pressure', label: 'margin pressure', terms: ['40% gross margin floor', 'margin'], types: ['RISK', 'CONSTRAINT', 'KNOWN', 'EVIDENCE'] },
            { id: 'weekend-support', label: 'weekend-support decision', terms: ['weekend support'], types: ['DECISION', 'UNKNOWN', 'PREFERENCE'] },
          ];
  expected.forEach((item) => {
    const found = matchingNodes(project, item.terms, item.types, item.statuses);
    check(checks, `${phase}-concept-${item.id}`, phase, 'extraction', found.length ? 'pass' : 'warn', found.length
      ? `Found ${item.label} in ${found.length} canonical node(s).`
      : `No active node matched the expected ${item.label} concept.`);
  });
  if (phase === 'late') {
    const retentionStillOpen = project.nodes.some((node) =>
      node.status === 'OPEN'
      && node.type === 'UNKNOWN'
      && matchesConcept(node.text, ['30 days', 'data retention', 'retention'])
    );
    check(checks, 'late-retention-uncertainty-resolved', phase, 'decision-status', retentionStillOpen ? 'warn' : 'pass', retentionStillOpen
      ? 'The retention uncertainty is still open after the confirmation message.'
      : 'The retention uncertainty is resolved or no longer represented as an open question.');
    const staleRetentionAction = project.nodes.some((node) =>
      node.status === 'OPEN'
      && node.type === 'NEXT_ACTION'
      && (matchesConcept(node.text, ['retention questionnaire']) || matchesConcept(node.text, ['delete within 30 days']))
    );
    check(checks, 'late-no-stale-retention-action', phase, 'focus', staleRetentionAction ? 'warn' : 'pass', staleRetentionAction
      ? 'A retention-confirmation action is still open after the confirmation message.'
      : 'No stale retention-confirmation action remains open after the confirmation message.');
  }
}

export function evaluateHarborSemanticChecks(project: Project, phase: HarborSemanticPhase): EvaluationCheck[] {
  const checks: EvaluationCheck[] = [];
  semanticStageChecks(project, phase, checks);
  return checks;
}

function citedSources(sources: AskSource[]): HarborAskEvaluationTurn['citedSources'] {
  return sources.map((source) => ({ id: source.id, title: source.title, ...(source.url ? { url: source.url } : {}) }));
}

function selectedNodeSnapshots(project: Project, ids: string[]): HarborNodeSnapshot[] {
  return ids.map((id) => snapshotNode(project.nodes.find((node) => node.id === id))).filter((node): node is HarborNodeSnapshot => Boolean(node));
}

function focusContextFromEvaluation(evaluation: HarborFocusEvaluation): HarborFocusContext {
  return {
    title: evaluation.assessment?.title,
    targetNodeId: evaluation.targetNode?.id,
    targetText: evaluation.targetNode?.text,
    executionNodeId: evaluation.executionNode?.id,
    executionText: evaluation.executionNode?.text,
  };
}

export function questionRepresentsNode(question: TodayQuestion, nodeId: string): boolean {
  return question.sourceNodeIds.includes(nodeId);
}

export function duplicatedRepresentedNodeIds(
  visibleQuestions: TodayQuestion[],
  visibleDecisions: Array<{ id: string; text: string }>,
  representedNodeIds: Iterable<string>,
): string[] {
  const represented = new Set(representedNodeIds);
  return Array.from(represented).filter((nodeId) =>
    visibleQuestions.some((question) => questionRepresentsNode(question, nodeId))
      || visibleDecisions.some((decision) => decision.id === nodeId)
  );
}

export function harborAskRouteCheckStatus(
  scenario: Pick<HarborAskScenario, 'expectedRoute'>,
  actualRoute: string | undefined,
): EvaluationCheckStatus {
  if (actualRoute === scenario.expectedRoute) return 'pass';
  return scenario.expectedRoute === 'graph_reasoning' ? 'fail' : 'warn';
}

function askTurnChecks(
  project: Project,
  result: AskResult,
  scenario: HarborAskScenario,
  checks: EvaluationCheck[],
  focusContext?: HarborFocusContext,
): EvaluationCheck[] {
  const local: EvaluationCheck[] = [];
  const graph = result.graphReasoning;
  const phase = scenario.phase;
  const actualRoute = result.execution?.route;
  const expectedGraph = scenario.expectedRoute === 'graph_reasoning';
  const actualGraph = actualRoute === 'graph_reasoning';
  const graphPresent = Boolean(graph && (
    graph.selectedNodeIds.length > 0
      || graph.selectedEdges.length > 0
      || (graph.paths?.length ?? 0) > 0
  ));
  const projectNodeIds = new Set(project.nodes.map((node) => node.id));
  const projectEdges = new Map(project.edges.map((edge) => [edge.id, edge]));
  const invalidGraphNode = (graph?.selectedNodeIds ?? []).find((id) => !projectNodeIds.has(id));
  const invalidGraphEdge = (graph?.selectedEdges ?? []).find((edge) =>
    !projectEdges.has(edge.id)
    || !projectNodeIds.has(edge.source)
    || !projectNodeIds.has(edge.target)
  );
  const invalidPath = (graph?.paths ?? []).find((path) =>
    path.nodeIds.some((id) => !projectNodeIds.has(id))
    || path.edgeIds.some((id) => !projectEdges.has(id))
  );
  local.push(check(checks, `${scenario.id}-answer`, phase, 'answer', result.answer.trim() ? 'pass' : 'fail', result.answer.trim() ? 'Ask returned an answer.' : 'Ask returned an empty answer.'));
  local.push(check(checks, `${scenario.id}-route`, phase, 'routing', harborAskRouteCheckStatus(scenario, actualRoute), actualRoute === scenario.expectedRoute
    ? `Ask selected the expected ${scenario.expectedRoute} route.`
    : expectedGraph
      ? `Expected graph_reasoning, but Ask selected ${actualRoute ?? 'no route'}.`
      : `Expected internal_context for a factual query, but Ask selected ${actualRoute ?? 'no route'}.`));
  if (expectedGraph) {
    local.push(check(checks, `${scenario.id}-graph`, phase, 'retrieval', actualGraph && graphPresent ? 'pass' : 'fail', actualGraph && graphPresent
      ? `GraphRAG selected ${graph?.selectedNodeIds.length ?? 0} nodes and ${graph?.selectedEdges.length ?? 0} edges.`
      : 'The scenario required graph reasoning but no structured graph context was returned.'));
    if (scenario.expectedReasoningMode) {
      local.push(check(checks, `${scenario.id}-reasoning-mode`, phase, 'retrieval', graph?.reasoningMode === scenario.expectedReasoningMode ? 'pass' : 'warn', graph?.reasoningMode === scenario.expectedReasoningMode
        ? `GraphRAG used ${scenario.expectedReasoningMode} reasoning.`
        : `Expected ${scenario.expectedReasoningMode} reasoning, got ${graph?.reasoningMode ?? 'none'}.`));
    }
  } else {
    local.push(check(checks, `${scenario.id}-lightweight`, phase, 'retrieval', actualGraph ? 'warn' : 'pass', actualGraph
      ? 'A factual scenario used graph reasoning unnecessarily.'
      : 'Factual query used lightweight project retrieval without forced graph expansion.'));
  }
  local.push(check(checks, `${scenario.id}-ids`, phase, 'retrieval', invalidGraphNode || invalidGraphEdge || invalidPath ? 'fail' : 'pass', invalidGraphNode
    ? `GraphRAG returned a nonexistent node ID: ${invalidGraphNode}.`
    : invalidGraphEdge
      ? `GraphRAG returned a nonexistent or invalid edge: ${invalidGraphEdge.id}.`
      : invalidPath
        ? 'GraphRAG returned a path containing a nonexistent node or edge.'
        : 'All retrieved graph IDs and paths resolve against the persisted project.'));
  const invalidProjectSource = result.sources.find((source) => source.kind === 'source' && !project.sources.some((candidate) => candidate.id === source.id));
  const invalidRetrievedEvidence = (result.retrievedEvidence ?? []).find((item) => !project.sources.some((source) => source.id === item.sourceId));
  local.push(check(checks, `${scenario.id}-evidence`, phase, 'grounding', expectedGraph && !(result.retrievedEvidence?.length) ? 'warn' : invalidRetrievedEvidence ? 'fail' : 'pass', invalidRetrievedEvidence
    ? `Ask recorded evidence outside the current project: ${invalidRetrievedEvidence.sourceId}.`
    : result.retrievedEvidence?.length
      ? `Ask recorded ${result.retrievedEvidence.length} retrieved project evidence item(s).`
      : 'No project evidence was recorded for this turn.'));
  local.push(check(checks, `${scenario.id}-scope`, phase, 'persistence', invalidProjectSource ? 'fail' : 'pass', invalidProjectSource
    ? `Ask cited a source outside the current project: ${invalidProjectSource.id}.`
    : 'Ask source citations are scoped to the current persisted project.'));
  local.push(check(checks, `${scenario.id}-sources`, phase, 'grounding', result.sources.length ? 'pass' : 'warn', result.sources.length
    ? `Ask returned ${result.sources.length} supporting source(s).`
    : 'Ask returned no supporting source records.'));
  if (focusContext) {
    const targetSupplied = Boolean(focusContext.targetNodeId && result.promptUsed?.includes(focusContext.targetNodeId));
    const executionSupplied = !focusContext.executionNodeId || Boolean(result.promptUsed?.includes(focusContext.executionNodeId));
    local.push(check(checks, `${scenario.id}-focus-agreement`, phase, 'focus', targetSupplied && executionSupplied ? 'pass' : 'fail', targetSupplied && executionSupplied
      ? 'The supplied Focus Assessment target and execution context were visible to the Partner Agent.'
      : 'The supplied Focus Assessment context was not fully visible in the Partner Agent prompt.'));
  }
  return local;
}

async function runAsk(
  state: JourneyState,
  userId: string,
  scenario: HarborAskScenario,
  focusContext?: HarborFocusContext,
): Promise<{ result: AskResult; turn: HarborAskEvaluationTurn; project: Project }> {
  const storage = getStorageProvider();
  const now = new Date().toISOString();
  const userMessageId = `harbor_${state.askTurns.length + 1}_${Date.now()}`;
  await storage.saveAskChat(userId, { ...state.chat, updatedAt: now });
  await storage.saveAskMessage(userId, {
    id: userMessageId,
    chatId: state.chat.id,
    userId,
    projectId: state.project.id,
    role: 'user',
    text: scenario.query,
    sources: [],
    createdAt: now,
  });
  let context: Awaited<ReturnType<typeof persistAskConversationContext>>;
  try {
    context = await persistAskConversationContext({
      userId,
      chatId: state.chat.id,
      messageId: userMessageId,
      text: scenario.query,
      projectId: state.project.id,
      captureProcessingLog: true,
    });
  } catch (error) {
    throw new Error(`ask-context-agent: ${error instanceof Error ? error.message : 'Ask message ingestion failed.'}`);
  }
  state.project = await reloadProject(userId, state.project.id);
  snapshotProject(state, `ask-user-message-${state.askTurns.length + 1}`, state.project, {
    sourceId: context.sourceId,
    processingStatus: state.project.sources.find((source) => source.id === context.sourceId)?.processing_status,
    derivedNodeIds: state.project.sources.find((source) => source.id === context.sourceId)?.derived_node_ids,
    saveCompleted: true,
  });
  let result: AskResult;
  try {
    result = await askGapswise({
      userId,
      message: scenario.query,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      projectId: state.project.id,
      chatId: state.chat.id,
      excludeMessageId: userMessageId,
      excludeSourceId: context.sourceId,
      openQuestions: context.openQuestions,
      structuredResponse: true,
    });
  } catch (error) {
    throw new Error(`ask: ${error instanceof Error ? error.message : 'Ask agent failed.'}`);
  }
  if (result.sessionId) state.sessionId = result.sessionId;
  const assistantMessageId = result.assistantMessageId ?? boundedId('harbor_assistant', userMessageId);
  const proposals = normalizeAskContextProposals(result.contextProposals ?? result.proposals).map((proposal) => ({
    ...proposal,
    id: proposal.id ?? boundedId('proposal', `${assistantMessageId}_${proposal.type}_${proposal.text}`),
    sourceMessageId: proposal.sourceMessageId ?? assistantMessageId,
  }));
  await storage.saveAskMessage(userId, {
    id: assistantMessageId,
    chatId: state.chat.id,
    userId,
    projectId: state.project.id,
    role: 'assistant',
    text: result.answer,
    sources: result.sources,
    createdAt: new Date().toISOString(),
    ...(result.outcome ? { outcome: result.outcome } : {}),
    ...(result.resolvesQuestionId ? { resolvesQuestionId: result.resolvesQuestionId } : {}),
    ...(result.conclusion ? { conclusion: result.conclusion } : {}),
    ...(proposals.length ? { contextProposals: proposals, proposals } : {}),
    ...(result.openQuestionIds ? { openQuestionIds: result.openQuestionIds } : {}),
    ...(result.openQuestions ? { openQuestions: result.openQuestions } : {}),
    ...(result.execution ? { execution: result.execution } : {}),
  });
  state.chat = { ...state.chat, adkSessionId: state.sessionId, updatedAt: new Date().toISOString() };
  await storage.saveAskChat(userId, state.chat);
  const graph = result.graphReasoning;
  const retrievalIds = graph?.selectedNodeIds ?? [];
  const turn: HarborAskEvaluationTurn = {
    id: assistantMessageId,
    scenarioId: scenario.id,
    phase: scenario.phase,
    query: scenario.query,
    expectedRoute: scenario.expectedRoute,
    ...(scenario.expectedReasoningMode ? { expectedReasoningMode: scenario.expectedReasoningMode } : {}),
    selectedRoute: result.execution?.route,
    reasoningMode: graph?.reasoningMode,
    seedNodeIds: graph?.startingNodeIds ?? [],
    expandedNodeIds: retrievalIds.filter((id) => !(graph?.startingNodeIds ?? []).includes(id)),
    relationshipIds: graph?.selectedEdges.map((edge) => edge.id) ?? [],
    sourceIds: result.sources.map((source) => source.id),
    paths: graph?.paths ?? [],
    retrievedEvidence: result.retrievedEvidence ?? graph?.retrievedEvidence ?? [],
    selectedNodes: selectedNodeSnapshots(state.project, retrievalIds),
    citedSources: citedSources(result.sources),
    answer: result.answer,
    execution: result.execution,
    outcome: result.outcome,
    proposals,
    ...(focusContext ? { focusContext } : {}),
    checks: askTurnChecks(state.project, result, scenario, state.checks, focusContext),
  };
  state.askTurns.push(turn);
  return { result, turn, project: state.project };
}

async function ingestHarborSource(state: JourneyState, userId: string, source: typeof HARBOR_HOTELS_SOURCES[number]): Promise<void> {
  let processed: Awaited<ReturnType<typeof processContextSource>>;
  try {
    processed = await processContextSource(state.project, {
      sourceId: source.id,
      filename: source.filename,
      content: source.content,
      type: 'note',
      origin: 'user',
    }, DEFAULT_USER_PROFILE, { captureProcessingLog: true });
  } catch (error) {
    throw new Error(`context-agent: ${error instanceof Error ? error.message : `source ${source.id} failed.`}`);
  }
  if (processed.error) throw new Error(`context-agent: ${processed.error}`);
  if (processed.skipped) throw new Error(`context-agent: source ${source.id} was unexpectedly skipped.`);
  state.project = await saveAndReload(state, userId, processed.project, `ingest-${source.id}`, {
    sourceId: source.id,
    processingStatus: processed.project.sources.find((candidate) => candidate.id === source.id)?.processing_status,
    derivedNodeIds: processed.project.sources.find((candidate) => candidate.id === source.id)?.derived_node_ids,
  });
  let runtime: Awaited<ReturnType<typeof refreshProjectGapRuntime>>;
  try {
    runtime = await refreshProjectGapRuntime({
      userId,
      project: state.project,
      profile: DEFAULT_USER_PROFILE,
      route: 'eval:harbor-graphrag',
      label: `Harbor Gap Agent after ${source.id}`,
    });
  } catch (error) {
    throw new Error(`gap-agent: ${error instanceof Error ? error.message : `source ${source.id} failed.`}`);
  }
  if (!runtime.runtime || runtime.runtime.mode !== 'live') throw new Error(`gap-agent: expected live runtime after ${source.id}.`);
  if (runtime.runtime.fallbackUsed) throw new Error(`gap-agent: live runtime fell back after ${source.id}.`);
  state.project = await saveAndReload(state, userId, runtime.project, `gap-runtime-${source.id}`);
}

async function evaluateFocusAndToday(state: JourneyState, userId: string, phase: HarborFocusEvaluation['phase']): Promise<HarborFocusEvaluation> {
  const memories = await loadDurableMemories(userId, DEFAULT_USER_PROFILE);
  const contextPack = await buildContextPackForUser({
    userId,
    query: 'What needs my attention today?',
    project: state.project,
    profile: DEFAULT_USER_PROFILE,
    durableMemories: memories,
    includeBroadContext: true,
    scope: { type: 'project', projectId: state.project.id },
    reasoningMode: 'focus',
  });
  let assessment: FocusAssessment | null;
  try {
    assessment = await getCachedFocusAssessment(userId, state.project, contextPack, DEFAULT_USER_PROFILE);
  } catch (error) {
    throw new Error(`focus: ${error instanceof Error ? error.message : 'Focus Assessment failed.'}`);
  }
  const targetNode = findNodeById(state.project, assessment?.targetNodeId ?? assessment?.actionNodeId);
  const executionNode = findNodeById(state.project, assessment?.executionNodeId);
  const brief: DailyBrief = generateDailyBrief({
    userId,
    project: state.project,
    memories,
    period: new Date().toISOString().slice(0, 10),
    contextPack,
    force: false,
  });
  const targetId = targetNode?.id;
  const represented = new Set([
    ...(assessment?.representedNodeIds ?? []),
    ...(targetId ? [targetId] : []),
    ...(executionNode?.id ? [executionNode.id] : []),
  ]);
  const visibleQuestions = buildTodayQuestions({
    project: state.project,
    brief,
    excludedQuestionNodeIds: Array.from(represented).filter((nodeId) => {
      const node = findNodeById(state.project, nodeId);
      return node?.type === 'UNKNOWN' || node?.type === 'ASSUMPTION';
    }),
  }).filter((question) => question.sourceNodeIds.some((nodeId) => {
    const node = findNodeById(state.project, nodeId);
    return Boolean(node && ['UNKNOWN', 'ASSUMPTION'].includes(node.type) && node.status === 'OPEN');
  }));
  const visibleDecisions = openTodayDecisions(state.project)
    .filter((node) => !represented.has(node.id))
    .map((node) => ({ id: node.id, text: node.text }));
  const duplicatedIds = duplicatedRepresentedNodeIds(visibleQuestions, visibleDecisions, represented);
  const primaryAction = targetNode?.type === 'DECISION'
    ? 'decide'
    : targetNode?.type === 'UNKNOWN' || targetNode?.type === 'ASSUMPTION'
      ? 'resolve'
      : targetNode?.type === 'NEXT_ACTION' ? 'complete' : null;
  const localChecks: EvaluationCheck[] = [];
  localChecks.push(check(state.checks, `${phase}-focus-assessment`, phase, 'focus', assessment ? 'pass' : 'fail', assessment ? 'Focus Assessment returned.' : 'Focus Assessment returned no result.'));
  localChecks.push(check(state.checks, `${phase}-focus-target`, phase, 'focus', targetNode && targetNode.status === 'OPEN' && ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'NEXT_ACTION'].includes(targetNode.type) ? 'pass' : 'fail', targetNode
    ? `Focus targets ${targetNode.type} ${targetNode.id}.`
    : 'Focus has no open actionable target.'));
  if (assessment?.executionNodeId) {
    localChecks.push(check(state.checks, `${phase}-focus-execution`, phase, 'focus', executionNode ? 'pass' : 'fail', executionNode
      ? 'Focus execution node exists in the persisted project.'
      : 'Focus references a missing execution node.'));
  }
  if (targetNode && executionNode) {
    const linked = state.project.edges.some((edge) =>
      (edge.source === executionNode.id && edge.target === targetNode.id && ['satisfies', 'informs', 'resolves', 'affects', 'depends_on', 'blocks'].includes(edge.type))
      || (edge.source === targetNode.id && edge.target === executionNode.id && ['depends_on', 'blocks', 'affects'].includes(edge.type))
    );
    localChecks.push(check(state.checks, `${phase}-focus-relationship`, phase, 'focus', linked ? 'pass' : 'warn', linked
      ? 'Focus target and execution are connected by a persisted relationship.'
      : 'Focus target and execution have no explicit valid persisted relationship.'));
  }
  localChecks.push(check(state.checks, `${phase}-focus-cta`, phase, 'today', primaryAction ? 'pass' : 'fail', primaryAction ? `Today exposes a ${primaryAction} workflow.` : 'Today has no usable CTA for the selected focus.'));
  localChecks.push(check(state.checks, `${phase}-focus-no-duplicate`, phase, 'today', duplicatedIds.length === 0 ? 'pass' : 'fail', duplicatedIds.length === 0
    ? 'Focus target and execution nodes are omitted from Today secondary lists.'
    : `Represented focus node(s) remain in Today secondary lists: ${duplicatedIds.join(', ')}.`));
  const evaluation: HarborFocusEvaluation = {
    phase,
    assessment,
    targetNode: snapshotNode(targetNode),
    executionNode: snapshotNode(executionNode),
    representedNodes: selectedNodeSnapshots(state.project, Array.from(represented)),
    today: {
      recommendedFocusTitle: assessment?.title,
      primaryAction,
      visibleOpenQuestions: visibleQuestions.map((question) => ({
        id: question.id,
        text: question.question,
        sourceNodeIds: question.sourceNodeIds,
      })),
      visibleDecisions,
      duplicatedRepresentedNodeIds: duplicatedIds,
    },
    checks: localChecks,
  };
  state.focusEvaluations.push(evaluation);
  return evaluation;
}

function projectSummary(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    title: project.title,
    goal: project.goal,
    deadline: project.deadline,
    nodes: project.nodes.map(({ id, type, status, text, confidence, impact, decision_outcome }) => ({ id, type, status, text, confidence, impact, decision_outcome })),
    edges: project.edges.map(({ id, source, target, type, confidence }) => ({ id, source, target, type, confidence })),
    sources: project.sources.map(({ id, filename, processing_status, derived_node_ids, extraction_summary }) => ({ id, filename, processing_status, derived_node_ids, extraction_summary })),
    history: project.history.map(({ question, answer, graph_diff_summary }) => ({ question, answer, graph_diff_summary })),
  };
}

function boundedText(value: string, maxLength = 520): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

export function buildHarborEvaluatorInput(report: Pick<HarborGraphRagEvaluationReport, 'timeline' | 'askTurns' | 'focusEvaluations' | 'deterministicChecks'>, project: Project): string {
  return JSON.stringify({
    project: projectSummary(project),
    timeline: report.timeline,
    askTurns: report.askTurns.map((turn) => ({
      scenarioId: turn.scenarioId,
      phase: turn.phase,
      query: turn.query,
      expectedRoute: turn.expectedRoute,
      expectedReasoningMode: turn.expectedReasoningMode,
      selectedRoute: turn.selectedRoute,
      reasoningMode: turn.reasoningMode,
      seedNodeIds: turn.seedNodeIds,
      expandedNodeIds: turn.expandedNodeIds,
      relationshipIds: turn.relationshipIds,
      paths: turn.paths,
      retrievedEvidence: turn.retrievedEvidence.slice(0, 8).map((evidence) => ({
        sourceId: evidence.sourceId,
        title: evidence.title,
        excerpt: boundedText(evidence.excerpt),
        score: evidence.score,
        supports: evidence.supports.slice(0, 4).map((support) => boundedText(support, 220)),
        selectionReason: evidence.selectionReason,
      })),
      selectedNodes: turn.selectedNodes,
      citedSources: turn.citedSources,
      answer: turn.answer,
      execution: turn.execution,
      outcome: turn.outcome,
      proposals: turn.proposals,
      focusContext: turn.focusContext,
      checks: turn.checks,
    })),
    focusEvaluations: report.focusEvaluations,
    deterministicChecks: report.deterministicChecks,
  });
}

export async function evaluateHarborGraphRagWithAi(input: {
  project: Project;
  timeline: HarborJourneySnapshot[];
  askTurns: HarborAskEvaluationTurn[];
  focusEvaluations: HarborFocusEvaluation[];
  deterministicChecks: EvaluationCheck[];
}): Promise<HarborAiEvaluation> {
  const model = getAgentModelConfig('partner');
  const response = await getVertexGenAIClient().models.generateContent({
    model: model.model,
    contents: [{ role: 'user', parts: [{ text: [
      'You are a separate quality evaluator for a real AI GraphRAG journey.',
      'Judge only the supplied persisted project state, retrieval records, source records, answers, and deterministic checks.',
      'Do not invent missing evidence. Penalize open decisions described as resolved, unsupported claims, missing relationship chains, weak source grounding, disagreement between Ask and Today, and duplicate focus/question presentation.',
      'For each focus turn, judge whether the Ask answer preserves the supplied Focus Assessment primary recommendation and target. Do not require identical wording; require agreement with the supplied target and execution context.',
      'Retrieved evidence is the evidence actually supplied to Partner for that turn. Distinguish it from citedSources, which are only the sources displayed in the answer.',
      'Harmless wording differences are not failures. Do not modify or save anything.',
      'Return normalized scores from 0 to 1 and concise evidence-backed findings.',
      buildHarborEvaluatorInput(input, input.project),
    ].join('\n\n') }] }],
    config: {
      temperature: 0,
      maxOutputTokens: Math.max(1536, model.maxOutputTokens),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: ['overallScore', 'dimensions', 'failures', 'strengths', 'summary'],
        properties: {
          overallScore: { type: Type.NUMBER },
          dimensions: {
            type: Type.OBJECT,
            required: ['extractionQuality', 'graphCoherence', 'retrievalQuality', 'sourceGrounding', 'decisionStatusAccuracy', 'focusConsistency', 'answerUsefulness'],
            properties: {
              extractionQuality: { type: Type.NUMBER },
              graphCoherence: { type: Type.NUMBER },
              retrievalQuality: { type: Type.NUMBER },
              sourceGrounding: { type: Type.NUMBER },
              decisionStatusAccuracy: { type: Type.NUMBER },
              focusConsistency: { type: Type.NUMBER },
              answerUsefulness: { type: Type.NUMBER },
            },
          },
          failures: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['severity', 'area', 'evidence', 'recommendation'],
              properties: {
                severity: { type: Type.STRING, enum: ['critical', 'major', 'minor'] },
                area: { type: Type.STRING },
                evidence: { type: Type.STRING },
                recommendation: { type: Type.STRING },
              },
            },
          },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
        },
      },
    },
  });
  const parsed = JSON.parse(response.text?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '') || '{}');
  return aiEvaluationSchema.parse(parsed);
}

function pipelineStatus(
  used: boolean,
  checks: EvaluationCheck[],
): 'used' | 'passed' | 'failed' | 'not_run' {
  if (!used) return 'not_run';
  if (checks.some((item) => item.status === 'fail')) return 'failed';
  return checks.length > 0 ? 'passed' : 'used';
}

export function graphRagPipelineStatus(
  askTurns: HarborAskEvaluationTurn[],
  checks: EvaluationCheck[] = [],
): 'used' | 'passed' | 'failed' | 'not_run' {
  const used = askTurns.some((turn) =>
    turn.selectedRoute === 'graph_reasoning'
      || turn.seedNodeIds.length > 0
      || turn.expandedNodeIds.length > 0
      || turn.relationshipIds.length > 0
      || turn.paths.length > 0
  );
  const graphChecks = checks.filter((item) => item.area === 'retrieval' && (
    item.id.endsWith('-graph')
      || item.id.endsWith('-reasoning-mode')
      || item.id.endsWith('-ids')
  ));
  return pipelineStatus(used, graphChecks);
}

function makeBaseReport(options: HarborGraphRagJourneyOptions, startedAt: string, state: JourneyState, failureStage?: string, finalProject: Project | null = null): HarborGraphRagEvaluationReport {
  const completedAt = new Date().toISOString();
  const hasFail = state.checks.some((item) => item.status === 'fail');
  const hasWarn = state.checks.some((item) => item.status === 'warn');
  return {
    runId: options.runId,
    userId: options.userId,
    projectId: finalProject?.id ?? state.project?.id ?? null,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    status: hasFail || failureStage ? 'FAIL' : hasWarn ? 'WARN' : 'PASS',
    ...(failureStage ? { failureStage } : {}),
    models: Object.fromEntries(Object.entries(getAgentModelPolicy()).map(([role, config]) => [role, config.model])),
    pipeline: {
      'Context Agent': pipelineStatus(state.timeline.some((item) => item.sourceId), state.checks.filter((item) => item.area === 'extraction')),
      'Gap Agent': pipelineStatus(state.timeline.some((item) => item.label.startsWith('gap-runtime-')), []),
      GraphRAG: graphRagPipelineStatus(state.askTurns, state.checks),
      'Ask Router': pipelineStatus(state.askTurns.some((turn) => Boolean(turn.selectedRoute)), state.checks.filter((item) => item.area === 'routing')),
      'Partner Agent': pipelineStatus(state.askTurns.some((turn) => turn.execution?.agent === 'Partner Agent'), state.checks.filter((item) => item.area === 'answer')),
      'Focus Assessment': pipelineStatus(state.focusEvaluations.some((item) => Boolean(item.assessment)), state.checks.filter((item) => item.area === 'focus')),
      'Today projection': pipelineStatus(state.focusEvaluations.some((item) => Boolean(item.today)), state.checks.filter((item) => item.area === 'today')),
      'Final reload': finalProject ? 'passed' : failureStage ? 'failed' : 'not_run',
    },
    timeline: state.timeline,
    askTurns: state.askTurns,
    focusEvaluations: state.focusEvaluations,
    deterministicChecks: state.checks,
    aiEvaluation: null,
    finalProject,
  };
}

export async function runHarborGraphRagJourney(options: HarborGraphRagJourneyOptions): Promise<HarborGraphRagEvaluationReport> {
  assertHarborLiveEvaluation(options);
  const startedAt = new Date().toISOString();
  const storage = getStorageProvider();
  await storage.resetUserData(options.userId);
  clearTracesForUser(options.userId);
  const created = createProjectFromInput(harborHotelsProjectInput(), new Date().toISOString());
  await saveProject(options.userId, created);
  await setAppScope(options.userId, { type: 'project', projectId: created.id });
  const initial = await reloadProject(options.userId, created.id);
  const state: JourneyState = {
    project: initial,
    timeline: [],
    askTurns: [],
    focusEvaluations: [],
    checks: [],
    step: 0,
    chat: {
      id: `harbor-graphrag-${options.runId}`,
      userId: options.userId,
      scopeType: 'project',
      projectId: created.id,
      title: 'Harbor Hotels GraphRAG evaluation',
      createdAt: startedAt,
      updatedAt: startedAt,
    },
  };
  snapshotProject(state, 'project-created-and-reloaded', initial);
  try {
    await ingestHarborSource(state, options.userId, HARBOR_HOTELS_SOURCES[0]);
    semanticStageChecks(state.project, 'pilot_brief', state.checks);
    await runAsk(state, options.userId, harborAskScenario('pilot-budget'));
    await ingestHarborSource(state, options.userId, HARBOR_HOTELS_SOURCES[1]);
    await ingestHarborSource(state, options.userId, HARBOR_HOTELS_SOURCES[2]);
    semanticStageChecks(state.project, 'technical_scope', state.checks);
    await runAsk(state, options.userId, harborAskScenario('scope-reasoning'));
    const openScopeBefore = matchingNodes(state.project, ['technical scope', 'integration'], ['DECISION', 'UNKNOWN']).some((node) => node.status === 'OPEN');
    check(state.checks, 'early-decision-remains-open', 'early', 'decision-status', openScopeBefore ? 'pass' : 'warn', openScopeBefore
      ? 'The technical-scope choice remained open before the user recorded a decision.'
      : 'No open technical-scope decision was found before the decision message.');
    await ingestHarborSource(state, options.userId, HARBOR_HOTELS_SOURCES[3]);
    const scopeAfterDecision = matchingNodes(state.project, ['technical scope', 'integration', 'nightly CSV'], ['DECISION', 'PREFERENCE', 'KNOWN']).find((node) => node.type === 'DECISION');
    check(state.checks, 'early-decision-recorded', 'early', 'decision-status', scopeAfterDecision?.status === 'RESOLVED' ? 'pass' : 'warn', scopeAfterDecision
      ? `Technical-scope decision is ${scopeAfterDecision.status}.`
      : 'No canonical technical-scope decision was found after the decision message.');
    const afterDecision = await runAsk(state, options.userId, harborAskScenario('scope-reasoning-after'));
    check(state.checks, 'early-post-decision-answer', 'early', 'answer', afterDecision.result.answer.trim() ? 'pass' : 'fail', 'Post-decision reasoning returned an answer.');
    await ingestHarborSource(state, options.userId, HARBOR_HOTELS_SOURCES[4]);
    semanticStageChecks(state.project, 'middle', state.checks);
    const retention = await runAsk(state, options.userId, harborAskScenario('retention-impact'));
    if (retention.turn.proposals.length > 0) {
      const proposal = retention.turn.proposals[0];
      state.project = await persistAskProposal({ userId: options.userId, projectId: state.project.id, assistantMessageId: retention.turn.id, proposal: { ...proposal, confirmationStatus: 'added' } });
      state.project = await saveAndReload(state, options.userId, state.project, 'ask-proposal-accepted');
      const runtime = await refreshProjectGapRuntime({ userId: options.userId, project: state.project, profile: DEFAULT_USER_PROFILE, route: 'eval:harbor-graphrag', label: 'Harbor Gap Agent after accepted Ask proposal' });
      if (!runtime.runtime || runtime.runtime.mode !== 'live' || runtime.runtime.fallbackUsed) throw new Error('gap-agent: failed after accepted Ask proposal.');
      state.project = await saveAndReload(state, options.userId, runtime.project, 'gap-runtime-after-ask-proposal');
    }
    const middleFocus = await evaluateFocusAndToday(state, options.userId, 'middle');
    await runAsk(state, options.userId, harborAskScenario('middle-focus'), focusContextFromEvaluation(middleFocus));
    await ingestHarborSource(state, options.userId, HARBOR_HOTELS_SOURCES[5]);
    await ingestHarborSource(state, options.userId, HARBOR_HOTELS_SOURCES[6]);
    await ingestHarborSource(state, options.userId, HARBOR_HOTELS_SOURCES[7]);
    semanticStageChecks(state.project, 'late', state.checks);
    const late = await runAsk(state, options.userId, harborAskScenario('weekend-support-tradeoff'));
    check(state.checks, 'late-tradeoff-retrieval', 'late', 'retrieval', late.turn.selectedNodes.some((node) => matchesConcept(node.text, ['support hours', 'gross margin', 'weekend support'])) ? 'pass' : 'warn', 'Late tradeoff retrieval includes at least one relevant support, margin, or weekend-support concept.');
    const lateFocus = await evaluateFocusAndToday(state, options.userId, 'late');
    await runAsk(state, options.userId, harborAskScenario('late-focus'), focusContextFromEvaluation(lateFocus));
    state.project = await reloadProject(options.userId, state.project.id);
    snapshotProject(state, 'final-database-reload', state.project);
    const finalProject = state.project;
    semanticStageChecks(finalProject, 'late', state.checks);
    check(state.checks, 'final-sources-persisted', 'final', 'persistence', finalProject.sources.length >= HARBOR_HOTELS_SOURCES.length ? 'pass' : 'fail', `Final reload contains ${finalProject.sources.length} source(s).`);
    const report = makeBaseReport(options, startedAt, state, undefined, finalProject);
    try {
      report.aiEvaluation = await evaluateHarborGraphRagWithAi({
        project: finalProject,
        timeline: report.timeline,
        askTurns: report.askTurns,
        focusEvaluations: report.focusEvaluations,
        deterministicChecks: report.deterministicChecks,
      });
      if (report.aiEvaluation.failures.length > 0 && report.status === 'PASS') report.status = 'WARN';
    } catch (error) {
      check(state.checks, 'ai-evaluator', 'final', 'evaluation', 'fail', error instanceof Error ? error.message : 'AI evaluator failed.');
      report.deterministicChecks = state.checks;
      report.status = 'FAIL';
      report.failureStage = 'ai-evaluator';
    }
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Harbor journey failed.';
    const stage = message.includes(':') ? message.slice(0, message.indexOf(':')) : 'journey';
    check(state.checks, `journey-failure-${state.step}`, stage, 'pipeline', 'fail', message);
    return makeBaseReport(options, startedAt, state, stage, state.project ?? null);
  }
}
