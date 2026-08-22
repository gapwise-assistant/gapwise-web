import type { AttentionCandidate } from '@/types/attention';
import type { Project, ClarityNode } from '@/types/clarity';
import { todayQuestionFromNode, TodayQuestion } from '@/lib/today/sections';
import { calendarTimestampFromText } from '@/lib/google/calendarFormatting';
import { canonicalQuestionGroups, semanticallyEquivalentQuestion } from '@/lib/questions/canonical';

export type TodayItemType = 'QUESTION' | 'ACTION' | 'DECISION' | 'REMINDER';

export interface TodayFeedItem {
  recommendation: AttentionCandidate;
  itemType: TodayItemType;
  title: string;
  description: string;
  calendarStart?: string;
  calendarEnd?: string;
  calendarSource?: string;
  calendarCommitmentId?: string;
  question?: TodayQuestion;
  decisionNodeId?: string;
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
  // Only explicit graph actions belong in the ACTION lane. Risks and negative
  // facts are evidence for a question, not tasks the user can mark
  // Done/Snooze from Today.
  if (nodes.some((node) => node.type === 'NEXT_ACTION')) {
    return 'ACTION';
  }
  return 'DECISION';
}

export function compactQuestionContext(item: TodayFeedItem, project: Project): string {
  const decision = item.decisionNodeId
    ? project.nodes.find((node) => node.id === item.decisionNodeId)
    : undefined;
  if (decision) return `Your answer will shape “${decision.text.replace(/\s+/g, ' ').trim()}”.`;
  if (/conflict|contradict/i.test(item.recommendation.reason)) return 'This conflicts with a recorded preference or assumption.';
  return 'Your answer will guide the next project decision.';
}

export function compactQuestionReason(reason: string): string {
  if (/\b(?:blocks?|affects?|depends on|blocked by)\b/i.test(reason)) {
    return 'Your answer will shape the next project decision.';
  }
  if (/^this unresolved item/i.test(reason)) return 'This uncertainty can affect the next project decision.';
  return reason;
}

function actionableNode(nodes: ClarityNode[]): ClarityNode | undefined {
  return nodes.find((node) => ['NEXT_ACTION', 'DECISION'].includes(node.type));
}

function displayTitle(recommendation: AttentionCandidate, itemType: TodayItemType, project: Project): string {
  const nodes = sourceNodes(recommendation, project);
  if (itemType === 'QUESTION') return questionNode(nodes)?.text ?? recommendation.next_action;
  if (itemType === 'REMINDER') return recommendation.title.replace(/^Prepare for\s+/i, '');
  if (itemType === 'DECISION') return actionableNode(nodes)?.text ?? recommendation.title;
  return recommendation.title;
}

function displayDescription(recommendation: AttentionCandidate, itemType: TodayItemType, title: string): string {
  const reason = recommendation.reason.trim();
  const blockedDecision = reason.match(/^Blocks decision:\s*"(.+)"$/i);
  if (blockedDecision) return 'This question could change the next project decision.';
  if (/^Blocks primary project goal execution$/i.test(reason)) {
    return itemType === 'QUESTION'
      ? 'Answering this reduces uncertainty around the current project direction.'
      : 'This is the next useful step for the current project direction.';
  }
  if (/^High downstream impact/i.test(reason)) return 'This can change an important downstream decision.';
  if (/^Currently unverified/i.test(reason)) return 'The available evidence is still incomplete.';
  if (/^Determines the 4-minute hackathon demo scenario/i.test(reason)) return 'This could shape the next important project decision.';
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized(reason) === normalized(title) ? '' : reason;
}

function calendarCommitmentFor(recommendation: AttentionCandidate): ClarityNode | undefined {
  const commitments = recommendation.context_pack.upcomingCommitments;
  return commitments.find((commitment) => recommendation.source_node_ids.includes(commitment.id))
    ?? commitments.find((commitment) => commitment.source_refs.some((ref) => ref.startsWith('gcal_')));
}

function matchingQuestion(recommendation: AttentionCandidate, questions: TodayQuestion[], project: Project): TodayQuestion | undefined {
  const sourceQuestion = questionNode(sourceNodes(recommendation, project));
  const existing = questions.find((question) => question.sourceNodeIds.some((nodeId) => recommendation.source_node_ids.includes(nodeId))
    || (sourceQuestion && semanticallyEquivalentQuestion(question.question, sourceQuestion.text)));
  if (existing) return existing;
  return sourceQuestion ? todayQuestionFromNode(project, sourceQuestion) : undefined;
}

function linkedDecisionNodeId(recommendation: AttentionCandidate, project: Project): string | undefined {
  const nodes = sourceNodes(recommendation, project);
  const directDecision = nodes.find((node) => node.type === 'DECISION');
  if (directDecision) return directDecision.id;

  const question = questionNode(nodes);
  if (!question) return undefined;
  const edge = project.edges.find((candidate) =>
    ['blocks', 'depends_on', 'affects', 'informs'].includes(candidate.type) &&
    (candidate.source === question.id || candidate.target === question.id) &&
    project.nodes.some((node) => node.id === (candidate.source === question.id ? candidate.target : candidate.source) && node.type === 'DECISION')
  );
  if (!edge) return undefined;
  const otherId = edge.source === question.id ? edge.target : edge.source;
  return project.nodes.find((node) => node.id === otherId && node.type === 'DECISION')?.id;
}

function underlyingKey(itemType: TodayItemType, recommendation: AttentionCandidate, project: Project): string {
  const nodes = sourceNodes(recommendation, project);
  const primaryNode = itemType === 'QUESTION' ? questionNode(nodes) : actionableNode(nodes);
  if (primaryNode) {
    if (itemType === 'QUESTION') {
      const group = canonicalQuestionGroups(project).find((candidate) => candidate.nodeIds.includes(primaryNode.id));
      return `${itemType}:${group?.canonical.id ?? primaryNode.id}`;
    }
    return `${itemType}:${primaryNode.id}`;
  }
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
    // A risk node is retained in the graph and retrieval context, but it is
    // not a standalone Today action. Its actionable UNKNOWN (if any) is what
    // the user should resolve.
    if (itemType === 'DECISION' && recommendation.kind === 'risk') return;
    const key = underlyingKey(itemType, recommendation, project);
    if (seen.has(key)) return;
    seen.add(key);
    const calendarCommitment = itemType === 'REMINDER' ? calendarCommitmentFor(recommendation) : undefined;
    const title = displayTitle(recommendation, itemType, project);
    items.push({
      recommendation,
      itemType,
      title,
      description: displayDescription(recommendation, itemType, title),
      calendarStart: calendarCommitment ? calendarTimestampFromText(calendarCommitment.text, 'Starts') : undefined,
      calendarEnd: calendarCommitment ? calendarTimestampFromText(calendarCommitment.text, 'Ends') : undefined,
      calendarSource: calendarCommitment ? 'Google Calendar' : undefined,
      calendarCommitmentId: calendarCommitment?.id,
      question: itemType === 'QUESTION' ? matchingQuestion(recommendation, questions, project) : undefined,
      decisionNodeId: linkedDecisionNodeId(recommendation, project),
    });
  });

  return items.slice(0, limit);
}
