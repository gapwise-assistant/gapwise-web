import type { TodayQuestion } from '@/lib/today/sections';
import { buildDecisionPath } from '@/lib/graph/constellation';
import { ClarityEdge, ClarityNode, ContextSource, Project } from '@/types/clarity';

export interface QuestionWhyEvidence {
  sourceId?: string;
  title: string;
  excerpt: string;
}

export interface QuestionWhyExplanation {
  whyThisMatters: string;
  whatThisBlocks: string[];
  whatGapswiseKnows: string[];
  whatCouldChange: string[];
  evidence: QuestionWhyEvidence[];
  reasoningPath: {
    nodeIds: string[];
    edgeIds: string[];
  } | null;
}

const MAX_EVIDENCE = 4;
const MAX_KNOWN = 4;
const MAX_CHANGES = 4;

function compactText(value: string, maxLength = 240): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function nodeDescription(node: ClarityNode): string {
  return compactText(node.text).replace(/[.!?]+$/, '');
}

function uniqueText(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map((value) => compactText(value)).filter(Boolean))).slice(0, limit);
}

function edgeOtherNode(project: Project, edge: ClarityEdge, nodeId: string): ClarityNode | undefined {
  return project.nodes.find((node) => node.id === (edge.source === nodeId ? edge.target : edge.source));
}

function edgesForNode(project: Project, nodeId: string): ClarityEdge[] {
  return project.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}

function directNodeForQuestion(project: Project, question: TodayQuestion): ClarityNode | undefined {
  return question.sourceNodeIds
    .map((nodeId) => project.nodes.find((node) => node.id === nodeId))
    .find((node): node is ClarityNode => Boolean(node))
    ?? project.nodes.find((node) => node.text === question.question)
    ?? project.nodes.find((node) => question.question.includes(node.text));
}

function sourceExcerpt(source: ContextSource): string {
  return compactText(source.content || source.extraction_summary || 'This source was checked for the question.');
}

function collectEvidence(project: Project, nodes: ClarityNode[]): QuestionWhyEvidence[] {
  const evidence: QuestionWhyEvidence[] = [];
  const seen = new Set<string>();

  nodes.forEach((node) => {
    node.source_refs.forEach((sourceId) => {
      if (seen.has(sourceId)) return;
      seen.add(sourceId);
      if (sourceId.startsWith('gcal_')) {
        evidence.push({ sourceId, title: 'Google Calendar', excerpt: nodeDescription(node) });
        return;
      }
      const source = project.sources.find((candidate) => candidate.id === sourceId);
      if (source) {
        evidence.push({ sourceId, title: source.filename, excerpt: sourceExcerpt(source) });
      }
    });
  });

  return evidence.slice(0, MAX_EVIDENCE);
}

function supportedNodes(project: Project, nodeId: string): ClarityNode[] {
  return edgesForNode(project, nodeId)
    .filter((edge) => edge.type === 'supports' || edge.type === 'informs' || edge.type === 'derived_from')
    .map((edge) => edgeOtherNode(project, edge, nodeId))
    .filter((node): node is ClarityNode => Boolean(node));
}

function downstreamNodes(project: Project, nodeId: string): ClarityNode[] {
  return edgesForNode(project, nodeId)
    .filter((edge) => {
      if (edge.type === 'blocks' || edge.type === 'affects' || edge.type === 'resolves' || edge.type === 'contradicts' || edge.type === 'supersedes') {
        return edge.source === nodeId;
      }
      return edge.type === 'depends_on' && edge.target === nodeId;
    })
    .map((edge) => edge.source === nodeId
      ? project.nodes.find((node) => node.id === edge.target)
      : project.nodes.find((node) => node.id === edge.source))
    .filter((node): node is ClarityNode => Boolean(node));
}

function blockingNodes(project: Project, nodeId: string): ClarityNode[] {
  return edgesForNode(project, nodeId)
    .filter((edge) => (edge.type === 'blocks' && edge.source === nodeId) || (edge.type === 'depends_on' && edge.target === nodeId))
    .map((edge) => project.nodes.find((node) => node.id === (edge.source === nodeId ? edge.target : edge.source)))
    .filter((node): node is ClarityNode => Boolean(node));
}

function changeDescription(node: ClarityNode): string {
  const description = nodeDescription(node);
  if (node.type === 'DECISION') return `decision: ${description}`;
  if (node.type === 'NEXT_ACTION') return `next action: ${description}`;
  if (node.type === 'GOAL') return `progress toward: ${description}`;
  if (node.type === 'ASSUMPTION') return `confidence in: ${description}`;
  if (node.type === 'RISK') return `risk assessment for: ${description}`;
  return `${node.type.toLowerCase().replace('_', ' ')}: ${description}`;
}

