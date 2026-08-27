import type {
  AskChatMessage,
  AskChatSession,
  AskContextProposal,
  AskResearchEvidence,
  AskSource,
  AskTarget,
} from '@/types/ask';
import type {
  CandidateGap,
  DecisionValueTarget,
  HistoryNodeSnapshot,
  Project,
  ProjectHistoryChange,
  ProjectHistoryEvent,
  ProjectHistoryFocus,
} from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';
import { focusAssessmentCacheId, focusProjectStateVersion } from '@/lib/focus/focusCache';
import { overviewProjectStateVersion, projectOverviewAssessmentCacheId } from '@/lib/overview/projectOverviewCache';
import { buildContextPackForUser } from '@/lib/retrieval/contextPackServer';
import { generateDailyBrief } from '@/lib/attention/generateBrief';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { listTraces } from '@/lib/observability/trace';
import { getStorageProvider } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import { hashText } from '@/lib/context/ingestion';
import { boundedId } from '@/lib/ids/boundedId';
import { projectTitlePresentation } from '@/lib/projects/projectTitle';
import {
  PROJECT_SNAPSHOT_MAX_BYTES,
  isProjectSnapshotV2,
  serializedProjectSnapshotSize,
  type MaterializedProjectSnapshot,
  type ProjectSnapshot,
  type ProjectSnapshotV2,
  type SnapshotProjectState,
  type SnapshotSourceMetadata,
} from '@/types/projectSnapshot';

const SNAPSHOT_SCHEMA_VERSION = 2;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return values.slice().sort((left, right) => key(left).localeCompare(key(right)));
}

function sourceMetadata(source: Project['sources'][number]): SnapshotSourceMetadata {
  const { content: _content, processing_log: _processingLog, ...metadata } = clone(source);
  return metadata;
}

export function compactProjectState(project: Project): SnapshotProjectState {
  const state = clone(project);
  return {
    ...state,
    sources: state.sources.map(sourceMetadata),
  } as SnapshotProjectState;
}

function stableProjectState(project: Project): unknown {
  const state = compactProjectState(project);
  return {
    ...state,
    nodes: sorted(state.nodes, (node) => node.id),
    edges: sorted(state.edges, (edge) => `${edge.source}:${edge.type}:${edge.target}`),
    sources: sorted(state.sources, (source) => source.id),
    history: sorted(state.history, (entry) => `${entry.question}\u0000${entry.timestamp}\u0000${entry.answer}`),
    historyEvents: sorted(state.historyEvents ?? [], (event) => event.id),
  };
}

function proposalConfirmationStatus(proposal: AskContextProposal): 'pending' | 'added' | 'dismissed' {
  const value = proposal.confirmationStatus ?? (proposal.status as unknown);
  if (value === 'added') return 'added';
  if (value === 'dismissed') return 'dismissed';
  return 'pending';
}

function proposalIdentity(messageId: string, proposal: AskContextProposal): string {
  return proposal.id ?? boundedId('proposal', `${messageId}_${proposal.type}_${proposal.text}`);
}

function proposalStates(messages: AskChatMessage[]): ProjectSnapshotV2['proposalStates'] {
  return messages.flatMap((message) =>
    (message.contextProposals ?? message.proposals ?? [])
      .map((proposal) => ({
        proposalId: proposalIdentity(message.id, proposal),
        messageId: message.id,
        confirmationStatus: proposalConfirmationStatus(proposal),
      })),
  );
}

function sourceReferenceIds(project: Project): string[] {
  return [...new Set(project.sources.map((source) => source.id))].sort((left, right) => left.localeCompare(right));
}

