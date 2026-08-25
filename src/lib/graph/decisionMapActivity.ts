import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import type { Project } from '@/types/clarity';
import type { DecisionMapDebugTrace } from '@/lib/graph/decisionMapDebug';
import type { TraceEvent } from '@/types/observability';

export type DecisionMapActivityType = 'map_built' | 'map_updated' | 'map_debug';

export interface DecisionMapActivitySummary {
  type: DecisionMapActivityType;
  title: string;
  trigger?: string;
  change?: string;
  focus?: string;
  visibleNodes?: number;
  relationships?: number;
  warningCount?: number;
}

export interface PersistedDecisionMapActivity {
  projectId: string;
  type: DecisionMapActivityType;
  fingerprint: string;
  trigger?: string;
  change?: string;
  focus?: string;
  warningCodes: string[];
}

function normalizedWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))].sort();
}

/** Fingerprint semantic project state, never renderer geometry or UI state. */
export function buildDecisionMapActivityFingerprint(
  project: Project,
  focusAssessment: FocusAssessment | null | undefined,
  warnings: string[] = [],
): string {
  return JSON.stringify({
    projectId: project.id,
    nodes: [...project.nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => [node.id, node.type, node.status, node.text, node.updated_at ?? null]),
    edges: [...project.edges]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => [edge.source, edge.type, edge.target]),
    focusActionNodeId: focusAssessment?.actionNodeId ?? null,
    warningCodes: normalizedWarnings(warnings),
  });
}

export function buildDecisionMapActivityFingerprintFromDebug(
  debug: DecisionMapDebugTrace,
  warnings: string[] = [],
): string {
  return JSON.stringify({
    projectId: debug.projectId,
    nodes: [...debug.rawProjectGraph.nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => [node.id, node.type, node.status, node.text, node.updatedAt]),
    edges: [...debug.rawProjectGraph.edges]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((edge) => [edge.id, edge.source.id, edge.relationship, edge.target.id]),
    focusActionNodeId: debug.rawProjectGraph.focusAssessment?.actionNodeId ?? null,
    warningCodes: normalizedWarnings(warnings),
  });
}

/** Layout warnings remain renderer details; only stable graph warnings become events. */
export function decisionMapWarningCodes(debug: DecisionMapDebugTrace): string[] {
  const warnings: string[] = [];
  if (debug.rawProjectGraph.topology?.connectedComponents.length > 1) warnings.push('DISCONNECTED_COMPONENT');
  if (debug.rawProjectGraph.topology?.nodesWithoutGoalPath.length > 0) warnings.push('NO_GOAL_PATH');
  if ((debug.renderedMapReadabilitySummary?.visibleNodes ?? 0) > debug.rawProjectGraph.totalNodes) warnings.push('PROJECTION_INVALID');
  return normalizedWarnings(warnings);
}

function activityTitle(type: DecisionMapActivityType): string {
  if (type === 'map_built') return 'Map built';
  if (type === 'map_debug') return 'Map diagnostic';
  return 'Map updated';
}

/** Converts persisted metadata into the short card shown in the normal feed. */
export function summarizeDecisionMapActivity(trace: TraceEvent): DecisionMapActivitySummary | null {
  const activity = trace.decisionMapActivity;
  const debug = trace.decisionMapDebug;
  if (!activity || !debug) return null;
  const visibleNodes = debug.renderedMapReadabilitySummary?.visibleNodes ?? 0;
  return {
    type: activity.type,
    title: activityTitle(activity.type),
    trigger: activity.trigger,
    change: activity.change,
    focus: activity.focus,
    visibleNodes,
    relationships: debug.rawProjectGraph.totalEdges,
    warningCount: activity.warningCodes.length,
  };
}

export function nodeTextFromDebug(debug: DecisionMapDebugTrace | undefined, nodeId: string | null | undefined): string | undefined {
  if (!debug || !nodeId) return undefined;
  return debug.rawProjectGraph.nodes.find((node) => node.id === nodeId)?.text;
}
