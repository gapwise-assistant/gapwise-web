import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { processContextSource } from '@/lib/context/contextAnalysis';
import { ingestContextSource } from '@/lib/context/ingestion';
import { loadGeneralContext, listProjects, saveGeneralContext, saveProject } from '@/lib/storage';
import { GENERAL_CONTEXT_ID } from '@/lib/scope/projectScope';
import { Project } from '@/types/clarity';
import type { AskContextProposal } from '@/types/ask';
import {
  canonicalQuestionGroups,
  canonicalOpenQuestions,
  reconcileQuestionCandidate,
} from '@/lib/questions/canonical';
import {
  changedProjectNodeIds,
  completeProjectRelationships,
  type RelationshipCompletionTrace,
} from '@/lib/graph/relationshipCompletion';
import { resolveSatisfiedNextActions } from '@/lib/actions/completion';
import { retireExplicitlyDisprovedRisks } from '@/lib/graph/riskLifecycle';
import { appendContextAddedHistory, appendNextActionCompletionHistory } from '@/lib/history/projectHistory';
import type { ContextProcessingLog } from '@/types/clarity';
import { boundedId } from '@/lib/ids/boundedId';
import { serializeProcessingProjectSnapshot } from '@/lib/context/processingProjectSnapshot';
import { loadUserMemoryProfile } from '@/lib/memory/serverStore';

export function askSourceId(chatId: string, messageId: string): string {
  return boundedId('ask', `${chatId}_${messageId}`);
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

export function proposalSourceId(assistantMessageId: string, proposalId: string): string {
  return boundedId('ask_proposal', `${assistantMessageId}_${proposalId}`);
}

function proposalId(assistantMessageId: string, proposal: AskContextProposal): string {
  return proposal.id ?? boundedId('proposal', `${assistantMessageId}_${proposal.type}_${proposal.text}`);
}

function proposalTargetCompatible(proposal: AskContextProposal, node: Project['nodes'][number]): boolean {
  if (proposal.type === 'UNKNOWN' || proposal.type === 'ASSUMPTION') {
    return node.type === 'UNKNOWN' || node.type === 'ASSUMPTION';
  }
  return proposal.type === node.type;
}

function canonicalProposalTarget(project: Project, proposal: AskContextProposal): string | undefined {
  const explicit = proposal.targetNodeId
    ? project.nodes.find((node) => node.id === proposal.targetNodeId && node.status !== 'DEPRECATED')
    : undefined;
  if (explicit && proposalTargetCompatible(proposal, explicit)) return explicit.id;

  if (proposal.type === 'UNKNOWN' || proposal.type === 'ASSUMPTION') {
    const reconciliation = reconcileQuestionCandidate(proposal, project);
    const candidateId = reconciliation.canonicalQuestionId;
    const candidate = candidateId ? project.nodes.find((node) => node.id === candidateId) : undefined;
    if (candidate && proposalTargetCompatible(proposal, candidate)) return candidate.id;
  }

  const normalized = proposal.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return project.nodes.find((node) =>
    node.status !== 'DEPRECATED'
    && proposalTargetCompatible(proposal, node)
    && node.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normalized
  )?.id;
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
  const profile = await loadUserMemoryProfile(params.userId, DEFAULT_USER_PROFILE);
  const sourceId = proposalSourceId(params.assistantMessageId, proposalId(params.assistantMessageId, params.proposal));
  const now = new Date().toISOString();
  const targetNodeId = canonicalProposalTarget(target.project, params.proposal);
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
      ...(targetNodeId ? {
        canonicalNodeId: targetNodeId,
        canonicalQuestionId: targetNodeId,
        questionClassification: 'EQUIVALENT' as const,
        reconciliationConfidence: 1,
        reconciliationReason: 'The accepted Ask proposal explicitly reuses an existing canonical project node.',
      } : {}),
      ...(params.proposal.reasoning ? { whyItMatters: [params.proposal.reasoning] } : {}),
    }],
    deferHistory: true,
  }, profile);
  const relationshipStartedAt = new Date();
  const changedNodeIds = changedProjectNodeIds(target.project, ingested);
  let relationshipProject = ingested;
  let relationshipTrace: RelationshipCompletionTrace = {
    candidatePairs: [],
    classifications: [],
    acceptedRelationships: [],
    rejectedRelationships: [],
  };
  try {
    const completion = await completeProjectRelationships({
      projectBefore: target.project,
      projectAfter: ingested,
      changedNodeIds,
      source: {
        id: sourceId,
        filename: `Ask proposal ${params.assistantMessageId}.txt`,
        content: proposalContext,
      },
    });
    relationshipProject = completion.project;
    relationshipTrace = completion.trace;
  } catch (error) {
    relationshipTrace = {
      ...relationshipTrace,
      error: error instanceof Error ? error.message : 'Relationship completion unavailable.',
    };
  }

  const completedAt = new Date();
  const relationshipLog: ContextProcessingLog = {
    version: 1,
    status: relationshipTrace.error ? 'failed' : 'completed',
    started_at: relationshipStartedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: Math.max(0, completedAt.getTime() - relationshipStartedAt.getTime()),
    input: {
      source_id: sourceId,
      filename: `Ask proposal ${params.assistantMessageId}.txt`,
      type: 'note',
      content: params.proposal.text,
      project_snapshot: serializeProcessingProjectSnapshot(target.project),
    },
    stages: [{
      name: 'Relationship completion',
      status: relationshipTrace.error ? 'failed' : 'completed',
      started_at: relationshipStartedAt.toISOString(),
      duration_ms: Math.max(0, completedAt.getTime() - relationshipStartedAt.getTime()),
      input: {
        changed_node_ids: changedNodeIds,
        changedNodeIds,
      },
      output: relationshipTrace,
      ...(relationshipTrace.error ? { error: relationshipTrace.error } : {}),
    }],
    ...(relationshipTrace.error ? { error: relationshipTrace.error } : {}),
  };
  const sourceWithLog = relationshipProject.sources.find((source) => source.id === sourceId);
  if (sourceWithLog) sourceWithLog.processing_log = relationshipLog;

  const completedActionIds = resolveSatisfiedNextActions(relationshipProject);
  retireExplicitlyDisprovedRisks(relationshipProject, now);
  let updated = appendContextAddedHistory(target.project, relationshipProject, {
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
  const profile = await loadUserMemoryProfile(params.userId, DEFAULT_USER_PROFILE);
  const sourceId = askSourceId(params.chatId, params.messageId);
  const result = await processContextSource(target.project, {
    sourceId,
    filename: askSourceFilename(params.chatId, params.messageId),
    content: params.text,
    type: 'note',
    origin: 'user',
    semanticRole: 'ask_message',
  }, profile, {
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
