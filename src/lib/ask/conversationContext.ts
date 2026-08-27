import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { ingestContextSource } from '@/lib/context/ingestion';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import { Project } from '@/types/clarity';
import type { AskContextProposal } from '@/types/ask';
import { canonicalQuestionGroups, canonicalOpenQuestions } from '@/lib/questions/canonical';
import { changedProjectNodeIds, completeProjectRelationships } from '@/lib/graph/relationshipCompletion';
import { resolveSatisfiedNextActions } from '@/lib/actions/completion';
import { appendContextAddedHistory, appendNextActionCompletionHistory } from '@/lib/history/projectHistory';

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

function proposalSourceId(assistantMessageId: string, proposalId: string): string {
  return `ask_proposal_${assistantMessageId}_${proposalId}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 240);
}

/**
 * Persists a proposal only after the user explicitly chooses Add. The node is
 * passed through the normal graph ingestion writer as a precomputed node so
 * its model-selected type and wording are preserved without running another
 * AI extraction pass.
 */
export async function persistAskProposal(params: {
  userId: string;
  projectId?: string;
  assistantMessageId: string;
  proposal: AskContextProposal;
}): Promise<Project> {
  const target = await loadTarget(params.userId, params.projectId);
  const sourceId = proposalSourceId(params.assistantMessageId, params.proposal.id ?? 'proposal');
  const now = new Date().toISOString();
  const proposalContext = [params.proposal.text, params.proposal.reasoning]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n');
  const ingested = await ingestContextSource(target.project, {
    sourceId,
    filename: `Ask proposal ${params.assistantMessageId}.txt`,
    content: params.proposal.text,
    type: 'note',
    origin: 'user',
    semanticRole: 'user_confirmed_proposal',
    processingStatus: 'completed',
    processedAt: now,
    modelUsed: 'partner-proposal-confirmed-by-user',
    derivedNodes: [{
      candidateRef: 'new:0',
      type: params.proposal.type,
      text: params.proposal.text,
      confidence: 0.9,
      impact: 0.75,
      status: params.proposal.status,
      ...(params.proposal.reasoning ? { whyItMatters: [params.proposal.reasoning] } : {}),
    }],
    deferHistory: true,
  }, DEFAULT_USER_PROFILE);
  const completion = await completeProjectRelationships({
    projectBefore: target.project,
    projectAfter: ingested,
    changedNodeIds: changedProjectNodeIds(target.project, ingested),
    source: {
      id: sourceId,
      filename: `Ask proposal ${params.assistantMessageId}.txt`,
      content: proposalContext,
    },
  });
  const completedActionIds = resolveSatisfiedNextActions(completion.project);
  let updated = appendContextAddedHistory(target.project, completion.project, {
    sourceId,
    filename: `Ask proposal ${params.assistantMessageId}.txt`,
    createdAt: now,
  });
  if (completedActionIds.length > 0) {
    appendNextActionCompletionHistory(updated, completedActionIds);
  }
  await saveTarget(params.userId, updated, target.isGeneral);
  return updated;
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
  captureProcessingLog?: boolean;
}): Promise<{
  sourceId: string;
  historyEventId?: string;
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
    semanticRole: 'ask_message',
  }, DEFAULT_USER_PROFILE, {
    captureProcessingLog: params.captureProcessingLog,
  });

  if (!result.skipped) await saveTarget(params.userId, result.project, target.isGeneral);

  const source = result.project.sources.find((candidate) => candidate.id === sourceId);
  const historyEventId = [...(result.project.historyEvents ?? [])]
    .reverse()
    .find((event) => event.sourceId === sourceId)?.id;
  const sourceQuestionIds = new Set(source?.derived_node_ids ?? []);
  const openQuestions = canonicalOpenQuestions(result.project)
    .filter((node) => sourceQuestionIds.has(node.id) || canonicalQuestionGroups(result.project).some((group) =>
      group.canonical.id === node.id && group.nodeIds.some((nodeId) => sourceQuestionIds.has(nodeId))
    ))
    .map((node) => ({ id: node.id, text: node.text }));
  /*
   * Canonical question IDs are the only identity returned to Ask. Older
   * source nodes remain available for provenance, but aliases never become
   * independent answer targets.
   */
  const uniqueOpenQuestions = Array.from(new Map(
    openQuestions.map((node) => [node.id, node] as const)
  ).values());

  return {
    sourceId,
    ...(historyEventId ? { historyEventId } : {}),
    openQuestionIds: uniqueOpenQuestions.map((question) => question.id),
    openQuestions: uniqueOpenQuestions,
  };
}
