import type { AttentionCandidate } from '@/types/attention';
import type { Project, ClarityNode } from '@/types/clarity';
import { todayQuestionFromNode, TodayQuestion } from '@/lib/today/sections';

export type TodayItemType = 'QUESTION' | 'ACTION' | 'DECISION' | 'REMINDER';

export interface TodayFeedItem {
  recommendation: AttentionCandidate;
  itemType: TodayItemType;
  title: string;
  description: string;
  question?: TodayQuestion;
}

function sourceNodes(recommendation: AttentionCandidate, project: Project): ClarityNode[] {
  return recommendation.source_node_ids
    .map((nodeId) => project.nodes.find((node) => node.id === nodeId))
    .filter((node): node is ClarityNode => Boolean(node));
}

function questionNode(nodes: ClarityNode[]): ClarityNode | undefined {
  return nodes.find((node) => node.type === 'UNKNOWN' || node.type === 'ASSUMPTION');
}

export function todayItemType(recommendation: AttentionCandidate, project: Project): TodayItemType {
  if (recommendation.kind === 'commitment') return 'REMINDER';
  const nodes = sourceNodes(recommendation, project);
  if (questionNode(nodes)) return 'QUESTION';
  if (nodes.some((node) => node.type === 'DECISION')) return 'DECISION';
  return 'ACTION';
}

function actionableNode(nodes: ClarityNode[]): ClarityNode | undefined {
  return nodes.find((node) => ['NEXT_ACTION', 'DECISION', 'RISK'].includes(node.type));
}

function displayTitle(recommendation: AttentionCandidate, itemType: TodayItemType, project: Project): string {
  const nodes = sourceNodes(recommendation, project);
  if (itemType === 'QUESTION') return questionNode(nodes)?.text ?? recommendation.next_action;
  if (itemType === 'DECISION') return actionableNode(nodes)?.text ?? recommendation.title;
  if (itemType === 'ACTION' && recommendation.kind === 'risk') {
    return recommendation.next_action.replace(/^Decide a mitigation for:\s*/i, '') || recommendation.title;
  }
  return recommendation.title;
}

function displayDescription(recommendation: AttentionCandidate, itemType: TodayItemType): string {
  const reason = recommendation.reason.trim();
  const blockedDecision = reason.match(/^Blocks decision:\s*"(.+)"$/i);
  if (blockedDecision) return `This question is blocking ${blockedDecision[1]}.`;
  if (/^Blocks primary project goal execution$/i.test(reason)) {
    return itemType === 'QUESTION'
      ? 'Answering this reduces uncertainty around the current project direction.'
      : 'This is the next useful step for the current project direction.';
  }
  if (/^High downstream impact/i.test(reason)) return 'This can change an important downstream decision.';
  if (/^Currently unverified/i.test(reason)) return 'The available evidence is still incomplete.';
  if (/^Determines the 4-minute hackathon demo scenario/i.test(reason)) return 'This could shape the next important project decision.';
  return reason;
}

function matchingQuestion(recommendation: AttentionCandidate, questions: TodayQuestion[], project: Project): TodayQuestion | undefined {
  const existing = questions.find((question) => question.sourceNodeIds.some((nodeId) => recommendation.source_node_ids.includes(nodeId)));
  if (existing) return existing;
  const node = questionNode(sourceNodes(recommendation, project));
  return node ? todayQuestionFromNode(project, node) : undefined;
}

function underlyingKey(itemType: TodayItemType, recommendation: AttentionCandidate, project: Project): string {
  const nodes = sourceNodes(recommendation, project);
  const primaryNode = itemType === 'QUESTION' ? questionNode(nodes) : actionableNode(nodes);
  if (primaryNode) return `${itemType}:${primaryNode.id}`;
  return `${itemType}:${recommendation.id}`;
}

export function buildTodayFeed(
  recommendations: AttentionCandidate[],
  questions: TodayQuestion[],
  project: Project,
  limit = 5,
): TodayFeedItem[] {
  const seen = new Set<string>();
  const items: TodayFeedItem[] = [];

  recommendations.forEach((recommendation) => {
    const itemType = todayItemType(recommendation, project);
    const key = underlyingKey(itemType, recommendation, project);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      recommendation,
      itemType,
      title: displayTitle(recommendation, itemType, project),
      description: displayDescription(recommendation, itemType),
      question: itemType === 'QUESTION' ? matchingQuestion(recommendation, questions, project) : undefined,
    });
  });

  return items.slice(0, limit);
}
