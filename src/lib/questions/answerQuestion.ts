import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { resolveGap } from '@/lib/tools/graphTools';
import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { Project } from '@/types/clarity';
import { classifyAnswer } from '@/lib/questions/answerClassification';
import { refreshProjectGapRuntime } from '@/lib/agents/gapRuntime';
import { canonicalQuestionGroups } from '@/lib/questions/canonical';

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

export interface ReopenAnsweredQuestionResult {
  ownerType: 'project' | 'global';
  projectId?: string;
  context: Project;
  historyTimestamp: string;
}

function assertAnswerable(project: Project, nodeId: string) {
  const group = canonicalQuestionGroups(project).find((candidate) => candidate.nodeIds.includes(nodeId));
  const node = group?.canonical ?? project.nodes.find((item) => item.id === nodeId);
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
    const resolved = resolveInContext(owner, params.nodeId, params.answer);
    const refreshed = await refreshProjectGapRuntime({
      userId: params.userId,
      project: resolved.context,
      route: '/api/questions/answer',
      label: 'Gap Agent after question answer',
    });
    const context = refreshed.project;
    await saveProject(params.userId, context);
    return {
      ownerType: 'project',
      projectId: owner.id,
      context,
      resolvedNodeId: params.nodeId,
      createdNodeId: resolved.createdNodeId,
    };
  }

  if (!params.projectId) {
    const generalContext = await loadGeneralContext(params.userId);
    if (assertAnswerable(generalContext, params.nodeId)) {
      const resolved = resolveInContext(generalContext, params.nodeId, params.answer);
      const refreshed = await refreshProjectGapRuntime({
        userId: params.userId,
        project: resolved.context,
        route: '/api/questions/answer',
        label: 'Gap Agent after general-context answer',
      });
      const context = refreshed.project;
      await saveGeneralContext(params.userId, context);
      return {
        ownerType: 'global',
        context,
        resolvedNodeId: params.nodeId,
        createdNodeId: resolved.createdNodeId,
      };
    }
  }

  throw new StorageError('This unresolved question was not found for the requested user and scope.', 'VALIDATION_ERROR');
}

function findAnswerUnderstanding(project: Project, question: string, previousAnswer: string) {
  const gap = project.nodes.find(
    (node) =>
      node.text === question &&
      node.status === 'RESOLVED' &&
      (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION')
  );
  if (gap) {
    const edge = project.edges.find((item) => item.type === 'resolves' && item.target === gap.id);
    const understanding = edge ? project.nodes.find((node) => node.id === edge.source) : undefined;
    if (understanding) return { gap, understanding };
  }

  const understanding = project.nodes.find(
    (node) => node.created_by === 'user' && node.text === previousAnswer &&
      ['CONSTRAINT', 'PREFERENCE', 'KNOWN', 'EVIDENCE', 'DECISION', 'NEXT_ACTION'].includes(node.type)
  );
  return understanding ? { gap: undefined, understanding } : undefined;
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
      (item.question === params.question || params.question.includes(item.question) || item.question.includes(params.question)) &&
      item.answer === params.previousAnswer
  );
  if (!historyItem) {
    throw new StorageError('This answered question was not found in the requested project.', 'VALIDATION_ERROR');
  }

  const now = new Date().toISOString();
  const linked = findAnswerUnderstanding(updated, historyItem.question, historyItem.answer);
  if (linked) {
    const classification = classifyAnswer(linked.gap ?? {
      type: 'UNKNOWN',
      text: historyItem.question,
    }, params.answer, updated);
    linked.understanding.type = classification.type;
    linked.understanding.text = classification.text;
    linked.understanding.status = 'RESOLVED';
    linked.understanding.confidence = 1;
    linked.understanding.updated_at = now;
    if (linked.gap && linked.gap.source_refs.length && !linked.understanding.source_refs.length) {
      linked.understanding.source_refs = [...linked.gap.source_refs];
    }
    if (classification.supersedesOriginal && linked.gap && !updated.edges.some(
      (edge) => edge.source === linked.understanding.id && edge.target === linked.gap?.id && edge.type === 'supersedes'
    )) {
      updated.edges.push({
        id: `edge_${Date.now()}_supersedes`,
        source: linked.understanding.id,
        target: linked.gap.id,
        type: 'supersedes',
      });
    }
    historyItem.graph_diff_summary = `Resolved "${historyItem.question}" -> ${classification.type}: "${classification.text}"`;
  }
  historyItem.answer = params.answer;
  updated.clarity_score = calculateClarityScore(updated);
  updated.active_question = selectTopGap(updated, DEFAULT_USER_PROFILE);
  updated.updated_at = now;

  const refreshed = await refreshProjectGapRuntime({
    userId: params.userId,
    project: updated,
    route: '/api/questions/answer',
    label: 'Gap Agent after edited answer',
  });
  await saveProject(params.userId, refreshed.project);
  return {
    ownerType: 'project',
    projectId: owner.id,
    context: refreshed.project,
    historyTimestamp: historyItem.timestamp,
  };
}

