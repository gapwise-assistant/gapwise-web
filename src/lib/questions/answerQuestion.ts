import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { resolveGap } from '@/lib/tools/graphTools';
import { Project } from '@/types/clarity';

export interface AnswerQuestionResult {
  ownerType: 'project' | 'global';
  projectId?: string;
  context: Project;
  resolvedNodeId: string;
  createdNodeId: string;
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
