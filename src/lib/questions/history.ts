import { Project } from '@/types/clarity';

export type AnsweredQuestion = Project['history'][number];

/** Returns the complete persisted answer history, newest first for the Questions view. */
export function answeredQuestionHistory(project: Pick<Project, 'history'>): AnsweredQuestion[] {
  return [...project.history]
    .filter((entry) => !entry.graph_diff_summary?.startsWith('Response cancelled; reopened'))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}