function reopenInContext(project: Project, params: {
  historyTimestamp: string;
  question: string;
  previousAnswer: string;
}): { context: Project; historyTimestamp: string } {
  const updated = JSON.parse(JSON.stringify(project)) as Project;
  const historyItem = updated.history.find(
    (item) =>
      item.timestamp === params.historyTimestamp &&
      item.question === params.question &&
      item.answer === params.previousAnswer
  );
  if (!historyItem) {
    throw new StorageError('This answered question was not found in the requested context.', 'VALIDATION_ERROR');
  }

  const gap = updated.nodes.find(
    (node) =>
      node.text === historyItem.question &&
      (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') &&
      node.status === 'RESOLVED'
  );
  if (!gap) {
    throw new StorageError('The resolved question is no longer available to reopen.', 'VALIDATION_ERROR');
  }

  const now = new Date().toISOString();
  const answerNodeIds = new Set(
    updated.edges
      .filter((edge) => edge.type === 'resolves' && edge.target === gap.id)
      .map((edge) => edge.source)
      .filter((nodeId) => updated.nodes.find((node) => node.id === nodeId)?.created_by === 'user')
  );

  gap.status = 'OPEN';
  // A reopened question is uncertain again; keep the prior signal bounded so
  // reopening cannot accidentally make it look more certain than before.
  gap.confidence = Math.min(gap.confidence, 0.25);
  gap.updated_at = now;

  // Preserve the user's answer node as a deprecated audit record, while
  // removing its active resolution links from the decision graph.
  updated.nodes.forEach((node) => {
    if (answerNodeIds.has(node.id)) {
      node.status = 'DEPRECATED';
      node.updated_at = now;
    }
  });
  updated.edges = updated.edges.filter(
    (edge) => !answerNodeIds.has(edge.source) || (edge.type !== 'resolves' && edge.type !== 'supersedes')
  );
  historyItem.graph_diff_summary = `Response cancelled; reopened "${historyItem.question}".`;
  updated.clarity_score = calculateClarityScore(updated);
  updated.active_question = selectTopGap(updated, DEFAULT_USER_PROFILE);
  updated.updated_at = now;
  return { context: updated, historyTimestamp: historyItem.timestamp };
}

export async function reopenAnsweredQuestion(params: {
  userId: string;
  projectId?: string;
  historyTimestamp: string;
  question: string;
  previousAnswer: string;
}): Promise<ReopenAnsweredQuestionResult> {
  const projects = await listProjects(params.userId);
  const owner = params.projectId && params.projectId !== '__general_context__'
    ? projects.find((project) => project.id === params.projectId)
    : undefined;

  if (owner) {
    const reopened = reopenInContext(owner, params);
    const refreshed = await refreshProjectGapRuntime({
      userId: params.userId,
      project: reopened.context,
      route: '/api/questions/answer',
      label: 'Gap Agent after reopening an answer',
    });
    await saveProject(params.userId, refreshed.project);
    return { ownerType: 'project', projectId: owner.id, context: refreshed.project, historyTimestamp: reopened.historyTimestamp };
  }

  if (!params.projectId || params.projectId === '__general_context__') {
    const generalContext = await loadGeneralContext(params.userId);
    const reopened = reopenInContext(generalContext, params);
    const refreshed = await refreshProjectGapRuntime({
      userId: params.userId,
      project: reopened.context,
      route: '/api/questions/answer',
      label: 'Gap Agent after reopening a general-context answer',
    });
    await saveGeneralContext(params.userId, refreshed.project);
    return { ownerType: 'global', context: refreshed.project, historyTimestamp: reopened.historyTimestamp };
  }

  throw new StorageError('This answered question was not found for the requested user and project.', 'VALIDATION_ERROR');
}
