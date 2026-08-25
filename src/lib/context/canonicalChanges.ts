import { confirmDecision } from '@/lib/decisions/workspace';
import { resolveGap } from '@/lib/tools/graphTools';
import {
  ClarityNode,
  CanonicalChange,
  Project,
  ProjectPatch,
  ProjectPatchOperation,
  ProjectPatchContextNodeType,
  UserMemoryProfile,
} from '@/types/clarity';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

const CONTEXT_NODE_TYPES = new Set<ProjectPatchContextNodeType>([
  'KNOWN',
  'EVIDENCE',
  'CONSTRAINT',
  'PREFERENCE',
  'RISK',
  'ASSUMPTION',
]);

export interface ProjectPatchRejection {
  operation: ProjectPatchOperation;
  reason: string;
}

export interface ProjectPatchExecutionResult {
  project: Project;
  validatedOperations: ProjectPatchOperation[];
  executedOperations: ProjectPatchOperation[];
  rejectedOperations: ProjectPatchRejection[];
  createdNodeIds: string[];
  updatedNodeIds: string[];
  operationNodeIds: Record<string, string>;
}

export interface ProjectPatchApplyOptions {
  /** Nodes created by an earlier analysis of the same source. */
  supersededNodeIds?: string[];
}

/** Backwards-compatible name for callers that still inspect change failures. */
export type CanonicalChangeRejection = ProjectPatchRejection;

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function activeNode(project: Project, id: string | undefined): ClarityNode | undefined {
  if (!id) return undefined;
  return project.nodes.find((node) => node.id === id && node.status !== 'DEPRECATED');
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function addSourceRef(node: ClarityNode | undefined, sourceId: string): void {
  if (!node || !sourceId) return;
  node.source_refs = Array.from(new Set([...node.source_refs, sourceId]));
}

function addSourceRefToNewNodes(
  beforeIds: Set<string>,
  project: Project,
  sourceId: string,
): string[] {
  const created = project.nodes.filter((node) => !beforeIds.has(node.id));
  created.forEach((node) => addSourceRef(node, sourceId));
  return created.map((node) => node.id);
}

function nodeStatus(type: ClarityNode['type']): ClarityNode['status'] {
  return ['UNKNOWN', 'ASSUMPTION', 'RISK', 'NEXT_ACTION', 'EXPERIMENT', 'GOAL'].includes(type)
    ? 'OPEN'
    : 'RESOLVED';
}

function nodeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function contextTypeCompatible(node: ClarityNode, nodeType: ProjectPatchContextNodeType): boolean {
  return node.type === nodeType
    || (CONTEXT_NODE_TYPES.has(node.type as ProjectPatchContextNodeType)
      && CONTEXT_NODE_TYPES.has(nodeType));
}

function findExactNode(
  project: Project,
  type: ClarityNode['type'],
  text: string,
): ClarityNode | undefined {
  const key = normalizedText(text);
  return project.nodes.find((node) =>
    node.status !== 'DEPRECATED'
    && node.type === type
    && normalizedText(node.text) === key
  );
}

function findExactContextNode(
  project: Project,
  nodeType: ProjectPatchContextNodeType,
  text: string,
): ClarityNode | undefined {
  const key = normalizedText(text);
  return project.nodes.find((node) =>
    node.status !== 'DEPRECATED'
    && CONTEXT_NODE_TYPES.has(node.type as ProjectPatchContextNodeType)
    && contextTypeCompatible(node, nodeType)
    && normalizedText(node.text) === key
  );
}

function updateNodeMetadata(
  node: ClarityNode,
  sourceId: string,
  confidence: number,
  impact?: number,
  now = new Date().toISOString(),
): void {
  addSourceRef(node, sourceId);
  node.confidence = Math.max(node.confidence, confidence);
  if (impact !== undefined) node.impact = Math.max(node.impact, impact);
  node.updated_at = now;
}

function deprecateSupersededNodes(
  project: Project,
  nodeIds: string[],
  sourceId: string,
  now: string,
  preservedNodeIds: Set<string>,
): void {
  const superseded = new Set(nodeIds);
  project.nodes
    .filter((node) => superseded.has(node.id))
    .forEach((node) => {
      if (preservedNodeIds.has(node.id)) return;
      const hasOtherActiveSource = node.source_refs.some((ref) =>
        ref !== sourceId
        && project.sources.some((source) => source.id === ref && !source.discarded_at),
      );
      if (hasOtherActiveSource) return;
      node.status = 'DEPRECATED';
      node.why_it_matters = Array.from(new Set([
        ...(node.why_it_matters ?? []),
        'Retained as historical context after this source was re-analyzed.',
      ]));
      node.updated_at = now;
    });
}

function annotateResolutionHistory(
  project: Project,
  nodeId: string,
  sourceId: string,
  sourceNodeIds: string[],
  originalText: string,
): void {
  const event = [...(project.historyEvents ?? [])]
    .reverse()
    .find((candidate) =>
      (candidate.type === 'decision_resolved' || candidate.type === 'gap_resolved')
      && candidate.primaryNodeId === nodeId
    );
  if (!event) return;
  event.sourceId = sourceId;
  event.sourceNodeIds = Array.from(new Set(sourceNodeIds));
  if (event.primarySnapshot) event.primarySnapshot.text = originalText;
  event.changes?.forEach((change) => {
    if (change.nodeId === nodeId && change.snapshot) change.snapshot.text = originalText;
  });
}

function createNode(
  project: Project,
  operation: Extract<ProjectPatchOperation, { op: 'ADD_CONTEXT' | 'OPEN_DECISION' | 'OPEN_UNKNOWN' | 'ADD_ACTION' }>,
  sourceId: string,
  now: string,
): ClarityNode {
  const type = operation.op === 'ADD_CONTEXT'
    ? operation.nodeType
    : operation.op === 'OPEN_DECISION'
      ? 'DECISION'
      : operation.op === 'OPEN_UNKNOWN'
        ? 'UNKNOWN'
        : 'NEXT_ACTION';
  const created: ClarityNode = {
    id: operation.nodeId ?? nodeId('node_patch'),
    type,
    text: operation.text,
    status: operation.op === 'OPEN_DECISION'
      || operation.op === 'OPEN_UNKNOWN'
      || operation.op === 'ADD_ACTION'
      ? 'OPEN'
      : nodeStatus(type),
    confidence: operation.confidence,
    impact: operation.impact,
    source_refs: [sourceId],
    created_by: 'agent',
    created_at: now,
    updated_at: now,
    x: 180 + Math.random() * 360,
    y: 220 + Math.random() * 280,
  };
  project.nodes.push(created);
  return created;
}

function attachExistingOperation(
  project: Project,
  operation: Extract<ProjectPatchOperation, { op: 'ADD_CONTEXT' | 'OPEN_DECISION' | 'OPEN_UNKNOWN' | 'ADD_ACTION' }>,
  sourceId: string,
  now: string,
): ClarityNode | undefined {
  const target = activeNode(project, operation.targetNodeId)
    ?? (operation.op === 'ADD_CONTEXT'
      ? findExactContextNode(project, operation.nodeType, operation.text)
      : operation.op === 'OPEN_DECISION'
        ? findExactNode(project, 'DECISION', operation.text)
        : operation.op === 'OPEN_UNKNOWN'
          ? project.nodes.find((node) =>
              node.status !== 'DEPRECATED'
              && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
              && normalizedText(node.text) === normalizedText(operation.text)
            )
          : findExactNode(project, 'NEXT_ACTION', operation.text));
  if (!target) return undefined;

  if (operation.op === 'ADD_CONTEXT' && !contextTypeCompatible(target, operation.nodeType)) return undefined;
  if (operation.op === 'OPEN_DECISION' && target.type !== 'DECISION') return undefined;
  if (operation.op === 'OPEN_UNKNOWN' && !['UNKNOWN', 'ASSUMPTION'].includes(target.type)) return undefined;
  if (operation.op === 'ADD_ACTION' && target.type !== 'NEXT_ACTION') return undefined;
  if (operation.op === 'OPEN_UNKNOWN' && target.status !== 'OPEN') return target;

  updateNodeMetadata(target, sourceId, operation.confidence, operation.impact, now);
  return target;
}

function reject(
  rejectedOperations: ProjectPatchRejection[],
  operation: ProjectPatchOperation,
  reason: string,
): void {
  rejectedOperations.push({ operation, reason });
}

/**
 * The one mutation executor for model-backed Context processing. It validates
 * operation shape and target identity, then delegates resolution mutations to
 * the established decision/question workflows.
 */
export function applyProjectPatch(
  project: Project,
  patch: ProjectPatch,
  sourceId: string,
  profile: UserMemoryProfile = DEFAULT_USER_PROFILE,
  options: ProjectPatchApplyOptions = {},
): ProjectPatchExecutionResult {
  let updated = cloneProject(project);
  const validatedOperations: ProjectPatchOperation[] = [];
  const executedOperations: ProjectPatchOperation[] = [];
  const rejectedOperations: ProjectPatchRejection[] = [];
  const createdNodeIds: string[] = [];
  const updatedNodeIds: string[] = [];
  const operationNodeIds: Record<string, string> = {};
  const now = new Date().toISOString();

  const preservedNodeIds = new Set(
    patch.operations
      .map((operation) => 'targetNodeId' in operation ? operation.targetNodeId : undefined)
      .filter((id): id is string => Boolean(id)),
  );
  deprecateSupersededNodes(
    updated,
    options.supersededNodeIds ?? [],
    sourceId,
    now,
    preservedNodeIds,
  );

  patch.operations.forEach((operation, index) => {
    const confidence = operation.confidence ?? 1;
    if (operation.op === 'NO_CHANGE') {
      validatedOperations.push(operation);
      executedOperations.push(operation);
      return;
    }

    try {
      if (operation.op === 'RESOLVE_DECISION') {
        const target = activeNode(updated, operation.targetNodeId);
        if (!target || target.type !== 'DECISION') {
          reject(rejectedOperations, operation, 'target_is_not_an_active_decision');
          return;
        }
        if (target.status !== 'OPEN') {
          reject(rejectedOperations, operation, 'target_is_not_open');
          return;
        }
        if (!operation.outcome.trim()) {
          reject(rejectedOperations, operation, 'empty_decision_outcome');
          return;
        }
        validatedOperations.push(operation);
        const originalText = target.text;
        const beforeIds = new Set(updated.nodes.map((node) => node.id));
        updated = confirmDecision(updated, {
          decisionNodeId: target.id,
          customDecision: operation.outcome,
        });
        const resolved = updated.nodes.find((node) => node.id === target.id);
        if (resolved) {
          resolved.text = originalText;
          resolved.decision_outcome = operation.outcome;
          updateNodeMetadata(resolved, sourceId, operation.confidence, undefined, now);
        }
        const newIds = addSourceRefToNewNodes(beforeIds, updated, sourceId);
        annotateResolutionHistory(updated, target.id, sourceId, [target.id, ...newIds], originalText);
        updatedNodeIds.push(target.id);
        newIds.forEach((id) => createdNodeIds.push(id));
        operationNodeIds[operation.operationRef ?? `op:${index}`] = target.id;
        operationNodeIds[`new:${index}`] = target.id;
        executedOperations.push(operation);
        return;
      }

      if (operation.op === 'RESOLVE_UNKNOWN') {
        const target = activeNode(updated, operation.targetNodeId);
        if (!target || !['UNKNOWN', 'ASSUMPTION'].includes(target.type)) {
          reject(rejectedOperations, operation, 'target_is_not_an_active_unknown');
          return;
        }
        if (target.status !== 'OPEN') {
          reject(rejectedOperations, operation, 'target_is_not_open');
          return;
        }
        if (!operation.answer.trim()) {
          reject(rejectedOperations, operation, 'empty_unknown_answer');
          return;
        }
        validatedOperations.push(operation);
        const originalText = target.text;
        const beforeIds = new Set(updated.nodes.map((node) => node.id));
        updated = resolveGap(updated, target.id, operation.answer, profile);
        const resolved = updated.nodes.find((node) => node.id === target.id);
        updateNodeMetadata(resolved ?? target, sourceId, operation.confidence, undefined, now);
        const newIds = addSourceRefToNewNodes(beforeIds, updated, sourceId);
        annotateResolutionHistory(updated, target.id, sourceId, [target.id, ...newIds], originalText);
        updatedNodeIds.push(target.id);
        newIds.forEach((id) => createdNodeIds.push(id));
        operationNodeIds[operation.operationRef ?? `op:${index}`] = target.id;
        operationNodeIds[`new:${index}`] = target.id;
        executedOperations.push(operation);
        return;
      }

      if (operation.op === 'ADD_CONTEXT') {
        if (!CONTEXT_NODE_TYPES.has(operation.nodeType) || !operation.text.trim()) {
          reject(rejectedOperations, operation, 'invalid_context_operation');
          return;
        }
      } else if (!operation.text.trim()) {
        reject(rejectedOperations, operation, 'empty_operation_text');
        return;
      }

      validatedOperations.push(operation);
      const existing = attachExistingOperation(updated, operation, sourceId, now);
      const node = existing ?? createNode(updated, operation, sourceId, now);
      if (existing) updatedNodeIds.push(node.id);
      else createdNodeIds.push(node.id);
      operationNodeIds[operation.operationRef ?? `op:${index}`] = node.id;
      operationNodeIds[`new:${index}`] = node.id;
      executedOperations.push(operation);
    } catch (error) {
      reject(rejectedOperations, operation, error instanceof Error ? error.message : 'operation_failed');
    }
  });

  return {
    project: updated,
    validatedOperations,
    executedOperations,
    rejectedOperations,
    createdNodeIds: Array.from(new Set(createdNodeIds)),
    updatedNodeIds: Array.from(new Set(updatedNodeIds)),
    operationNodeIds,
  };
}

/** Compatibility adapter for older callers; live processing uses operations. */
export function canonicalChangesToProjectPatch(changes: CanonicalChange[] = []): ProjectPatch {
  return {
    operations: changes.map((change, index) => {
      const operationRef = `op:${index}`;
      if (change.operation === 'RESOLVE_DECISION') {
        return { op: 'RESOLVE_DECISION', targetNodeId: change.targetNodeId, outcome: change.outcome, confidence: change.confidence, operationRef };
      }
      if (change.operation === 'RESOLVE_UNKNOWN') {
        return { op: 'RESOLVE_UNKNOWN', targetNodeId: change.targetNodeId, answer: change.answer, confidence: change.confidence, operationRef };
      }
      if (change.operation === 'OPEN_DECISION') {
        return { op: 'OPEN_DECISION', text: change.text, confidence: change.confidence, impact: 0.9, operationRef };
      }
      return { op: 'NO_CHANGE', confidence: change.confidence, operationRef };
    }),
  };
}

/** Compatibility alias for the previous executor name. */
export function applyCanonicalChanges(
  project: Project,
  changes: CanonicalChange[] = [],
  sourceId = '',
  profile: UserMemoryProfile = DEFAULT_USER_PROFILE,
): ProjectPatchExecutionResult {
  return applyProjectPatch(project, canonicalChangesToProjectPatch(changes), sourceId, profile);
}