function snapshotCreatedAt(
  project: Project,
  trigger: ProjectSnapshotV2['trigger'],
  messages: AskChatMessage[],
): string {
  const historyEvent = trigger.historyEventId
    ? project.historyEvents?.find((event) => event.id === trigger.historyEventId)
    : undefined;
  const source = trigger.sourceId
    ? project.sources.find((candidate) => candidate.id === trigger.sourceId)
    : undefined;
  const node = trigger.nodeId
    ? project.nodes.find((candidate) => candidate.id === trigger.nodeId)
    : undefined;
  const message = trigger.askMessageId
    ? messages.find((candidate) => candidate.id === trigger.askMessageId)
    : undefined;
  const proposalMessage = trigger.proposalId
    ? messages.find((candidate) =>
      (candidate.contextProposals ?? candidate.proposals ?? []).some((proposal) => proposal.id === trigger.proposalId))
    : undefined;
  const candidates = [
    historyEvent?.createdAt,
    message?.createdAt,
    proposalMessage?.createdAt,
    source?.processed_at,
    source?.extracted_at,
    node?.updated_at,
    project.updated_at,
    project.created_at,
  ].filter((value): value is string => Boolean(value));
  const firstValid = candidates.find((value) => !Number.isNaN(new Date(value).getTime()));
  return firstValid ?? new Date(0).toISOString();
}

function traceIdsForProject(userId: string, project: Project): string[] {
  const projectOwnedIds = new Set([
    project.id,
    ...project.nodes.map((node) => node.id),
    ...project.sources.map((source) => source.id),
    ...(project.historyEvents ?? []).map((event) => event.id),
  ]);
  return listTraces(userId)
    .filter((trace) => trace.decisionMapActivity?.projectId === project.id
      || trace.contextIds.some((id) => projectOwnedIds.has(id))
      || trace.askGraphReasoningContext?.selectedNodeIds.some((id) => projectOwnedIds.has(id)))
    .map((trace) => trace.id);
}

function idFor(prefix: string, value: string, projectId: string): string {
  return boundedId(prefix, `${projectId}_${value}`);
}