function relationshipChanges(project: Project, nodeId: string): string[] {
  return edgesForNode(project, nodeId).flatMap((edge) => {
    const other = edgeOtherNode(project, edge, nodeId);
    if (!other) return [];
    if (edge.type === 'contradicts') {
      return [`confidence in ${changeDescription(other)} may change because it conflicts with this question`];
    }
    if (edge.type === 'supersedes') {
      return [`the current understanding of ${changeDescription(other)} may be replaced`];
    }
    return [];
  });
}

function findGoal(project: Project, pathNodeIds: string[]): ClarityNode | undefined {
  const pathGoal = [...pathNodeIds]
    .reverse()
    .map((nodeId) => project.nodes.find((node) => node.id === nodeId))
    .find((node): node is ClarityNode => node?.type === 'GOAL');
  return pathGoal ?? project.nodes.find((node) => node.type === 'GOAL');
}

export function buildQuestionWhyExplanation(project: Project, question: TodayQuestion): QuestionWhyExplanation {
  const node = directNodeForQuestion(project, question);
  if (!node) {
    return {
      whyThisMatters: 'This question is present in the current context, but its downstream decision impact has not been recorded yet.',
      whatThisBlocks: ['No specific decision or action is linked to this question yet.'],
      whatGapswiseKnows: ['There is not enough linked graph information to summarize confirmed understanding yet.'],
      whatCouldChange: ['The next decision or action will become clearer once this question is connected to the project graph.'],
      evidence: [],
      reasoningPath: null,
    };
  }

  const nodeEdges = edgesForNode(project, node.id);
  const relatedNodes = nodeEdges
    .map((edge) => edgeOtherNode(project, edge, node.id))
    .filter((related): related is ClarityNode => Boolean(related));
  const supported = supportedNodes(project, node.id);
  const blocked = blockingNodes(project, node.id);
  const downstream = downstreamNodes(project, node.id);
  const path = buildDecisionPath(project, node.id);
  const goal = findGoal(project, path.nodeIds);
  const evidence = collectEvidence(project, [node, ...supported, ...relatedNodes]);
  const knownFromNodes = supported
    .filter((related) => ['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'DECISION', 'ASSUMPTION'].includes(related.type))
    .map(nodeDescription);
  const knownFromSources = evidence
    .filter((item) => item.title !== 'Google Calendar')
    .map((item) => item.excerpt);
  const whatGapswiseKnows = uniqueText([...knownFromNodes, ...knownFromSources], MAX_KNOWN);
  const allImpactNodes = Array.from(new Map([...blocked, ...downstream, ...path.nodeIds
    .map((nodeId) => project.nodes.find((candidate) => candidate.id === nodeId))
    .filter((candidate): candidate is ClarityNode => Boolean(candidate))]
    .filter((candidate) => candidate.id !== node.id)
    .map((candidate) => [candidate.id, candidate])).values());
  const whatCouldChange = uniqueText([
    ...allImpactNodes.map(changeDescription),
    ...relationshipChanges(project, node.id),
  ], MAX_CHANGES);

  const whyThisMatters = blocked[0]
    ? `The answer to this question is currently blocking ${changeDescription(blocked[0])}.`
    : downstream[0]
      ? `Answering this question can change ${changeDescription(downstream[0])}.`
      : goal
        ? `This question affects progress toward ${changeDescription(goal)}.`
        : node.why_it_matters?.[0]
          ? compactText(node.why_it_matters[0])
          : 'This is an open question in the current context, but no downstream decision impact is recorded yet.';

  return {
    whyThisMatters,
    whatThisBlocks: blocked.length
      ? uniqueText(blocked.map((target) => `Gapswise cannot confidently move to ${changeDescription(target)} until this is answered.`), MAX_CHANGES)
      : ['No specific decision or action is recorded as blocked by this question yet.'],
    whatGapswiseKnows: whatGapswiseKnows.length
      ? whatGapswiseKnows
      : ['No confirmed supporting understanding is linked to this question yet.'],
    whatCouldChange: whatCouldChange.length
      ? whatCouldChange
      : ['No downstream decision or action is linked yet.'],
    evidence,
    reasoningPath: path.nodeIds.length > 1 ? path : null,
  };
}
