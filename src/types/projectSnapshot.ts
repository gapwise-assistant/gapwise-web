import { normalizeAskContextProposals, type AskChatMessage, type AskChatSession, type AskResearchEvidence } from '@/types/ask';
import type { AttentionCandidate, DailyBrief } from '@/types/attention';
import type { ContextSource, Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';

export type ProjectSnapshotTrigger =
  | 'project_created'
  | 'context_processed'
  | 'ask_response_created'
  | 'ask_proposal_added'
  | 'ask_proposal_dismissed'
  | 'gap_resolved'
  | 'gap_reopened'
  | 'answer_edited'
  | 'decision_confirmed'
  | 'decision_edited'
  | 'action_completed'
  | 'focus_changed';

export interface ProjectSnapshotTriggerDetails {
  type: ProjectSnapshotTrigger;
  historyEventId?: string;
  sourceId?: string;
  askMessageId?: string;
  proposalId?: string;
  nodeId?: string;
}

export interface SnapshotTodayState {
  /** Daily attention state without the full ContextPack embedded in each recommendation. */
  brief: Omit<DailyBrief, 'recommendations'> & {
    recommendations: Array<Omit<AttentionCandidate, 'context_pack'>>;
  };
  focusAssessment: FocusAssessment | null;
  generatedAt: string;
  projectStateVersion: string;
}

/** Source metadata retained in a snapshot. The source body remains in storage. */
export type SnapshotSourceMetadata = Omit<ContextSource, 'content' | 'processing_log'>;

/** The mutable project state at a moment, without duplicating source bodies. */
export type SnapshotProjectState = Omit<Project, 'sources'> & {
  sources: SnapshotSourceMetadata[];
};

/** The original snapshot shape, retained for read-only compatibility. */
export interface ProjectSnapshotV1 {
  id: string;
  userId: string;
  projectId: string;
  sequence: number;
  createdAt: string;
  trigger: ProjectSnapshotTriggerDetails;
  label: string;
  summary?: string;
  project: Project;
  ask: {
    chats: AskChatSession[];
    messages: AskChatMessage[];
    research: AskResearchEvidence[];
  };
  assessments: {
    focus: FocusAssessment | null;
    overview: ProjectOverviewAssessment | null;
    today: SnapshotTodayState | null;
  };
  /** Legacy v1 snapshots may contain full trace payloads. They are never written by v2. */
  execution: Array<{
    id: string;
    kind: 'trace' | 'ask';
    createdAt: string;
    trace?: unknown;
    execution?: AskChatMessage['execution'];
    messageId?: string;
  }>;
  schemaVersion: 1;
}

export interface ProjectSnapshotV2 {
  id: string;
  userId: string;
  projectId: string;
  sequence: number;
  createdAt: string;
  schemaVersion: 2;
  trigger: ProjectSnapshotTriggerDetails;
  label: string;
  summary?: string;
  projectState: SnapshotProjectState;
  references: {
    sourceIds: string[];
    chatIds: string[];
    messageIds: string[];
    researchIds: string[];
    traceIds: string[];
  };
  proposalStates: Array<{
    proposalId: string;
    messageId: string;
    confirmationStatus: 'pending' | 'added' | 'dismissed';
  }>;
  /** Small denormalized index used by History listing without reading the manifest state. */
  listSummary: {
    counts: ProjectSnapshotSummary['counts'];
    focusTitle?: string;
  };
  assessments: {
    focus: FocusAssessment | null;
    overview: ProjectOverviewAssessment | null;
    today: SnapshotTodayState | null;
  };
}

export type ProjectSnapshot = ProjectSnapshotV1 | ProjectSnapshotV2;

export type SnapshotReferencedRecordType = 'source' | 'chat' | 'message' | 'research';

/**
 * Returns whether a live record is part of a snapshot's historical material.
 * V2 deliberately keeps these as references to avoid duplicating large bodies;
 * storage therefore uses this helper to protect the referenced records.
 */
export function snapshotReferencesRecord(
  snapshot: ProjectSnapshot,
  type: SnapshotReferencedRecordType,
  id: string,
): boolean {
  if (isProjectSnapshotV2(snapshot)) {
    const ids = type === 'source'
      ? snapshot.references.sourceIds
      : type === 'chat'
        ? snapshot.references.chatIds
        : type === 'message'
          ? snapshot.references.messageIds
          : snapshot.references.researchIds;
    return ids.includes(id);
  }

  if (type === 'source') return snapshot.project.sources.some((source) => source.id === id);
  if (type === 'chat') return snapshot.ask.chats.some((chat) => chat.id === id);
  if (type === 'message') return snapshot.ask.messages.some((message) => message.id === id);
  return snapshot.ask.research.some((research) => research.id === id);
}

/**
 * Content that must remain stable after a record is referenced by a snapshot.
 * Ask proposal confirmation is intentionally mutable because v2 stores its
 * historical value in proposalStates; the message's actual response remains
 * immutable. Chat updatedAt is likewise live bookkeeping, not chat content.
 */
export function snapshotRecordContent(
  type: SnapshotReferencedRecordType,
  record: unknown,
): unknown {
  if (!record || typeof record !== 'object') return record;
  const value = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;

  if (type === 'source') return { content: value.content };
  if (type === 'chat') {
    delete value.updatedAt;
    return value;
  }
  if (type === 'message') {
    const rawProposals = value.contextProposals ?? value.proposals;
    const proposals = normalizeAskContextProposals(rawProposals).map(({ confirmationStatus: _status, ...proposal }) => proposal);
    delete value.contextProposals;
    delete value.proposals;
    if (Array.isArray(rawProposals)) value.proposalContent = proposals;
    return value;
  }
  return value;
}

export function snapshotRecordContentEqual(
  type: SnapshotReferencedRecordType,
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(snapshotRecordContent(type, left)) === JSON.stringify(snapshotRecordContent(type, right));
}

export interface ProjectSnapshotSummary {
  id: string;
  projectId: string;
  sequence: number;
  createdAt: string;
  trigger: ProjectSnapshotTriggerDetails;
  label: string;
  summary?: string;
  counts: {
    nodes: number;
    edges: number;
    sources: number;
    chats: number;
    messages: number;
    pendingProposals: number;
  };
  focusTitle?: string;
  schemaVersion: number;
}

export interface MaterializedProjectSnapshot {
  snapshot: ProjectSnapshot;
  project: Project;
  ask: {
    chats: AskChatSession[];
    messages: AskChatMessage[];
    research: AskResearchEvidence[];
  };
  assessments: ProjectSnapshotV2['assessments'];
  missingReferences: Array<{
    type: 'source' | 'chat' | 'message' | 'research' | 'trace';
    id: string;
  }>;
}

export const PROJECT_SNAPSHOT_MAX_BYTES = 750_000;

export function isProjectSnapshotV2(snapshot: ProjectSnapshot): snapshot is ProjectSnapshotV2 {
  return snapshot.schemaVersion === 2 && 'projectState' in snapshot;
}

export function serializedProjectSnapshotSize(snapshot: ProjectSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
}

function proposalConfirmationStatus(value: unknown): 'pending' | 'added' | 'dismissed' {
  if (value === 'added') return 'added';
  if (value === 'dismissed') return 'dismissed';
  return 'pending';
}

export function projectSnapshotToSummary(snapshot: ProjectSnapshot): ProjectSnapshotSummary {
  // Firestore History listing reads the v2 index fields only. That projected
  // document has no projectState/references/assessments, but it is still
  // sufficient to build a summary without loading the full manifest.
  if (isProjectSnapshotV2(snapshot) || 'listSummary' in snapshot) {
    const indexed = snapshot as Pick<ProjectSnapshotV2, 'id' | 'projectId' | 'sequence' | 'createdAt' | 'trigger' | 'label' | 'summary' | 'listSummary'>;
    return {
      id: indexed.id,
      projectId: indexed.projectId,
      sequence: indexed.sequence,
      createdAt: indexed.createdAt,
      trigger: indexed.trigger,
      label: indexed.label,
      ...(indexed.summary ? { summary: indexed.summary } : {}),
      counts: {
        nodes: indexed.listSummary.counts.nodes,
        edges: indexed.listSummary.counts.edges,
        sources: indexed.listSummary.counts.sources,
        chats: indexed.listSummary.counts.chats,
        messages: indexed.listSummary.counts.messages,
        pendingProposals: indexed.listSummary.counts.pendingProposals,
      },
      ...(indexed.listSummary.focusTitle ? { focusTitle: indexed.listSummary.focusTitle } : {}),
      schemaVersion: 2,
    };
  }

  const proposals = snapshot.ask.messages.flatMap((message) => message.contextProposals ?? message.proposals ?? []);
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    sequence: snapshot.sequence,
    createdAt: snapshot.createdAt,
    trigger: snapshot.trigger,
    label: snapshot.label,
    ...(snapshot.summary ? { summary: snapshot.summary } : {}),
    counts: {
      nodes: snapshot.project.nodes.length,
      edges: snapshot.project.edges.length,
      sources: snapshot.project.sources.length,
      chats: snapshot.ask.chats.length,
      messages: snapshot.ask.messages.length,
      pendingProposals: proposals.filter((proposal) => proposalConfirmationStatus(proposal.confirmationStatus ?? proposal.status) === 'pending').length,
    },
    ...(snapshot.assessments.focus?.title ? { focusTitle: snapshot.assessments.focus.title } : {}),
    schemaVersion: 1,
  };
}