function nextProjectTitle(baseTitle: string, projects: Project[]): string {
  const base = baseTitle.trim().replace(/\s+\(\d+\)$/, '').trim() || 'Project';
  const taken = new Set(projects.map((project) => project.title.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (taken.has(`${base} (${suffix})`.toLowerCase())) suffix += 1;
  return `${base} (${suffix})`;
}

function mapValue(value: string | undefined, maps: Map<string, string>[]): string | undefined {
  if (value === undefined) return undefined;
  for (const map of maps) {
    const mapped = map.get(value);
    if (mapped) return mapped;
  }
  return value;
}

function remapHistoryNodeSnapshot(snapshot: HistoryNodeSnapshot, nodeIds: Map<string, string>): HistoryNodeSnapshot {
  return { ...snapshot, nodeId: mapValue(snapshot.nodeId, [nodeIds]) };
}

function remapHistoryChange(change: ProjectHistoryChange, nodeIds: Map<string, string>): ProjectHistoryChange {
  return {
    ...change,
    nodeId: mapValue(change.nodeId, [nodeIds]),
    snapshot: change.snapshot ? remapHistoryNodeSnapshot(change.snapshot, nodeIds) : undefined,
  };
}

function remapHistoryFocus(
  focus: ProjectHistoryFocus,
  nodeIds: Map<string, string>,
  sourceIds: Map<string, string>,
): ProjectHistoryFocus {
  return {
    ...focus,
    actionNodeId: mapValue(focus.actionNodeId, [nodeIds]),
    sourceNodeIds: focus.sourceNodeIds?.map((id) => nodeIds.get(id) ?? id),
    sourceIds: focus.sourceIds?.map((id) => sourceIds.get(id) ?? id),
  };
}

function remapHistoryEvent(
  event: ProjectHistoryEvent,
  projectId: string,
  nodeIds: Map<string, string>,
  sourceIds: Map<string, string>,
  historyIds: Map<string, string>,
): ProjectHistoryEvent {
  return {
    ...clone(event),
    id: historyIds.get(event.id) ?? idFor('history', event.id, projectId),
    projectId,
    sourceId: mapValue(event.sourceId, [sourceIds]),
    sourceNodeIds: event.sourceNodeIds?.map((id) => nodeIds.get(id) ?? id),
    affectedNodeIds: event.affectedNodeIds?.map((id) => nodeIds.get(id) ?? id),
    affectedNodes: event.affectedNodes?.map((node) => remapHistoryNodeSnapshot(node, nodeIds)),
    primaryNodeId: mapValue(event.primaryNodeId, [nodeIds]),
    primarySnapshot: event.primarySnapshot ? remapHistoryNodeSnapshot(event.primarySnapshot, nodeIds) : undefined,
    changes: event.changes?.map((change) => remapHistoryChange(change, nodeIds)),
    focusBefore: event.focusBefore ? remapHistoryFocus(event.focusBefore, nodeIds, sourceIds) : undefined,
    focusAfter: event.focusAfter ? remapHistoryFocus(event.focusAfter, nodeIds, sourceIds) : undefined,
  };
}

function remapDecisionValueTarget(target: DecisionValueTarget, nodeIds: Map<string, string>, edgeIds: Map<string, string>): DecisionValueTarget {
  return {
    ...target,
    node_id: nodeIds.get(target.node_id) ?? target.node_id,
    path_node_ids: target.path_node_ids.map((id) => nodeIds.get(id) ?? id),
    path_edge_ids: target.path_edge_ids.map((id) => edgeIds.get(id) ?? id),
  };
}

function remapCandidateGap(
  gap: CandidateGap,
  nodeIds: Map<string, string>,
  edgeIds: Map<string, string>,
  sourceIds: Map<string, string>,
): CandidateGap {
  return {
    ...gap,
    node_id: nodeIds.get(gap.node_id) ?? gap.node_id,
    blocked_decision_ids: gap.blocked_decision_ids.map((id) => nodeIds.get(id) ?? id),
    decision_value: gap.decision_value
      ? {
        ...gap.decision_value,
        affected_targets: gap.decision_value.affected_targets.map((target) => remapDecisionValueTarget(target, nodeIds, edgeIds)),
        strongest_path: gap.decision_value.strongest_path
          ? remapDecisionValueTarget(gap.decision_value.strongest_path, nodeIds, edgeIds)
          : null,
      }
      : undefined,
    guidance: gap.guidance
      ? { ...gap.guidance, supportingIds: gap.guidance.supportingIds.map((id) => mapValue(id, [nodeIds, sourceIds]) ?? id) }
      : undefined,
  };
}

function remapFocusAssessment(assessment: FocusAssessment, maps: Record<string, Map<string, string>>): FocusAssessment {
  return {
    ...clone(assessment),
    targetNodeId: mapValue(assessment.targetNodeId, [maps.nodeIds]),
    executionNodeId: mapValue(assessment.executionNodeId, [maps.nodeIds]),
    representedNodeIds: assessment.representedNodeIds.map((id) => maps.nodeIds.get(id) ?? id),
    sourceNodeIds: assessment.sourceNodeIds.map((id) => maps.nodeIds.get(id) ?? id),
    sourceIds: assessment.sourceIds.map((id) => maps.sourceIds.get(id) ?? id),
    actionNodeId: mapValue(assessment.actionNodeId, [maps.nodeIds]),
  };
}

function remapOverviewAssessment(assessment: ProjectOverviewAssessment, maps: Record<string, Map<string, string>>): ProjectOverviewAssessment {
  const nodeIds = (ids: string[]) => ids.map((id) => maps.nodeIds.get(id) ?? id);
  const historyIds = (ids: string[]) => ids.map((id) => maps.historyIds.get(id) ?? id);
  return {
    ...clone(assessment),
    meaningfulChanges: assessment.meaningfulChanges.map((change) => ({ ...change, sourceNodeIds: nodeIds(change.sourceNodeIds), historyEventIds: historyIds(change.historyEventIds) })),
    goalImpact: {
      ...assessment.goalImpact,
      positiveFactors: assessment.goalImpact.positiveFactors.map((factor) => ({ ...factor, sourceNodeIds: nodeIds(factor.sourceNodeIds) })),
      negativeFactors: assessment.goalImpact.negativeFactors.map((factor) => ({ ...factor, sourceNodeIds: nodeIds(factor.sourceNodeIds) })),
    },
    unsettled: assessment.unsettled.map((item) => ({ ...item, sourceNodeIds: nodeIds(item.sourceNodeIds) })),
    criticalIssues: assessment.criticalIssues.map((issue) => ({ ...issue, sourceNodeIds: nodeIds(issue.sourceNodeIds) })),
    emergingInsights: assessment.emergingInsights.map((insight) => ({ ...insight, sourceNodeIds: nodeIds(insight.sourceNodeIds) })),
  };
}

function remapProject(
  source: Project,
  projectId: string,
  title: string,
  sourceSnapshot: ProjectSnapshot,
  requestId?: string,
): { project: Project; maps: Record<string, Map<string, string>> } {
  const projectIds = new Map([[source.id, projectId]]);
  const nodeIds = new Map(source.nodes.map((node) => [node.id, idFor('node', node.id, projectId)]));
  const edgeIds = new Map(source.edges.map((edge) => [edge.id, idFor('edge', edge.id, projectId)]));
  const sourceIds = new Map(source.sources.map((item) => [item.id, idFor('source', item.id, projectId)]));
  const historyIds = new Map((source.historyEvents ?? []).map((event) => [event.id, idFor('history', event.id, projectId)]));
  const now = new Date().toISOString();
  const branched: Project = {
    ...clone(source),
    id: projectId,
    title,
    created_at: now,
    updated_at: now,
    active_question: source.active_question ? remapCandidateGap(source.active_question, nodeIds, edgeIds, sourceIds) : null,
    history: source.history.map((entry) => ({ ...entry, projectId, nodeId: mapValue(entry.nodeId, [nodeIds]) })),
    historyEvents: (source.historyEvents ?? []).map((event) => remapHistoryEvent(event, projectId, nodeIds, sourceIds, historyIds)),
    sources: source.sources.map((item) => ({ ...item, id: sourceIds.get(item.id) ?? item.id, derived_node_ids: item.derived_node_ids.map((id) => nodeIds.get(id) ?? id) })),
    nodes: source.nodes.map((node) => ({
      ...node,
      id: nodeIds.get(node.id) ?? node.id,
      source_refs: node.source_refs.map((id) => sourceIds.get(id) ?? id),
      canonical_node_id: mapValue(node.canonical_node_id, [nodeIds]),
      canonical_question_id: mapValue(node.canonical_question_id, [nodeIds]),
    })),
    edges: source.edges.map((edge) => ({ ...edge, id: edgeIds.get(edge.id) ?? edge.id, source: nodeIds.get(edge.source) ?? edge.source, target: nodeIds.get(edge.target) ?? edge.target })),
    branch: {
      sourceProjectId: source.id,
      sourceSnapshotId: sourceSnapshot.id,
      sourceProjectTitle: projectTitlePresentation(source.title).title,
      branchedAt: now,
      snapshotCreatedAt: sourceSnapshot.createdAt,
      ...(requestId ? { requestId } : {}),
    },
  };
  const branchEvent: ProjectHistoryEvent = {
    id: boundedId('history', `${projectId}:project_branched:${now}`),
    projectId,
    createdAt: now,
    type: 'project_branched',
    title: `Created from ${projectTitlePresentation(source.title).title}`,
    summary: 'Created from a historical moment in the source project.',
  };
  branched.historyEvents = [...(branched.historyEvents ?? []), branchEvent];
  return { project: branched, maps: { projectIds, nodeIds, edgeIds, sourceIds, historyIds } };
}

function remapAskTarget(target: AskTarget | undefined, nodeIds: Map<string, string>): AskTarget | undefined {
  return target ? { ...target, id: nodeIds.get(target.id) ?? target.id } : undefined;
}

function remapAskSource(source: AskSource, nodeIds: Map<string, string>, sourceIds: Map<string, string>): AskSource {
  return { ...source, id: mapValue(source.id, [nodeIds, sourceIds]) ?? source.id };
}

function remapAsk(
  ask: MaterializedProjectSnapshot['ask'],
  project: Project,
  maps: Record<string, Map<string, string>>,
): MaterializedProjectSnapshot['ask'] {
  const chatIds = new Map(ask.chats.map((chat) => [chat.id, idFor('chat', chat.id, project.id)]));
  const messageIds = new Map(ask.messages.map((message) => [message.id, idFor('message', message.id, project.id)]));
  const proposalIds = new Map(ask.messages.flatMap((message) => (message.contextProposals ?? message.proposals ?? [])
    .map((proposal) => {
      const originalId = proposalIdentity(message.id, proposal);
      return [originalId, idFor('proposal', originalId, project.id)] as const;
    })));
  const researchIds = new Map(ask.research.map((item) => [item.id, idFor('research', item.id, project.id)]));
  const chats = ask.chats.map((chat) => ({
    ...clone(chat),
    id: chatIds.get(chat.id) ?? chat.id,
    projectId: project.id,
    target: remapAskTarget(chat.target, maps.nodeIds),
    adkSessionId: undefined,
  }));
  const messages = ask.messages.map((message) => {
    const proposals = (message.contextProposals ?? message.proposals ?? []).map((proposal) => ({
      ...clone(proposal),
      id: proposalIds.get(proposalIdentity(message.id, proposal))
        ?? idFor('proposal', proposalIdentity(message.id, proposal), project.id),
      sourceMessageId: proposal.sourceMessageId ? messageIds.get(proposal.sourceMessageId) ?? proposal.sourceMessageId : undefined,
    }));
    return {
      ...clone(message),
      id: messageIds.get(message.id) ?? message.id,
      chatId: chatIds.get(message.chatId) ?? message.chatId,
      projectId: project.id,
      resolvesQuestionId: mapValue(message.resolvesQuestionId, [maps.nodeIds]),
      openQuestionIds: message.openQuestionIds?.map((id) => maps.nodeIds.get(id) ?? id),
      openQuestions: message.openQuestions?.map((question) => ({ ...question, id: maps.nodeIds.get(question.id) ?? question.id })),
      sources: message.sources.map((source) => remapAskSource(source, maps.nodeIds, maps.sourceIds)),
      contextProposals: proposals,
      proposals,
    };
  });
  const research = ask.research.map((item) => ({
    ...clone(item),
    id: researchIds.get(item.id) ?? item.id,
    chatId: chatIds.get(item.chatId) ?? item.chatId,
    assistantMessageId: messageIds.get(item.assistantMessageId) ?? item.assistantMessageId,
    projectId: project.id,
    targetQuestionId: mapValue(item.targetQuestionId, [maps.nodeIds]),
    targetDecisionId: mapValue(item.targetDecisionId, [maps.nodeIds]),
    sources: item.sources.map((source) => remapAskSource(source, maps.nodeIds, maps.sourceIds)),
  }));
  return { chats, messages, research };
}

function assertUniqueRemappedIds(label: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new StorageError(`Cannot create project branch: remapped ${label} IDs are not unique.`, 'VALIDATION_ERROR');
    }
    seen.add(id);
  }
}

