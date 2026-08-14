import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { resolveGap } from '@/lib/tools/graphTools';
import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { Project } from '@/types/clarity';

export interface AnswerQuestionResult {
  ownerType: 'project' | 'global';
  projectId?: string;
  context: Project;
  resolvedNodeId: string;
  createdNodeId: string;
}

export interface EditAnsweredQuestionResult {
  ownerType: 'project';
  projectId: string;
  context: Project;
  historyTimestamp: string;
}

function assertAnswerable(project: Project, nodeId: string) {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  if (node.type !== 'UNKNOWN' && node.type !== 'ASSUMPTION') {
    throw new StorageError('Only an open question or assumption can be answered.', 'VALIDATION_ERROR');
  }
  if (node.status !== 'OPEN') {
    throw new StorageError('This question has already been resolved.', 'VALIDATION_ERROR');
  }
  return node;
}

function resolveInContext(project: Project, nodeId: string, answer: string): { context: Project; createdNodeId: string } {
  const existingNodeIds = new Set(project.nodes.map((node) => node.id));
  const updated = resolveGap(project, nodeId, answer, DEFAULT_USER_PROFILE);
  const created = updated.nodes.find((node) => !existingNodeIds.has(node.id));
  if (!created) {
    throw new StorageError('The answer could not update this question.', 'UNAVAILABLE');
  }
  created.created_by = 'user';
  return { context: updated, createdNodeId: created.id };
}

export async function answerQuestion(params: {
  userId: string;
  nodeId: string;
  answer: string;
  projectId?: string;
}): Promise<AnswerQuestionResult> {
  const projects = await listProjects(params.userId);
  const candidates = params.projectId
    ? projects.filter((project) => project.id === params.projectId)
    : projects;
  const owner = candidates.find((project) => assertAnswerable(project, params.nodeId));

  if (owner) {
    const { context, createdNodeId } = resolveInContext(owner, params.nodeId, params.answer);
    await saveProject(params.userId, context);
    return {
      ownerType: 'project',
      projectId: owner.id,
      context,
      resolvedNodeId: params.nodeId,
      createdNodeId,
    };
  }

  if (!params.projectId) {
    const generalContext = await loadGeneralContext(params.userId);
    if (assertAnswerable(generalContext, params.nodeId)) {
      const { context, createdNodeId } = resolveInContext(generalContext, params.nodeId, params.answer);
      await saveGeneralContext(params.userId, context);
      return {
        ownerType: 'global',
        context,
        resolvedNodeId: params.nodeId,
        createdNodeId,
      };
    }
  }

  throw new StorageError('This unresolved question was not found for the requested user and scope.', 'VALIDATION_ERROR');
}

function findAnswerDecision(project: Project, question: string, previousAnswer: string) {
  const gap = project.nodes.find(
    (node) =>
      node.text === question &&
      node.status === 'RESOLVED' &&
      (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
  );
  if (gap) {
    const edge = project.edges.find((item) => item.type === 'resolves' && item.target === gap.id);
    const decision = edge ? project.nodes.find((node) => node.id === edge.source) : undefined;
    if (decision?.type === 'DECISION') return decision;
  }

  return project.nodes.find(
    (node) => node.type === 'DECISION' && node.created_by === 'user' && node.text === previousAnswer
  );
}

export async function editAnsweredQuestion(params: {
  userId: string;
  projectId: string;
  historyTimestamp: string;
  question: string;
  previousAnswer: string;
  answer: string;
}): Promise<EditAnsweredQuestionResult> {
  const projects = await listProjects(params.userId);
  const owner = projects.find((project) => project.id === params.projectId);
  if (!owner) {
    throw new StorageError('This answered question was not found for the requested user and project.', 'VALIDATION_ERROR');
  }

  const updated = JSON.parse(JSON.stringify(owner)) as Project;
  const historyItem = updated.history.find(
    (item) =>
      item.timestamp === params.historyTimestamp &&
      item.question === params.question &&
      item.answer === params.previousAnswer
  );
  if (!historyItem) {
    throw new StorageError('This answered question was not found in the requested project.', 'VALIDATION_ERROR');
  }

  const now = new Date().toISOString();
  const decision = findAnswerDecision(updated, historyItem.question, historyItem.answer);
  if (decision) {
    decision.text = params.answer;
    decision.updated_at = now;
  }
  historyItem.answer = params.answer;
  historyItem.graph_diff_summary = `Resolved "${historyItem.question}" -> DECISION: "${params.answer}"`;
  updated.clarity_score = calculateClarityScore(updated);
  updated.active_question = selectTopGap(updated, DEFAULT_USER_PROFILE);
  updated.updated_at = now;

  await saveProject(params.userId, updated);
  return {
    ownerType: 'project',
    projectId: owner.id,
    context: updated,
    historyTimestamp: historyItem.timestamp,
  };
}
