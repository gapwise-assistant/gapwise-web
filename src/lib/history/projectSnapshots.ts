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
import type { ProjectSnapshot, SnapshotExecutionRecord } from '@/types/projectSnapshot';

const SNAPSHOT_SCHEMA_VERSION = 1;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return values.slice().sort((left, right) => key(left).localeCompare(key(right)));
}

function semanticProjectState(project: Project): unknown {
  return {
    title: project.title,
    goal: project.goal,
    deadline: project.deadline ?? null,
    status: project.status ?? 'active',
    one_sentence_context: project.one_sentence_context ?? null,
    nodes: sorted(project.nodes, (node) => node.id).map((node) => ({
      id: node.id,
      type: node.type,
      text: node.text,
      status: node.status,
      confidence: node.confidence,
      impact: node.impact,
      source_refs: sorted(node.source_refs, (value) => value),
      decision_outcome: node.decision_outcome ?? null,
      canonical_node_id: node.canonical_node_id ?? null,
      canonical_question_id: node.canonical_question_id ?? null,
    })),
    edges: sorted(project.edges, (edge) => `${edge.source}:${edge.type}:${edge.target}`).map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
    })),
    sources: sorted(project.sources, (source) => source.id).map((source) => ({
      id: source.id,
      filename: source.filename,
      type: source.type,
      content: source.content,
      derived_node_ids: sorted(source.derived_node_ids, (value) => value),
      extraction_summary: source.extraction_summary ?? null,
    })),
    history: sorted(project.history, (entry) => `${entry.question}\u0000${entry.timestamp}\u0000${entry.answer}`).map((entry) => ({
      question: entry.question,
      answer: entry.answer,
      graph_diff_summary: entry.graph_diff_summary,
      nodeId: entry.nodeId ?? null,
    })),
    historyEvents: sorted(project.historyEvents ?? [], (event) => event.id).map((event) => ({
      type: event.type,
      title: event.title,
      summary: event.summary ?? null,
      primaryNodeId: event.primaryNodeId ?? null,
      sourceNodeIds: sorted(event.sourceNodeIds ?? [], (value) => value),
      affectedNodeIds: sorted(event.affectedNodeIds ?? [], (value) => value),
      changes: (event.changes ?? []).map((change) => ({
        kind: change.kind,
        text: change.text,
        nodeId: change.nodeId ?? null,
      })),
    })),
  };
}

function proposalState(messages: AskChatMessage[]): unknown {
  return sorted(messages, (message) => message.id).map((message) => ({
    id: message.id,
    chatId: message.chatId,
    role: message.role,
    text: message.text,
    outcome: message.outcome ?? null,
    conclusion: message.conclusion ?? null,
    contextProposals: (message.contextProposals ?? message.proposals ?? []).map((proposal) => ({
      id: proposal.id ?? null,
      type: proposal.type,
      text: proposal.text,
      status: proposal.status,
      confirmationStatus: proposal.confirmationStatus ?? 'pending',
      sourceMessageId: proposal.sourceMessageId ?? null,
    })),
  }));
}