function assertBranchRemappingIsUnambiguous(project: Project, ask: MaterializedProjectSnapshot['ask']): void {
  assertUniqueRemappedIds('project', [project.id]);
  assertUniqueRemappedIds('node', project.nodes.map((node) => node.id));
  assertUniqueRemappedIds('edge', project.edges.map((edge) => edge.id));
  assertUniqueRemappedIds('source', project.sources.map((source) => source.id));
  assertUniqueRemappedIds('history-event', (project.historyEvents ?? []).map((event) => event.id));
  assertUniqueRemappedIds('chat', ask.chats.map((chat) => chat.id));
  assertUniqueRemappedIds('message', ask.messages.map((message) => message.id));
  assertUniqueRemappedIds('research', ask.research.map((item) => item.id));
  assertUniqueRemappedIds('proposal', ask.messages.flatMap((message) =>
    (message.contextProposals ?? message.proposals ?? []).map((proposal) => {
      if (!proposal.id) {
        throw new StorageError('Cannot create project branch: a proposal is missing its remapped ID.', 'VALIDATION_ERROR');
      }
      return proposal.id;
    })));
}

async function persistedAssessments(userId: string, project: Project): Promise<ProjectSnapshotV2['assessments']> {
  const storage = getStorageProvider();
  const contextPack = await buildContextPackForUser({
    userId,
    query: 'What is the current strategic state of this project?',
    project,
    profile: DEFAULT_USER_PROFILE,
    scope: { type: 'project', projectId: project.id },
    includeBroadContext: true,
  }, { listMemories: async () => storage.getMemories(userId) });
  const focusVersion = await focusProjectStateVersion(project, contextPack, DEFAULT_USER_PROFILE);
  const focusRecord = await storage.getFocusAssessment(userId, focusAssessmentCacheId(project.id, focusVersion));
  const focus = focusRecord?.assessment ?? null;
  const overviewVersion = await overviewProjectStateVersion(project, project.historyEvents ?? [], focus, contextPack);
  const overviewRecord = await storage.getProjectOverviewAssessment(userId, projectOverviewAssessmentCacheId(project.id, overviewVersion));
  const fullBrief = generateDailyBrief({
    userId,
    project,
    memories: await storage.getMemories(userId),
    contextPack,
    force: false,
  });
  const brief = {
    ...fullBrief,
    recommendations: fullBrief.recommendations.map(({ context_pack: _contextPack, ...recommendation }) => recommendation),
  };
  return {
    focus: clone(focus),
    overview: clone(overviewRecord?.assessment ?? null),
    today: {
      brief,
      focusAssessment: clone(focus),
      generatedAt: brief.generated_at,
      projectStateVersion: focusVersion,
    },
  };
}

