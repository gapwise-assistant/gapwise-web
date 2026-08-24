import { ClarityEdge, ClarityNode, Project } from '@/types/clarity';
import { calculateClarityScore, calculateGapPriority, selectTopGap } from '@/lib/prioritization';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { UserMemoryProfile } from '@/types/clarity';
import { projectForReasoning } from '@/lib/context/sourceState';
import { classifyAnswer } from '@/lib/questions/answerClassification';
import { canonicalQuestionGroups } from '@/lib/questions/canonical';
import { resolveSatisfiedNextActions } from '@/lib/actions/completion';
import { appendGapResolvedHistory } from '@/lib/history/projectHistory';

function timestampId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createGraphNode(
  project: Project,
  node: Omit<ClarityNode, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'status'>
): ClarityNode {
  const now = new Date().toISOString();
  const created: ClarityNode = {
    ...node,
    id: timestampId('node'),
    status: node.type === 'UNKNOWN' || node.type === 'ASSUMPTION' ? 'OPEN' : 'RESOLVED',
    created_by: 'agent',
    created_at: now,
    updated_at: now,
  };
  project.nodes.push(created);
  return created;
}

export function createGraphEdge(project: Project, edge: Omit<ClarityEdge, 'id'>): ClarityEdge {
  const created: ClarityEdge = {
    ...edge,
    id: timestampId('edge'),
  };
  project.edges.push(created);
  return created;
}

export function resolveGap(
  project: Project,
  nodeId: string,
  resolutionText: string,
  profile: UserMemoryProfile = DEFAULT_USER_PROFILE
): Project {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const canonicalGroup = canonicalQuestionGroups(updated).find((group) => group.nodeIds.includes(nodeId));
  const canonicalId = canonicalGroup?.canonical.id ?? nodeId;
  const gap = updated.nodes.find((node) => node.id === canonicalId);
  if (!gap) return updated;

  const now = new Date().toISOString();
  const questionText = gap.text;
  gap.status = 'RESOLVED';
  gap.confidence = 1;
  gap.updated_at = now;

  const classification = classifyAnswer(gap, resolutionText, updated);
  const understanding = createGraphNode(updated, {
    type: classification.type,
    text: classification.text,
    confidence: 1,
    impact: gap.impact,
    source_refs: gap.source_refs,
    x: gap.x ? gap.x + 30 : undefined,
    y: gap.y ? gap.y + 80 : undefined,
  });
  understanding.created_by = 'user';
  createGraphEdge(updated, { source: understanding.id, target: gap.id, type: 'resolves' });
  if (classification.supersedesOriginal) {
    createGraphEdge(updated, { source: understanding.id, target: gap.id, type: 'supersedes' });
  }
  resolveSatisfiedNextActions(updated, now);

  updated.history.push({
    question: gap.text,
    answer: resolutionText,
    timestamp: now,
    graph_diff_summary: `Resolved "${gap.text}" -> ${classification.type}: "${classification.text}"`,
  });

  updated.clarity_score = calculateClarityScore(updated);
  updated.active_question = selectTopGap(updated, profile);
  updated.updated_at = now;
  return appendGapResolvedHistory(project, updated, {
    nodeId: gap.id,
    question: questionText,
    answer: resolutionText,
    createdAt: now,
  });
}

export function rankGaps(project: Project) {
  const reasoningProject = projectForReasoning(project);
  return reasoningProject.nodes
    .filter((node) => (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION') && node.status === 'OPEN')
    .map((node) => calculateGapPriority(node, reasoningProject, DEFAULT_USER_PROFILE))
    .sort((a, b) => b.priority - a.priority || a.node_id.localeCompare(b.node_id));
}
