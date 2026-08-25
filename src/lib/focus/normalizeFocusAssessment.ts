import type { ClarityNode, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { getUnresolvedPrerequisites } from '@/lib/focus/sequencing';
import { isNextActionSatisfied } from '@/lib/actions/completion';

const OUTCOME_TYPES = new Set<ClarityNode['type']>(['UNKNOWN', 'ASSUMPTION', 'DECISION']);
const ACTION_OUTCOME_RELATIONSHIPS = new Set(['informs', 'affects', 'resolves', 'satisfies']);
const WORKFLOW_RELATIONSHIPS = new Set(['blocks', 'depends_on', 'informs', 'affects', 'resolves', 'satisfies']);

function isOpenOutcome(node: ClarityNode | undefined): node is ClarityNode {
  return Boolean(node && node.status === 'OPEN' && OUTCOME_TYPES.has(node.type));
}

function isUsableAction(project: Project, node: ClarityNode | undefined): node is ClarityNode {
  return Boolean(node && node.status === 'OPEN' && node.type === 'NEXT_ACTION' && !isNextActionSatisfied(project, node));
}

function nodeById(project: Project, id: string | undefined): ClarityNode | undefined {
  return id ? project.nodes.find((node) => node.id === id) : undefined;
}

function linkedOutcomeIds(project: Project, actionId: string): string[] {
  return project.edges
    .filter((edge) => edge.source === actionId && ACTION_OUTCOME_RELATIONSHIPS.has(edge.type))
    .map((edge) => edge.target)
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

function linkedExecutionIds(project: Project, outcomeId: string): string[] {
  return project.edges
    .filter((edge) => edge.target === outcomeId && ACTION_OUTCOME_RELATIONSHIPS.has(edge.type))
    .map((edge) => edge.source)
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

function directWorkflowNeighbors(project: Project, nodeIds: string[]): string[] {
  const selected = new Set(nodeIds);
  const related = new Set<string>();
  project.edges.forEach((edge) => {
    if (!WORKFLOW_RELATIONSHIPS.has(edge.type)) return;
    if (selected.has(edge.source)) related.add(edge.target);
    if (selected.has(edge.target)) related.add(edge.source);
  });
  return [...related].filter((id) => {
    const node = nodeById(project, id);
    return !selected.has(id)
      && node !== undefined
      && (OUTCOME_TYPES.has(node.type) || node.type === 'NEXT_ACTION');
  });
}

function focusKind(node: ClarityNode | undefined, fallback: FocusAssessment['kind']): FocusAssessment['kind'] {
  if (node?.type === 'DECISION') return 'decision';
  if (node?.type === 'NEXT_ACTION') return 'action';
  if (node?.type === 'UNKNOWN' || node?.type === 'ASSUMPTION') return 'question';
  return fallback;
}

function chooseBlockedPrerequisite(project: Project, target: ClarityNode): ClarityNode | undefined {
  const prerequisites = getUnresolvedPrerequisites(project, target.id)
    .filter((node) => OUTCOME_TYPES.has(node.type));
  if (prerequisites.length === 0) return undefined;

  const directPrerequisites = prerequisites.filter((node) => project.edges.some((edge) =>
    (edge.type === 'blocks' && edge.target === target.id && edge.source === node.id)
    || (edge.type === 'depends_on' && edge.source === target.id && edge.target === node.id)
  ));
  const candidates = directPrerequisites.length > 0 ? directPrerequisites : prerequisites;
  return candidates
    .slice()
    .sort((left, right) => (right.impact * right.confidence) - (left.impact * left.confidence) || left.id.localeCompare(right.id))[0];
}

function resolveTargetFromAction(project: Project, action: ClarityNode): { target?: ClarityNode; ambiguous: boolean } {
  const linked = linkedOutcomeIds(project, action.id)
    .map((id) => nodeById(project, id))
    .filter(isOpenOutcome);
  if (linked.length === 1) return { target: linked[0], ambiguous: false };
  return { target: undefined, ambiguous: linked.length > 1 };
}

function resolveExecutionForTarget(project: Project, target: ClarityNode, proposedId?: string): ClarityNode | undefined {
  if (proposedId) {
    const proposed = nodeById(project, proposedId);
    if (isUsableAction(project, proposed) && linkedOutcomeIds(project, proposed.id).includes(target.id)) return proposed;
  }

  const linked = linkedExecutionIds(project, target.id)
    .map((id) => nodeById(project, id))
    .filter((node): node is ClarityNode => isUsableAction(project, node));
  return linked.length === 1 ? linked[0] : undefined;
}

function recoverOpenRelatedNode(project: Project, node: ClarityNode): ClarityNode | undefined {
  const related = project.edges
    .filter((edge) => WORKFLOW_RELATIONSHIPS.has(edge.type)
      && (edge.source === node.id || edge.target === node.id))
    .map((edge) => edge.source === node.id ? edge.target : edge.source)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) => nodeById(project, id))
    .filter((candidate): candidate is ClarityNode =>
      isOpenOutcome(candidate) || isUsableAction(project, candidate)
    );

  return related
    .slice()
    .sort((left, right) => {
      const leftOutcome = OUTCOME_TYPES.has(left.type) ? 1 : 0;
      const rightOutcome = OUTCOME_TYPES.has(right.type) ? 1 : 0;
      return rightOutcome - leftOutcome
        || (right.impact * right.confidence) - (left.impact * left.confidence)
        || left.id.localeCompare(right.id);
    })[0];
}

/**
 * Validates the shared Focus Assessment contract and separates the outcome
 * target from any existing action that describes how to advance it.
 */
export function normalizeFocusAssessment(
  project: Project,
  assessment: FocusAssessment,
): FocusAssessment {
  const proposedTargetId = assessment.targetNodeId ?? assessment.actionNodeId ?? assessment.executionNodeId;
  const proposedTarget = nodeById(project, proposedTargetId);
  let target: ClarityNode | undefined;
  let execution: ClarityNode | undefined;
  let normalizedTitle = assessment.title;
  let normalizedNextAction = assessment.nextAction;

  if (isOpenOutcome(proposedTarget)) {
    target = proposedTarget;
    execution = resolveExecutionForTarget(project, target, assessment.executionNodeId);
  } else if (isUsableAction(project, proposedTarget)) {
    const resolved = resolveTargetFromAction(project, proposedTarget);
    target = resolved.target ?? proposedTarget;
    execution = resolved.target && !resolved.ambiguous ? proposedTarget : undefined;
    if (resolved.target && !resolved.ambiguous && !assessment.nextAction) {
      normalizedTitle = resolved.target.text;
      normalizedNextAction = (proposedTarget as ClarityNode).text;
    }
  } else if (proposedTarget) {
    const recovered = recoverOpenRelatedNode(project, proposedTarget);
    if (isOpenOutcome(recovered)) {
      target = recovered;
      execution = resolveExecutionForTarget(project, recovered, assessment.executionNodeId);
    } else if (isUsableAction(project, recovered)) {
      const resolved = resolveTargetFromAction(project, recovered);
      target = resolved.target ?? recovered;
      execution = resolved.target && !resolved.ambiguous ? recovered : undefined;
    }
  }

  if (target && target.type !== 'NEXT_ACTION') {
    const prerequisite = chooseBlockedPrerequisite(project, target);
    if (prerequisite) {
      target = prerequisite;
      execution = resolveExecutionForTarget(project, target, execution?.id);
      normalizedTitle = prerequisite.text;
      normalizedNextAction = prerequisite.text;
    }
  }

  if (target?.type === 'NEXT_ACTION' && !isUsableAction(project, target)) {
    target = undefined;
    execution = undefined;
  }
  if (execution && !isUsableAction(project, execution)) execution = undefined;
  if (target && proposedTarget && target.id !== proposedTarget.id && !assessment.nextAction) {
    normalizedTitle = target.text;
  }
  if (!normalizedNextAction && execution) normalizedNextAction = execution.text;

  const targetNodeId = target?.id;
  const executionNodeId = execution?.id;
  const coreIds = [targetNodeId, executionNodeId].filter((id): id is string => Boolean(id));
  const representedNodeIds = [
    ...coreIds,
    ...directWorkflowNeighbors(project, coreIds),
  ].filter((id, index, ids) => ids.indexOf(id) === index);
  const validNodeIds = new Set(project.nodes.map((node) => node.id));
  const sourceNodeIds = assessment.sourceNodeIds.filter((id, index, ids) => validNodeIds.has(id) && ids.indexOf(id) === index);
  const validSourceIds = new Set(project.sources.map((source) => source.id));
  const sourceIds = assessment.sourceIds.filter((id, index, ids) => validSourceIds.has(id) && ids.indexOf(id) === index);

  return {
    ...assessment,
    title: normalizedTitle,
    nextAction: normalizedNextAction,
    kind: focusKind(target, assessment.kind),
    targetNodeId,
    executionNodeId,
    representedNodeIds,
    sourceNodeIds,
    sourceIds,
    actionNodeId: targetNodeId,
  };
}
