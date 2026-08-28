import { createHash } from 'node:crypto';
import type { Project } from '@/types/clarity';

function stableHistoryEvent(event: NonNullable<Project['historyEvents']>[number]) {
  return {
    type: event.type,
    title: event.title,
    summary: event.summary ?? null,
    primarySnapshot: event.primarySnapshot
      ? { text: event.primarySnapshot.text, type: event.primarySnapshot.type, status: event.primarySnapshot.status }
      : null,
    affectedNodes: (event.affectedNodes ?? []).map((node) => ({ text: node.text, type: node.type, status: node.status })),
    changes: (event.changes ?? []).map((change) => ({
      kind: change.kind,
      text: change.text,
      snapshot: change.snapshot
        ? { text: change.snapshot.text, type: change.snapshot.type, status: change.snapshot.status }
        : null,
    })),
    focusBefore: event.focusBefore?.title ?? null,
    focusAfter: event.focusAfter?.title ?? null,
  };
}

function isAskSource(filename: string): boolean {
  return /^ask\s/i.test(filename.trim());
}

/** A stable hash of project understanding, excluding persistence metadata. */
export function semanticProjectState(project: Project) {
  return {
    title: project.title,
    goal: project.goal,
    deadline: project.deadline ?? null,
    nodes: project.nodes
      .filter((node) => node.status !== 'DEPRECATED')
      .map((node) => ({
        id: node.id,
        type: node.type,
        text: node.text,
        status: node.status,
        confidence: node.confidence,
        impact: node.impact,
        decision_outcome: node.decision_outcome ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: project.edges
      .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }))
      .sort((left, right) => `${left.source}\u0000${left.target}\u0000${left.type}`.localeCompare(`${right.source}\u0000${right.target}\u0000${right.type}`)),
    unrepresentedContext: [...new Set(
      project.sources
        .filter((source) => source.semantic_contribution !== false
          && source.derived_node_ids.length === 0
          && !isAskSource(source.filename))
        .map((source) => source.content),
    )].sort((left, right) => left.localeCompare(right)),
    answers: project.history
      .map((entry) => ({ question: entry.question, answer: entry.answer, graph_diff_summary: entry.graph_diff_summary }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    historyEvents: (project.historyEvents ?? [])
      .map(stableHistoryEvent)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
}

export function semanticProjectVersion(project: Project): string {
  return createHash('sha256').update(JSON.stringify(semanticProjectState(project))).digest('hex');
}
