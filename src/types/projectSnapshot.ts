import type { AskChatMessage, AskChatSession, AskResearchEvidence } from '@/types/ask';
import type { DailyBrief } from '@/types/attention';
import type { Project } from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import type { ProjectOverviewAssessment } from '@/lib/overview/projectOverviewAssessment';
import type { TraceEvent } from '@/types/observability';

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

export interface SnapshotTodayState {
  brief: DailyBrief;
  focusAssessment: FocusAssessment | null;
  generatedAt: string;
  projectStateVersion: string;
}

/** Trace and Ask execution metadata captured at a completed project moment. */
export interface SnapshotExecutionRecord {
  id: string;
  kind: 'trace' | 'ask';
  createdAt: string;
  trace?: TraceEvent;
  execution?: AskChatMessage['execution'];
  messageId?: string;
}

export interface ProjectSnapshot {
  id: string;
  userId: string;
  projectId: string;
  sequence: number;
  createdAt: string;
  trigger: {
    type: ProjectSnapshotTrigger;
    historyEventId?: string;
    sourceId?: string;
    askMessageId?: string;
    proposalId?: string;
    nodeId?: string;
  };
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
  execution: SnapshotExecutionRecord[];
  schemaVersion: number;
}
