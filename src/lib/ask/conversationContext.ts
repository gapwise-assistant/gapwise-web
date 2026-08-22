import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import { Project } from '@/types/clarity';

function askSourceId(chatId: string, messageId: string): string {
  return `ask_${chatId}_${messageId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240);
}

function askSourceFilename(chatId: string, messageId: string): string {
  return `Ask chat ${chatId} message ${messageId}.txt`;
}

async function loadTarget(userId: string, projectId?: string): Promise<{ project: Project; isGeneral: boolean }> {
  if (!projectId || projectId === GENERAL_CONTEXT_ID) {
    return { project: await loadGeneralContext(userId), isGeneral: true };
  }
  const project = (await listProjects(userId)).find((candidate) => candidate.id === projectId);
  if (!project) throw new Error('The selected Ask project does not exist.');
  return { project, isGeneral: false };
}

async function saveTarget(userId: string, project: Project, isGeneral: boolean): Promise<void> {
  if (isGeneral) await saveGeneralContext(userId, project);
  else await saveProject(userId, project);
}

/**
 * Extracts only the user's Ask message through the existing generic context
 * pipeline. Assistant output is deliberately not an input to this function.
 */
export async function persistAskConversationContext(params: {
  userId: string;
  chatId: string;
  messageId: string;
  text: string;
  projectId?: string;
}): Promise<{
  sourceId: string;
  openQuestionIds: string[];
  openQuestions: Array<{ id: string; text: string }>;
}> {
  const target = await loadTarget(params.userId, params.projectId);
  const sourceId = askSourceId(params.chatId, params.messageId);
  const result = await processContextSource(target.project, {
    sourceId,
    filename: askSourceFilename(params.chatId, params.messageId),
    content: params.text,
    type: 'note',
    origin: 'user',
  }, DEFAULT_USER_PROFILE);

  if (!result.skipped) await saveTarget(params.userId, result.project, target.isGeneral);

  const source = result.project.sources.find((candidate) => candidate.id === sourceId);
  const openQuestions = (source?.derived_node_ids ?? [])
    .map((nodeId) => result.project.nodes.find((node) => node.id === nodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN')
    .map((node) => ({ id: node.id, text: node.text }));

  return {
    sourceId,
    openQuestionIds: openQuestions.map((question) => question.id),
    openQuestions,
  };
}
