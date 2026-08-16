import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { ClarityEdge, ClarityNode, EdgeType, Project } from '@/types/clarity';
import { activeContextSources } from '@/lib/context/sourceState';

export interface DecisionEvidence {
  id: string;
  nodeId?: string;
  text: string;
  relation?: EdgeType;
  confidence: number;
  sourceIds: string[];
  sourceNames: string[];
}

export interface DecisionOption {
  id: string;
  label: string;
  text: string;
  evidence: DecisionEvidence[];
  sourceIds: string[];
}

export interface DecisionQuestion {
  node: ClarityNode;
  why: string;
  affects: ClarityNode[];
}

export interface DecisionRecommendation {
  option: DecisionOption;
  explanation: string;
}

export interface DecisionWorkspaceModel {
  decision: ClarityNode;
  options: DecisionOption[];
  supportingEvidence: DecisionEvidence[];
  constraints: ClarityNode[];
  assumptionsRisks: ClarityNode[];
  remainingQuestions: DecisionQuestion[];
  sources: Project['sources'];
  recommendation: DecisionRecommendation | null;
  currentPicture: string[];
  supportingNodeIds: string[];
}

export interface ConfirmDecisionInput {
  decisionNodeId: string;
  selectedOption?: string;
  customDecision?: string;
  reason?: string;
  resolveQuestionIds?: string[];
}

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function connectedEdges(project: Project, nodeId: string): ClarityEdge[] {
  return project.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}

function relatedNodeIds(project: Project, nodeId: string): Set<string> {
  return new Set(
    connectedEdges(project, nodeId).flatMap((edge) => [edge.source, edge.target]).filter((id) => id !== nodeId),
  );
}

function optionLabel(text: string): string | null {
  const match = text.trim().match(/^(option|choice|candidate|apartment)\s+([a-z0-9]+)\s*[:\-]\s*(.+)$/i);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2].toUpperCase()}` : null;
}

function sourceNames(project: Project, sourceIds: string[]): string[] {
  return unique(
    sourceIds
      .map((sourceId) => project.sources.find((source) => source.id === sourceId)?.filename)
      .filter((name): name is string => Boolean(name)),
  );
}

function nodeEvidence(project: Project, node: ClarityNode, relation?: EdgeType): DecisionEvidence {
  return {
    id: `node:${node.id}`,
    nodeId: node.id,
    text: node.text,
    relation,
    confidence: node.confidence,
    sourceIds: [...node.source_refs],
    sourceNames: sourceNames(project, node.source_refs),
  };
}

function sourceEvidence(project: Project, sourceId: string, text: string, label: string): DecisionEvidence {
  return {
    id: `source:${sourceId}:${label}`,
    text,
    confidence: 0.75,
    sourceIds: [sourceId],
    sourceNames: sourceNames(project, [sourceId]),
  };
}

function optionEvidence(project: Project, node: ClarityNode, relation?: EdgeType): DecisionEvidence[] {
  const label = optionLabel(node.text);
  if (!label) return [];
  return [nodeEvidence(project, node, relation)];
}

function sourceOptionEvidence(project: Project, source: Project['sources'][number]): DecisionEvidence[] {
  return source.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(optionLabel(line)))
    .map((line) => sourceEvidence(project, source.id, line, optionLabel(line) ?? line));
}

function relationshipForNode(project: Project, decisionId: string, nodeId: string): EdgeType | undefined {
  return project.edges.find(
    (edge) =>
      ((edge.source === nodeId && edge.target === decisionId) || (edge.source === decisionId && edge.target === nodeId)),
  )?.type;
}

function decisionCandidates(project: Project, nodeId: string): ClarityNode[] {
  const node = project.nodes.find((item) => item.id === nodeId);
  if (node?.type === 'DECISION') return [node];

  return connectedEdges(project, nodeId)
    .filter((edge) => ['blocks', 'depends_on', 'affects'].includes(edge.type))
    .map((edge) => project.nodes.find((item) => item.id === (edge.source === nodeId ? edge.target : edge.source)))
    .filter((candidate): candidate is ClarityNode => candidate?.type === 'DECISION')
    .sort((left, right) => right.impact - left.impact);
}

export function findDecisionForNode(project: Project, nodeId: string): ClarityNode | null {
  return decisionCandidates(project, nodeId)[0] ?? null;
}

function buildOptions(
  project: Project,
  decision: ClarityNode,
  relatedNodes: ClarityNode[],
): DecisionOption[] {
  const grouped = new Map<string, DecisionEvidence[]>();
  const add = (label: string, evidence: DecisionEvidence) => {
    grouped.set(label, [...(grouped.get(label) ?? []), evidence]);
  };

  relatedNodes.forEach((node) => {
    const label = optionLabel(node.text);
    if (!label) return;
    optionEvidence(project, node, relationshipForNode(project, decision.id, node.id)).forEach((evidence) => add(label, evidence));
  });

  const relatedSourceIds = new Set([
    ...decision.source_refs,
    ...relatedNodes.flatMap((node) => node.source_refs),
  ]);
  activeContextSources(project)
    .filter((source) => relatedSourceIds.has(source.id))
    .forEach((source) => {
    sourceOptionEvidence(project, source).forEach((evidence) => {
      const label = optionLabel(evidence.text);
      if (label) add(label, evidence);
    });
    });

  return [...grouped.entries()].map(([label, evidence], index) => ({
    id: `option_${index}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    label,
    text: evidence[0]?.text ?? label,
    evidence,
    sourceIds: unique(evidence.flatMap((item) => item.sourceIds)),
  }));
}