function idFor(prefix: string, value: string, projectId: string): string {
  return `${prefix}_${projectId}_${value}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 240);
}

function validIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : value;
}

function snapshotCreatedAt(
  project: Project,
  trigger: ProjectSnapshot['trigger'],
  chats: AskChatSession[],
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

  return validIso(
    historyEvent?.createdAt
      ?? message?.createdAt
      ?? proposalMessage?.createdAt
      ?? source?.processed_at
      ?? source?.extracted_at
      ?? node?.updated_at
      ?? project.updated_at
      ?? project.created_at,
  ) ?? new Date(0).toISOString();
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

function remapDeep<T>(value: T, maps: Map<string, string>[]): T {
  if (typeof value === 'string') return (mapValue(value, maps) ?? value) as T;
  if (Array.isArray(value)) return value.map((item) => remapDeep(item, maps)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, remapDeep(item, maps)]),
  ) as T;
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
    primarySnapshot: event.primarySnapshot
      ? remapHistoryNodeSnapshot(event.primarySnapshot, nodeIds)
      : undefined,
    changes: event.changes?.map((change) => remapHistoryChange(change, nodeIds)),
    focusBefore: event.focusBefore
      ? remapHistoryFocus(event.focusBefore, nodeIds, sourceIds)
      : undefined,
    focusAfter: event.focusAfter
      ? remapHistoryFocus(event.focusAfter, nodeIds, sourceIds)
      : undefined,
  };
}

function remapHistoryNodeSnapshot(
  snapshot: HistoryNodeSnapshot,
  nodeIds: Map<string, string>,
): HistoryNodeSnapshot {
  return {
    ...snapshot,
    nodeId: mapValue(snapshot.nodeId, [nodeIds]),
  };
}

function remapHistoryChange(
  change: ProjectHistoryChange,
  nodeIds: Map<string, string>,
): ProjectHistoryChange {
  return {
    ...change,
    nodeId: mapValue(change.nodeId, [nodeIds]),
    snapshot: change.snapshot
      ? remapHistoryNodeSnapshot(change.snapshot, nodeIds)
      : undefined,
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

function remapDecisionValueTarget(
  target: DecisionValueTarget,
  nodeIds: Map<string, string>,
  edgeIds: Map<string, string>,
): DecisionValueTarget {
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
        affected_targets: gap.decision_value.affected_targets.map((target) =>
          remapDecisionValueTarget(target, nodeIds, edgeIds)),
        strongest_path: gap.decision_value.strongest_path
          ? remapDecisionValueTarget(gap.decision_value.strongest_path, nodeIds, edgeIds)
          : null,
      }
      : undefined,
    guidance: gap.guidance
      ? {
        ...gap.guidance,
        supportingIds: gap.guidance.supportingIds.map((id) => mapValue(id, [nodeIds, sourceIds]) ?? id),
      }
      : undefined,
  };
}

function remapFocusAssessment(
  assessment: FocusAssessment,
  maps: Record<string, Map<string, string>>,
): FocusAssessment {
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

function remapOverviewAssessment(
  assessment: ProjectOverviewAssessment,
  maps: Record<string, Map<string, string>>,
): ProjectOverviewAssessment {
  const nodeIds = (ids: string[]) => ids.map((id) => maps.nodeIds.get(id) ?? id);
  const historyIds = (ids: string[]) => ids.map((id) => maps.historyIds.get(id) ?? id);
  return {
    ...clone(assessment),
    meaningfulChanges: assessment.meaningfulChanges.map((change) => ({
      ...change,
      sourceNodeIds: nodeIds(change.sourceNodeIds),
      historyEventIds: historyIds(change.historyEventIds),
    })),
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
  snapshot: ProjectSnapshot,
  requestId?: string,
): { project: Project; maps: Record<string, Map<string, string>> } {
  const projectIds = new Map([[source.id, projectId]]);
  const nodeIds = new Map(source.nodes.map((node) => [node.id, idFor('node', node.id, projectId)]));
  const edgeIds = new Map(source.edges.map((edge) => [edge.id, idFor('edge', edge.id, projectId)]));
  const sourceIds = new Map(source.sources.map((item) => [item.id, idFor('source', item.id, projectId)]));
  const historyIds = new Map((source.historyEvents ?? []).map((event) => [event.id, idFor('history', event.id, projectId)]));
  const chats = snapshot.ask.chats;
  const messages = snapshot.ask.messages;
  const research = snapshot.ask.research;
  const chatIds = new Map(chats.map((chat) => [chat.id, idFor('chat', chat.id, projectId)]));
  const messageIds = new Map(messages.map((message) => [message.id, idFor('message', message.id, projectId)]));
  const proposalIds = new Map(messages.flatMap((message) => (message.contextProposals ?? message.proposals ?? [])
    .filter((proposal): proposal is typeof proposal & { id: string } => Boolean(proposal.id))
    .map((proposal) => [proposal.id, idFor('proposal', proposal.id, projectId)])));
  const researchIds = new Map(research.map((item) => [item.id, idFor('research', item.id, projectId)]));
  const now = new Date().toISOString();
  const branched: Project = {
    ...clone(source),
    id: projectId,
    title,
    created_at: now,
    updated_at: now,
    active_question: source.active_question
      ? remapCandidateGap(source.active_question, nodeIds, edgeIds, sourceIds)
      : null,
    history: source.history.map((entry) => ({
      ...entry,
      projectId,
      nodeId: mapValue(entry.nodeId, [nodeIds]),
    })),
    historyEvents: (source.historyEvents ?? []).map((event) =>
      remapHistoryEvent(event, projectId, nodeIds, sourceIds, historyIds)),
    sources: source.sources.map((item) => ({
      ...item,
      id: sourceIds.get(item.id) ?? item.id,
      derived_node_ids: item.derived_node_ids.map((id) => nodeIds.get(id) ?? id),
    })),
    nodes: source.nodes.map((node) => ({
      ...node,
      id: nodeIds.get(node.id) ?? node.id,
      source_refs: node.source_refs.map((id) => sourceIds.get(id) ?? id),
      canonical_node_id: mapValue(node.canonical_node_id, [nodeIds]),
      canonical_question_id: mapValue(node.canonical_question_id, [nodeIds]),
    })),
    edges: source.edges.map((edge) => ({
      ...edge,
      id: edgeIds.get(edge.id) ?? edge.id,
      source: nodeIds.get(edge.source) ?? edge.source,
      target: nodeIds.get(edge.target) ?? edge.target,
    })),
    branch: {
      sourceProjectId: source.id,
      sourceSnapshotId: snapshot.id,
      sourceProjectTitle: source.title,
      branchedAt: now,
      snapshotCreatedAt: snapshot.createdAt,
      ...(requestId ? { requestId } : {}),
    },
  };
  const branchEvent: ProjectHistoryEvent = {
    id: `${projectId}:history:project_branched:${now}`,
    projectId,
    createdAt: now,
    type: 'project_branched',
    title: `Created from ${source.title}`,
    summary: `Created from the historical moment on ${new Date(snapshot.createdAt).toLocaleString()}.`,
  };
  branched.historyEvents = [...(branched.historyEvents ?? []), branchEvent];
  return { project: branched, maps: { projectIds, nodeIds, edgeIds, sourceIds, historyIds, chatIds, messageIds, proposalIds, researchIds } };
}

function remapAskTarget(
  target: AskTarget | undefined,
  nodeIds: Map<string, string>,
): AskTarget | undefined {
  if (!target) return undefined;
  return {
    ...target,
    id: nodeIds.get(target.id) ?? target.id,
  };
}

function remapAskSource(
  source: AskSource,
  nodeIds: Map<string, string>,
  sourceIds: Map<string, string>,
): AskSource {
  return {
    ...source,
    id: mapValue(source.id, [nodeIds, sourceIds]) ?? source.id,
  };
}

function remapAskProposal(
  proposal: AskContextProposal,
  messageIds: Map<string, string>,
  proposalIds: Map<string, string>,
): AskContextProposal {
  return {
    ...proposal,
    id: proposal.id ? proposalIds.get(proposal.id) ?? proposal.id : undefined,
    sourceMessageId: proposal.sourceMessageId
      ? messageIds.get(proposal.sourceMessageId) ?? proposal.sourceMessageId
      : undefined,
  };
}

function remapAsk(
  snapshot: ProjectSnapshot,
  project: Project,
  maps: Record<string, Map<string, string>>,
): { chats: AskChatSession[]; messages: AskChatMessage[]; research: AskResearchEvidence[] } {
  const chats = snapshot.ask.chats.map((chat) => ({
    ...clone(chat),
    id: maps.chatIds.get(chat.id) ?? chat.id,
    projectId: project.id,
    target: remapAskTarget(chat.target, maps.nodeIds),
    // ADK sessions are external execution state and must not be reused by a branch.
    adkSessionId: undefined,
  }));
  const messages = snapshot.ask.messages.map((message) => {
    const proposals = (message.contextProposals ?? message.proposals ?? []).map((proposal) => ({
      ...remapAskProposal(proposal, maps.messageIds, maps.proposalIds),
    }));
    return {
      ...clone(message),
      id: maps.messageIds.get(message.id) ?? message.id,
      chatId: maps.chatIds.get(message.chatId) ?? message.chatId,
      projectId: project.id,
      resolvesQuestionId: mapValue(message.resolvesQuestionId, [maps.nodeIds]),
      openQuestionIds: message.openQuestionIds?.map((id) => maps.nodeIds.get(id) ?? id),
      openQuestions: message.openQuestions?.map((question) => ({
        ...question,
        id: maps.nodeIds.get(question.id) ?? question.id,
      })),
      sources: message.sources.map((source) => remapAskSource(source, maps.nodeIds, maps.sourceIds)),
      contextProposals: proposals,
      proposals,
    };
  });
  const research = snapshot.ask.research.map((item) => ({
    ...clone(item),
    id: maps.researchIds.get(item.id) ?? item.id,
    chatId: maps.chatIds.get(item.chatId) ?? item.chatId,
    assistantMessageId: maps.messageIds.get(item.assistantMessageId) ?? item.assistantMessageId,
    projectId: project.id,
    targetQuestionId: mapValue(item.targetQuestionId, [maps.nodeIds]),
    targetDecisionId: mapValue(item.targetDecisionId, [maps.nodeIds]),
    sources: item.sources.map((source) => remapAskSource(source, maps.nodeIds, maps.sourceIds)),
  }));
  return { chats, messages, research };
}

async function persistedAssessments(
  userId: string,
  project: Project,
  askMessages: AskChatMessage[],
): Promise<{
  focus: FocusAssessment | null;
  overview: ProjectSnapshot['assessments']['overview'];
  today: ProjectSnapshot['assessments']['today'];
  execution: SnapshotExecutionRecord[];
}> {
  const storage = getStorageProvider();
  const contextPack = await buildContextPackForUser({
    userId,
    query: 'What is the current strategic state of this project?',
    project,
    profile: DEFAULT_USER_PROFILE,
    scope: { type: 'project', projectId: project.id },
    includeBroadContext: true,
  }, {
    listMemories: async () => storage.getMemories(userId),
  });
  const focusVersion = await focusProjectStateVersion(project, contextPack, DEFAULT_USER_PROFILE);
  const focusRecord = await storage.getFocusAssessment(userId, focusAssessmentCacheId(project.id, focusVersion));
  const focus = focusRecord?.assessment ?? null;
  const overviewVersion = await overviewProjectStateVersion(project, project.historyEvents ?? [], focus, contextPack);
  const overviewRecord = await storage.getProjectOverviewAssessment(
    userId,
    projectOverviewAssessmentCacheId(project.id, overviewVersion),
  );
  const memories = await storage.getMemories(userId);
  const brief = generateDailyBrief({
    userId,
    project,
    memories,
    contextPack,
    force: false,
  });
  const today = {
    brief,
    focusAssessment: focus,
    generatedAt: brief.generated_at,
    projectStateVersion: focusVersion,
  };
  const projectOwnedIds = new Set([
    project.id,
    ...project.nodes.map((node) => node.id),
    ...project.sources.map((source) => source.id),
    ...(project.historyEvents ?? []).map((event) => event.id),
  ]);
  const execution: SnapshotExecutionRecord[] = [
    ...listTraces(userId)
      .filter((trace) => trace.decisionMapActivity?.projectId === project.id
        || trace.contextIds.some((id) => projectOwnedIds.has(id))
        || trace.askGraphReasoningContext?.selectedNodeIds.some((id) => projectOwnedIds.has(id)))
      .map((trace) => ({
      id: trace.id,
      kind: 'trace' as const,
      createdAt: trace.started_at,
      trace,
      })),
    ...askMessages
      .filter((message) => message.role === 'assistant' && message.execution)
      .map((message) => ({
        id: `${message.id}:execution`,
        kind: 'ask' as const,
        createdAt: message.createdAt,
        execution: message.execution,
        messageId: message.id,
      })),
  ];
  return { focus, overview: overviewRecord?.assessment ?? null, today, execution };
}

export async function createProjectSnapshot(params: {
  userId: string;
  projectId: string;
  trigger: ProjectSnapshot['trigger'];
  label: string;
  summary?: string;
}): Promise<ProjectSnapshot> {
  const storage = getStorageProvider();
  const project = await storage.getProject(params.userId, params.projectId);
  if (!project) throw new StorageError('The project for this snapshot was not found.', 'VALIDATION_ERROR');
  const allChats = await storage.getAskChats(params.userId);
  const allMessages = await storage.getAskMessages(params.userId);
  const projectChatIds = new Set(
    allChats.filter((chat) => chat.projectId === project.id).map((chat) => chat.id),
  );
  const messages = allMessages.filter((message) =>
    projectChatIds.has(message.chatId) || message.projectId === project.id,
  );
  const chatIds = new Set([
    ...projectChatIds,
    ...messages.map((message) => message.chatId),
  ]);
  const chats = allChats.filter((chat) => chatIds.has(chat.id));
  const allResearch = await storage.getAskResearch(params.userId);
  const research = allResearch.filter((item) => chatIds.has(item.chatId) || item.projectId === project.id);
  const stateVersion = await hashText(JSON.stringify({
    project: semanticProjectState(project),
    ask: proposalState(messages),
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
  if (existing) return existing;
  const assessments = await persistedAssessments(params.userId, project, messages);
  const snapshots = await storage.listProjectSnapshots(params.userId, project.id);
  const createdAt = snapshotCreatedAt(project, params.trigger, chats, messages);
  const snapshot: ProjectSnapshot = {
    id: snapshotId,
    userId: params.userId,
    projectId: project.id,
    sequence: Math.max(0, ...snapshots.map((item) => item.sequence)) + 1,
    createdAt,
    trigger: params.trigger,
    label: params.label,
    ...(params.summary ? { summary: params.summary } : {}),
    project: clone(project),
    ask: { chats: clone(chats), messages: clone(messages), research: clone(research) },
    assessments: {
      focus: clone(assessments.focus),
      overview: clone(assessments.overview),
      today: clone(assessments.today),
    },
    execution: clone(assessments.execution),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  };
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
    throw new StorageError('The requested project snapshot was not found.', 'PERMISSION_DENIED');
  }
  const projects = await storage.listProjects(params.userId);
  if (params.clientRequestId) {
    const existingBranch = projects.find((project) =>
      project.branch?.sourceSnapshotId === snapshot.id
      && project.branch.requestId === params.clientRequestId,
    );
    if (existingBranch) return { project: existingBranch, sourceSnapshot: snapshot };
  }
  const title = nextProjectTitle(params.requestedTitle?.trim() || snapshot.project.title, projects);
  const identity = params.clientRequestId
    ? await hashText(`${snapshot.id}|${params.clientRequestId}`)
    : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const branchId = `project_${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'branch'}_${identity.slice(0, 24)}`;
  const remapped = remapProject(snapshot.project, branchId, title, snapshot, params.clientRequestId);
  const ask = remapAsk(snapshot, remapped.project, remapped.maps);
  await storage.saveProject(params.userId, remapped.project);
  for (const chat of ask.chats) await storage.saveAskChat(params.userId, chat);
  for (const message of ask.messages) await storage.saveAskMessage(params.userId, message);
  for (const item of ask.research) await storage.saveAskResearch(params.userId, item);

  const focus = snapshot.assessments.focus
    ? remapFocusAssessment(snapshot.assessments.focus, remapped.maps)
    : null;
  const overview = snapshot.assessments.overview
    ? remapOverviewAssessment(snapshot.assessments.overview, remapped.maps)
    : null;
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
  } as Parameters<typeof storage.saveFocusAssessment>[1]);
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
    } as Parameters<typeof storage.saveProjectOverviewAssessment>[1]);
  }
  return { project: remapped.project, sourceSnapshot: snapshot };
}