function snapshotSectionSizes(snapshot: ProjectSnapshotV2): Record<string, number> {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  return {
    projectState: bytes(snapshot.projectState),
    references: bytes(snapshot.references),
    proposalStates: bytes(snapshot.proposalStates),
    assessments: bytes(snapshot.assessments),
  };
}

function assertSnapshotSize(snapshot: ProjectSnapshotV2): void {
  const bytes = serializedProjectSnapshotSize(snapshot);
  if (bytes <= PROJECT_SNAPSHOT_MAX_BYTES) return;
  console.warn('[Project snapshots] manifest exceeds size limit', {
    bytes,
    limit: PROJECT_SNAPSHOT_MAX_BYTES,
    sections: snapshotSectionSizes(snapshot),
  });
  throw new StorageError(`Project snapshot is too large to store (${bytes} bytes).`, 'VALIDATION_ERROR');
}

export async function materializeProjectSnapshot(params: {
  userId: string;
  snapshotId: string;
}): Promise<MaterializedProjectSnapshot> {
  const storage = getStorageProvider();
  const snapshot = await storage.getProjectSnapshot(params.userId, params.snapshotId);
  if (!snapshot || snapshot.userId !== params.userId) {
    throw new StorageError('The requested project snapshot was not found.', 'NOT_FOUND');
  }
  if (!isProjectSnapshotV2(snapshot)) {
    return {
      snapshot,
      project: clone(snapshot.project),
      ask: clone(snapshot.ask),
      assessments: clone(snapshot.assessments),
      missingReferences: [],
    };
  }

  const [sources, chats, messages, research] = await Promise.all([
    storage.getSources(params.userId),
    storage.getAskChats(params.userId),
    storage.getAskMessages(params.userId),
    storage.getAskResearch(params.userId),
  ]);
  const missingReferences: MaterializedProjectSnapshot['missingReferences'] = [];
  const sourceRecords = new Map(sources.map((source) => [source.id, source]));
  const historicalSources = snapshot.projectState.sources.map((metadata) => {
    const source = sourceRecords.get(metadata.id);
    if (!source) {
      missingReferences.push({ type: 'source', id: metadata.id });
      return { ...clone(metadata), content: '' } as Project['sources'][number];
    }
    return { ...clone(metadata), content: source.content } as Project['sources'][number];
  });
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const researchById = new Map(research.map((item) => [item.id, item]));
  const selectedChats = snapshot.references.chatIds.flatMap((id) => {
    const chat = chatsById.get(id);
    if (!chat) missingReferences.push({ type: 'chat', id });
    return chat ? [clone(chat)] : [];
  });
  const proposalStatus = new Map(snapshot.proposalStates.map((state) => [state.proposalId, state.confirmationStatus]));
  const selectedMessages = snapshot.references.messageIds.flatMap((id) => {
    const message = messagesById.get(id);
    if (!message) {
      missingReferences.push({ type: 'message', id });
      return [];
    }
    const apply = (proposal: AskContextProposal): AskContextProposal => {
      const proposalId = proposalIdentity(message.id, proposal);
      return proposalStatus.has(proposalId)
        ? { ...proposal, confirmationStatus: proposalStatus.get(proposalId) }
      : { ...proposal };
    };
    const contextProposals = (message.contextProposals ?? message.proposals ?? []).map(apply);
    return [{ ...clone(message), contextProposals, proposals: contextProposals }];
  });
  const selectedResearch = snapshot.references.researchIds.flatMap((id) => {
    const item = researchById.get(id);
    if (!item) missingReferences.push({ type: 'research', id });
    return item ? [clone(item)] : [];
  });
  const traces = new Set(listTraces(params.userId).map((trace) => trace.id));
  snapshot.references.traceIds.forEach((id) => {
    if (!traces.has(id)) missingReferences.push({ type: 'trace', id });
  });
  const { sources: _sources, ...stateWithoutSources } = clone(snapshot.projectState);
  return {
    snapshot,
    project: { ...stateWithoutSources, sources: historicalSources } as Project,
    ask: { chats: selectedChats, messages: selectedMessages, research: selectedResearch },
    assessments: clone(snapshot.assessments),
    missingReferences,
  };
}

