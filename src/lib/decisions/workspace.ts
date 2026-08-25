import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { ClarityEdge, ClarityNode, EdgeType, Project } from '@/types/clarity';
import { activeContextSources, projectForReasoning } from '@/lib/context/sourceState';
import { resolveSatisfiedNextActions } from '@/lib/actions/completion';
import { appendDecisionResolvedHistory } from '@/lib/history/projectHistory';
import {
  ensureResolutionConsistency,
  writeSemanticEdge,
} from '@/lib/graph/relationshipSemantics';

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
  decisionInputs: DecisionQuestion[];
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

/**
 * A decision keeps its original question in `text` and stores the selected
 * outcome separately. This keeps the decision identity stable after it is
 * resolved while allowing presentation surfaces to show the question.
 */
export function decisionQuestionForDisplay(_project: Project, decision: ClarityNode): string {
  return decision.text;
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

const canonicalDecisionAliases = new Set([
  'EQUIVALENT',
  'REFINES_EXISTING',
]);

export function canonicalDecisionIdFor(project: Project, nodeId: string): string {
  const node = project.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== 'DECISION' || !node.canonical_node_id) return nodeId;
  if (!node.reconciliation_classification || !canonicalDecisionAliases.has(node.reconciliation_classification)) {
    return nodeId;
  }
  const canonical = project.nodes.find((candidate) =>
    candidate.id === node.canonical_node_id && candidate.type === 'DECISION',
  );
  return canonical?.id ?? nodeId;
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

function buildRecommendation(options: DecisionOption[], hasBlockingInputs: boolean): DecisionRecommendation | null {
  if (hasBlockingInputs) return null;
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
  const reasoningProject = projectForReasoning(project);
  const decision = findDecisionForNode(
    reasoningProject,
    canonicalDecisionIdFor(reasoningProject, targetNodeId),
  );
  if (!decision) return null;

  const relatedIds = relatedNodeIds(reasoningProject, decision.id);
  const relatedNodes = reasoningProject.nodes.filter((node) => relatedIds.has(node.id));
  const decisionEdges = connectedEdges(reasoningProject, decision.id);
  const decisionInputs = relatedNodes
    .filter((node) => node.status === 'OPEN' && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION'))
    .filter((node) => decisionEdges.some((edge) =>
      (edge.type === 'blocks' || edge.type === 'depends_on' || edge.type === 'informs')
      && (edge.source === node.id || edge.target === node.id)
    ))
    .map((node) => ({
      node,
      why: node.why_it_matters?.[0] ?? 'Answering this could change confidence in the decision.',
      affects: relatedNodes.filter((candidate) => candidate.type === 'GOAL' || candidate.type === 'NEXT_ACTION'),
    }));

  const constraints = relatedNodes.filter((node) => node.type === 'CONSTRAINT' || node.type === 'PREFERENCE');
  const assumptionsRisks = relatedNodes.filter((node) => node.type === 'ASSUMPTION' || node.type === 'RISK');
  const supportingNodes = relatedNodes.filter((node) => node.type === 'KNOWN' || node.type === 'EVIDENCE');
  const supportingEvidence = supportingNodes.map((node) => nodeEvidence(reasoningProject, node, relationshipForNode(reasoningProject, decision.id, node.id)));
  const options = buildOptions(reasoningProject, decision, relatedNodes);
  const relevantSourceIds = unique([
    ...decision.source_refs,
    ...supportingEvidence.flatMap((evidence) => evidence.sourceIds),
    ...options.flatMap((option) => option.sourceIds),
    ...constraints.flatMap((node) => node.source_refs),
    ...assumptionsRisks.flatMap((node) => node.source_refs),
    ...decisionInputs.flatMap((question) => question.node.source_refs),
  ]);
  const sources = activeContextSources(reasoningProject).filter((source) => relevantSourceIds.includes(source.id));
  const recommendation = buildRecommendation(options, decisionInputs.length > 0);
  const inputPicture = decisionInputs
    .slice(0, 3)
    .map((question) => question.why ?? `Still unresolved: ${question.node.text}`);
  const currentPicture = Array.from(new Set([
    ...(recommendation
      ? [`Gapwise currently leans toward ${recommendation.option.label}.`, recommendation.explanation]
      : []),
    ...(decision.why_it_matters ?? []),
    ...inputPicture,
    ...(!recommendation && !decision.why_it_matters?.length && !inputPicture.length
      ? supportingEvidence.length
        ? ['The decision has some supporting context, but no option has enough clearly separated evidence for a recommendation.']
        : ['There is not enough structured context to recommend an option yet.']
      : []),
  ])).slice(0, 5);

  return {
    decision,
    options,
    supportingEvidence,
    constraints,
    assumptionsRisks,
    decisionInputs,
    sources,
    recommendation,
    currentPicture,
    supportingNodeIds: unique([
      ...supportingNodes.map((node) => node.id),
      ...options.flatMap((option) => option.evidence.map((evidence) => evidence.nodeId).filter((id): id is string => Boolean(id))),
    ]),
  };
}

function deprecateResolvedDecisionAliases(project: Project, canonicalDecisionId: string, now: string): void {
  project.nodes
    .filter((node) =>
      node.type === 'DECISION'
      && node.id !== canonicalDecisionId
      && node.status === 'OPEN'
      && node.canonical_node_id === canonicalDecisionId
      && node.reconciliation_classification
      && canonicalDecisionAliases.has(node.reconciliation_classification),
    )
    .forEach((node) => {
      node.status = 'DEPRECATED';
      node.updated_at = now;
    });
}

export function confirmDecision(project: Project, input: ConfirmDecisionInput): Project {
  const updated = cloneProject(project);
  const canonicalDecisionId = canonicalDecisionIdFor(updated, input.decisionNodeId);
  const workspace = buildDecisionWorkspace(updated, canonicalDecisionId);
  if (!workspace) throw new Error('This decision is no longer available in the selected project.');

  const decision = updated.nodes.find((node) => node.id === workspace.decision.id);
  if (!decision) throw new Error('This decision is no longer available in the selected project.');
  const finalText = input.customDecision?.trim() || input.selectedOption?.trim();
  if (!finalText) throw new Error('Choose an option or enter a decision first.');

  const now = new Date().toISOString();
  const previousText = decision.text;
  decision.decision_outcome = finalText;
  decision.status = 'RESOLVED';
  decision.confidence = 1;
  decision.updated_at = now;
  deprecateResolvedDecisionAliases(updated, decision.id, now);
  decision.source_refs = unique([
    ...decision.source_refs,
    ...workspace.supportingEvidence.flatMap((evidence) => evidence.sourceIds),
  ]);

  workspace.supportingNodeIds.forEach((nodeId) => {
    const node = updated.nodes.find((candidate) => candidate.id === nodeId);
    const evidence = workspace.supportingEvidence.find((item) => item.nodeId === nodeId);
    if ((node?.type === 'KNOWN' || node?.type === 'EVIDENCE') && (evidence?.relation === 'supports' || evidence?.relation === 'informs')) {
      writeSemanticEdge(updated, { source: node.id, target: decision.id, type: 'supports', confidence: node.confidence });
    }
  });

  const resolveIds = new Set(input.resolveQuestionIds ?? []);
  updated.nodes
    .filter((node) => resolveIds.has(node.id) && (node.type === 'UNKNOWN' || node.type === 'ASSUMPTION'))
    .forEach((node) => {
      node.status = 'RESOLVED';
      node.confidence = 1;
      node.updated_at = now;
      writeSemanticEdge(updated, { source: decision.id, target: node.id, type: 'resolves', confidence: 1 });
    });

  ensureResolutionConsistency(updated);
  const reason = input.reason?.trim();
  resolveSatisfiedNextActions(updated, now);
  updated.history.push({
    question: previousText,
    answer: finalText,
    timestamp: now,
    graph_diff_summary: reason ? `Decision confirmed: "${finalText}". Reason: ${reason}` : `Decision confirmed: "${finalText}"`,
  });
  updated.clarity_score = calculateClarityScore(updated);
  updated.active_question = selectTopGap(updated, DEFAULT_USER_PROFILE);
  updated.updated_at = now;
  return appendDecisionResolvedHistory(project, updated, {
    nodeId: decision.id,
    question: previousText,
    answer: finalText,
    createdAt: now,
  });
}