function buildRecommendation(options: DecisionOption[], hasBlockingQuestions: boolean): DecisionRecommendation | null {
  if (hasBlockingQuestions) return null;
  if (options.length < 2 || options.some((option) => option.evidence.length === 0 || option.sourceIds.length === 0)) return null;
  const ranked = [...options].sort((left, right) => {
    const rightScore = right.evidence.reduce((sum, item) => sum + item.confidence, 0);
    const leftScore = left.evidence.reduce((sum, item) => sum + item.confidence, 0);
    return rightScore - leftScore;
  });
  const bestScore = ranked[0].evidence.reduce((sum, item) => sum + item.confidence, 0);
  const nextScore = ranked[1].evidence.reduce((sum, item) => sum + item.confidence, 0);
  if (bestScore === nextScore) return null;
  return {
    option: ranked[0],
    explanation: 'It has the strongest recorded support among the explicit options in your context.',
  };
}

export function buildDecisionWorkspace(project: Project, targetNodeId: string): DecisionWorkspaceModel | null {
  const decision = findDecisionForNode(project, targetNodeId);
  if (!decision) return null;

  const relatedIds = relatedNodeIds(project, decision.id);
  const relatedNodes = project.nodes.filter((node) => relatedIds.has(node.id));
  const decisionEdges = connectedEdges(project, decision.id);
  const remainingQuestions = relatedNodes
    .filter((node) => node.status === 'OPEN' && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION'))
    .filter((node) => decisionEdges.some((edge) => edge.type === 'blocks' || edge.type === 'depends_on' ? edge.source === node.id || edge.target === node.id : false))
    .map((node) => ({
      node,
      why: node.why_it_matters?.[0] ?? 'Answering this could change confidence in the decision.',
      affects: relatedNodes.filter((candidate) => candidate.type === 'GOAL' || candidate.type === 'NEXT_ACTION'),
    }));

  const constraints = relatedNodes.filter((node) => node.type === 'CONSTRAINT' || node.type === 'PREFERENCE');
  const assumptionsRisks = relatedNodes.filter((node) => node.type === 'ASSUMPTION' || node.type === 'RISK');
  const supportingNodes = relatedNodes.filter((node) => node.type === 'KNOWN' || node.type === 'EVIDENCE');
  const supportingEvidence = supportingNodes.map((node) => nodeEvidence(project, node, relationshipForNode(project, decision.id, node.id)));
  const options = buildOptions(project, decision, relatedNodes);
  const relevantSourceIds = unique([
    ...decision.source_refs,
    ...supportingEvidence.flatMap((evidence) => evidence.sourceIds),
    ...options.flatMap((option) => option.sourceIds),
    ...constraints.flatMap((node) => node.source_refs),
    ...assumptionsRisks.flatMap((node) => node.source_refs),
    ...remainingQuestions.flatMap((question) => question.node.source_refs),
  ]);
  const sources = activeContextSources(project).filter((source) => relevantSourceIds.includes(source.id));
  const recommendation = buildRecommendation(options, remainingQuestions.length > 0);
  const currentPicture = recommendation
    ? [`Gapswise currently leans toward ${recommendation.option.label}.`, recommendation.explanation]
    : remainingQuestions.length
      ? decision.why_it_matters?.[0]
        ? [decision.why_it_matters[0]]
        : assumptionsRisks.length
          ? [`This decision is shaped by ${assumptionsRisks[0].text.replace(/[.!?]+$/, '')}.`]
          : ['This decision still needs an answer before it can be made with confidence.']
      : supportingEvidence.length
        ? ['The decision has some supporting context, but no option has enough clearly separated evidence for a recommendation.']
        : ['There is not enough structured context to recommend an option yet.'];

  return {
    decision,
    options,
    supportingEvidence,
    constraints,
    assumptionsRisks,
    remainingQuestions,
    sources,
    recommendation,
    currentPicture,
    supportingNodeIds: unique([
      ...supportingNodes.map((node) => node.id),
      ...options.flatMap((option) => option.evidence.map((evidence) => evidence.nodeId).filter((id): id is string => Boolean(id))),
    ]),
  };
}

function addEdgeIfMissing(project: Project, edge: Omit<ClarityEdge, 'id'>): void {
  const exists = project.edges.some(
    (candidate) => candidate.source === edge.source && candidate.target === edge.target && candidate.type === edge.type,
  );
  if (!exists) {
    project.edges.push({ ...edge, id: `edge_${Date.now()}_${project.edges.length}` });
  }
}

export function confirmDecision(project: Project, input: ConfirmDecisionInput): Project {
  const updated = cloneProject(project);
  const workspace = buildDecisionWorkspace(updated, input.decisionNodeId);
  if (!workspace) throw new Error('This decision is no longer available in the selected project.');

  const decision = updated.nodes.find((node) => node.id === workspace.decision.id);
  if (!decision) throw new Error('This decision is no longer available in the selected project.');
  const finalText = input.customDecision?.trim() || input.selectedOption?.trim();
  if (!finalText) throw new Error('Choose an option or enter a decision first.');

  const now = new Date().toISOString();
  const previousText = decision.text;
  decision.text = finalText;
  decision.status = 'RESOLVED';
  decision.confidence = 1;
  decision.updated_at = now;
  decision.source_refs = unique([
    ...decision.source_refs,
    ...workspace.supportingEvidence.flatMap((evidence) => evidence.sourceIds),
  ]);

  workspace.supportingNodeIds.forEach((nodeId) => {
    const node = updated.nodes.find((candidate) => candidate.id === nodeId);
    const evidence = workspace.supportingEvidence.find((item) => item.nodeId === nodeId);
    if ((node?.type === 'KNOWN' || node?.type === 'EVIDENCE') && (evidence?.relation === 'supports' || evidence?.relation === 'informs')) {
      addEdgeIfMissing(updated, { source: node.id, target: decision.id, type: 'supports', confidence: node.confidence });
    }
  });

  const resolveIds = new Set(input.resolveQuestionIds ?? []);
  updated.nodes
    .filter((node) => resolveIds.has(node.id) && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION'))
    .forEach((node) => {
      node.status = 'RESOLVED';
      node.confidence = 1;
      node.updated_at = now;
      addEdgeIfMissing(updated, { source: decision.id, target: node.id, type: 'resolves', confidence: 1 });
    });

  const reason = input.reason?.trim();
  updated.history.push({
    question: previousText,
    answer: finalText,
    timestamp: now,
    graph_diff_summary: reason ? `Decision confirmed: "${finalText}". Reason: ${reason}` : `Decision confirmed: "${finalText}"`,
  });
  updated.clarity_score = calculateClarityScore(updated);
  updated.active_question = selectTopGap(updated, DEFAULT_USER_PROFILE);
  updated.updated_at = now;
  return updated;
}