export async function createProjectSnapshot(params: {
  userId: string;
  projectId: string;
  trigger: ProjectSnapshotV2['trigger'];
  label: string;
  summary?: string;
}): Promise<ProjectSnapshotV2> {
  const storage = getStorageProvider();
  const project = await storage.getProject(params.userId, params.projectId);
  if (!project) throw new StorageError('The project for this snapshot was not found.', 'NOT_FOUND');
  const [allChats, allMessages, allResearch] = await Promise.all([
    storage.getAskChats(params.userId),
    storage.getAskMessages(params.userId),
    storage.getAskResearch(params.userId),
  ]);
  const projectChatIds = new Set(allChats.filter((chat) => chat.projectId === project.id).map((chat) => chat.id));
  const messages = allMessages.filter((message) => projectChatIds.has(message.chatId) || message.projectId === project.id);
  const chatIds = [...new Set([...projectChatIds, ...messages.map((message) => message.chatId)])].sort((left, right) => left.localeCompare(right));
  const research = allResearch.filter((item) => chatIds.includes(item.chatId) || item.projectId === project.id);
  const references = {
    sourceIds: sourceReferenceIds(project),
    chatIds,
    messageIds: messages.map((message) => message.id).sort((left, right) => left.localeCompare(right)),
    researchIds: research.map((item) => item.id).sort((left, right) => left.localeCompare(right)),
    traceIds: traceIdsForProject(params.userId, project),
  };
  const snapshotProposalStates = proposalStates(messages);
  const stateVersion = await hashText(JSON.stringify({
    project: stableProjectState(project),
    references,
    proposalStates: snapshotProposalStates,
    research: sorted(research, (item) => item.id).map((item) => ({
      id: item.id,
      text: item.text,
      action: item.action ?? null,
      status: item.status ?? null,
      targetQuestionId: item.targetQuestionId ?? null,
      targetDecisionId: item.targetDecisionId ?? null,
    })),
  }));
  const triggerIdentity = Object.entries(params.trigger)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('|') || params.trigger.type;
  const snapshotId = `${project.id}:snapshot:${params.trigger.type}:${await hashText(`${triggerIdentity}|${stateVersion}|v${SNAPSHOT_SCHEMA_VERSION}`)}`;
  const existing = await storage.getProjectSnapshot(params.userId, snapshotId);
  if (existing) {
    if (!isProjectSnapshotV2(existing)) throw new StorageError('A legacy snapshot uses the current snapshot identity.', 'VALIDATION_ERROR');
    return existing;
  }
  const assessments = await persistedAssessments(params.userId, project);
  const snapshots = await storage.listProjectSnapshots(params.userId, project.id);
  const snapshot: ProjectSnapshotV2 = {
    id: snapshotId,
    userId: params.userId,
    projectId: project.id,
    sequence: Math.max(0, ...snapshots.map((item) => item.sequence)) + 1,
    createdAt: snapshotCreatedAt(project, params.trigger, messages),
    trigger: params.trigger,
    label: params.label,
    ...(params.summary ? { summary: params.summary } : {}),
    projectState: compactProjectState(project),
    references,
    proposalStates: snapshotProposalStates,
    listSummary: {
      counts: {
        nodes: project.nodes.length,
        edges: project.edges.length,
        sources: references.sourceIds.length,
        chats: references.chatIds.length,
        messages: references.messageIds.length,
        pendingProposals: snapshotProposalStates.filter((item) => item.confirmationStatus === 'pending').length,
      },
      ...(assessments.focus?.title ? { focusTitle: assessments.focus.title } : {}),
    },
    assessments,
    schemaVersion: 2,
  };
  assertSnapshotSize(snapshot);
  await storage.saveProjectSnapshot(params.userId, snapshot);
  return snapshot;
}

export async function branchProjectFromSnapshot(params: {
  userId: string;
  snapshotId: string;
  requestedTitle?: string;
  clientRequestId?: string;
}): Promise<{ project: Project; sourceSnapshot: ProjectSnapshot }> {
  const storage = getStorageProvider();
  const snapshot = await storage.getProjectSnapshot(params.userId, params.snapshotId);
  if (!snapshot || snapshot.userId !== params.userId) {
    throw new StorageError('The requested project snapshot was not found.', 'NOT_FOUND');
  }
  const materialized = await materializeProjectSnapshot(params);
  const missingRequired = materialized.missingReferences.filter((item) => item.type !== 'trace');
  if (missingRequired.length > 0) {
    throw new StorageError(`The snapshot cannot be branched because referenced records are missing: ${missingRequired.map((item) => `${item.type}:${item.id}`).join(', ')}.`, 'VALIDATION_ERROR');
  }
  const projects = await storage.listProjects(params.userId);
  if (params.clientRequestId) {
    const existingBranch = projects.find((project) => project.branch?.sourceSnapshotId === snapshot.id && project.branch.requestId === params.clientRequestId);
    if (existingBranch) return { project: existingBranch, sourceSnapshot: snapshot };
  }
  const title = nextProjectTitle(params.requestedTitle?.trim() || materialized.project.title, projects);
  const branchId = boundedId('project', `${snapshot.id}\u0000${title}`);
  if (projects.some((project) => project.id === branchId)) {
    throw new StorageError('Cannot create project branch: generated project ID is not unique.', 'VALIDATION_ERROR');
  }
  const remapped = remapProject(materialized.project, branchId, title, snapshot, params.clientRequestId);
  const ask = remapAsk(materialized.ask, remapped.project, remapped.maps);
  assertBranchRemappingIsUnambiguous(remapped.project, ask);
  await storage.saveProject(params.userId, remapped.project);
  for (const chat of ask.chats) await storage.saveAskChat(params.userId, chat);
  for (const message of ask.messages) await storage.saveAskMessage(params.userId, message);
  for (const item of ask.research) await storage.saveAskResearch(params.userId, item);
  const focus = materialized.assessments.focus ? remapFocusAssessment(materialized.assessments.focus, remapped.maps) : null;
  const overview = materialized.assessments.overview ? remapOverviewAssessment(materialized.assessments.overview, remapped.maps) : null;
  const focusVersion = await focusProjectStateVersion(remapped.project);
  const now = new Date().toISOString();
  await storage.saveFocusAssessment(params.userId, {
    id: focusAssessmentCacheId(remapped.project.id, focusVersion),
    userId: params.userId,
    projectId: remapped.project.id,
    projectStateVersion: focusVersion,
    assessment: focus,
    createdAt: now,
    updatedAt: now,
    provenance: { origin: 'branched_snapshot', sourceSnapshotId: snapshot.id },
  });
  if (overview) {
    const contextPack = await buildContextPackForUser({
      userId: params.userId,
      query: 'What is the current strategic state of this project?',
      project: remapped.project,
      profile: DEFAULT_USER_PROFILE,
      scope: { type: 'project', projectId: remapped.project.id },
      includeBroadContext: true,
    }, { listMemories: async () => storage.getMemories(params.userId) });
    const overviewVersion = await overviewProjectStateVersion(remapped.project, remapped.project.historyEvents ?? [], focus, contextPack);
    await storage.saveProjectOverviewAssessment(params.userId, {
      id: projectOverviewAssessmentCacheId(remapped.project.id, overviewVersion),
      userId: params.userId,
      projectId: remapped.project.id,
      projectStateVersion: overviewVersion,
      assessment: overview,
      createdAt: now,
      updatedAt: now,
      provenance: { origin: 'branched_snapshot', sourceSnapshotId: snapshot.id },
    });
  }
  return { project: remapped.project, sourceSnapshot: snapshot };
}
