import { Type } from '@google/genai';
import { z } from 'zod';
import type { ClarityNode, ContextSource, EdgeType, Project } from '@/types/clarity';
import { assertExternalServicesAllowed } from '@/lib/runtime/demoMode';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { validateStructuredOutput } from '@/lib/agents/schemas';
import { retrieveProjectReasoningContext } from '@/lib/retrieval/projectReasoningContext';
import { relevanceScore } from '@/lib/retrieval/relevance';
import { projectForReasoning } from '@/lib/context/sourceState';
import { canonicalQuestionGroups } from '@/lib/questions/canonical';
import {
  completionAllowedRelationshipTypes,
} from '@/lib/graph/relationshipSemantics';
import {
  applyCanonicalRelationshipCandidates,
  type CanonicalRelationshipCandidate,
  type RelationshipPersistenceTrace,
} from '@/lib/context/ingestion';

const completionRelationshipSchema = z.enum([
  'supports',
  'contradicts',
  'depends_on',
  'blocks',
  'informs',
  'resolves',
  'satisfies',
  'derived_from',
  'supersedes',
  'affects',
  'NONE',
] as [string, ...string[]]);

const completionResponseSchema = z.object({
  classifications: z.array(z.object({
    pair_id: z.string().min(1),
    relationship: completionRelationshipSchema,
    confidence: z.number().min(0).max(1),
  })).max(40).default([]),
});

export interface RelationshipCompletionPair {
  pairId: string;
  sourceNodeId: string;
  targetNodeId: string;
  allowedTypes: EdgeType[];
  score: number;
}

export interface RelationshipCompletionClassification {
  pair_id: string;
  relationship: EdgeType | 'NONE';
  confidence: number;
}

export interface RelationshipCompletionTrace {
  candidatePairs: RelationshipCompletionPair[];
  classifications: RelationshipCompletionClassification[];
  acceptedRelationships: CanonicalRelationshipCandidate[];
  rejectedRelationships: RelationshipPersistenceTrace['rejectedRelationships'];
  prompt?: string;
  rawResponse?: string;
  error?: string;
}

export interface CompleteProjectRelationshipsInput {
  projectBefore: Project;
  projectAfter: Project;
  changedNodeIds: string[];
  source: Pick<ContextSource, 'id' | 'filename' | 'content'>;
  genAI?: ReturnType<typeof getVertexGenAIClient>;
  model?: string;
}

export interface CompleteProjectRelationshipsResult {
  project: Project;
  trace: RelationshipCompletionTrace;
}

function nodeSemanticValue(node: ClarityNode): string {
  return JSON.stringify([
    node.type,
    node.text,
    node.status,
    node.confidence,
    node.impact,
    node.decision_outcome ?? null,
    node.canonical_node_id ?? null,
    node.canonical_question_id ?? null,
  ]);
}

/** Returns nodes that were created or semantically changed by an ingestion. */
export function changedProjectNodeIds(before: Project, after: Project): string[] {
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  return after.nodes
    .filter((node) => {
      const previous = beforeById.get(node.id);
      return !previous || nodeSemanticValue(previous) !== nodeSemanticValue(node);
    })
    .map((node) => node.id);
}

function activeNode(node: ClarityNode): boolean {
  return node.status !== 'DEPRECATED';
}

function nodePromptValue(node: ClarityNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    status: node.status,
    text: node.text,
    confidence: node.confidence,
    impact: node.impact,
  };
}

function nodeMeaning(node: ClarityNode): string {
  return `${node.type} ${node.text} ${node.why_it_matters?.join(' ') ?? ''}`;
}

function pairScore(
  sourceText: string,
  source: ClarityNode,
  target: ClarityNode,
  changedIds: Set<string>,
  project: Project,
): number {
  const lexical = relevanceScore(sourceText, `${nodeMeaning(source)} ${nodeMeaning(target)}`);
  const direct = relevanceScore(source.text, target.text) + relevanceScore(target.text, source.text);
  const existing = project.edges.some((edge) =>
    (edge.source === source.id && edge.target === target.id)
    || (edge.source === target.id && edge.target === source.id)
  ) ? 0.16 : 0;
  const targetImportance = target.type === 'GOAL' || target.type === 'DECISION' || target.type === 'UNKNOWN' || target.type === 'ASSUMPTION'
    ? 0.08
    : 0;
  const changedBonus = changedIds.has(source.id) && changedIds.has(target.id) ? 0.22 : 0.14;
  return Number((lexical + direct * 0.35 + existing + targetImportance + changedBonus).toFixed(4));
}

/**
 * Retrieve a bounded, relevance-ranked candidate set. The model only sees
 * directed pairs assembled here; it cannot invent endpoints or relationships
 * between two historical nodes.
 */
export function buildRelationshipCompletionPairs(
  project: Project,
  changedNodeIds: string[],
  sourceText: string,
): RelationshipCompletionPair[] {
  const reasoningProject = projectForReasoning(project);
  // Reconciliation can leave a newly extracted question as an alias that is
  // removed from the reasoning projection. Keep completion attached to the
  // canonical identity instead of losing the changed endpoint during that
  // projection step.
  const canonicalIdsByMember = new Map(
    canonicalQuestionGroups(project).flatMap((group) =>
      group.nodeIds.map((nodeId) => [nodeId, group.canonical.id] as const)
    ),
  );
  const changedIds = new Set(changedNodeIds.map((nodeId) => canonicalIdsByMember.get(nodeId) ?? nodeId));
  const changed = reasoningProject.nodes.filter((node) => changedIds.has(node.id) && activeNode(node));
  if (changed.length === 0) return [];

  const retrieved = retrieveProjectReasoningContext({
    project: reasoningProject,
    query: sourceText,
    mode: 'reasoning',
    limits: {
      seedNodes: 5,
      directNeighbors: 5,
      secondHopNodes: 3,
      totalNodes: 12,
      sources: 4,
    },
  });
  const retrievedIds = new Set([
    ...retrieved.seedNodes.map((node) => node.id),
    ...retrieved.expandedNodes.map((node) => node.id),
  ]);
  const candidatePool = reasoningProject.nodes
    .filter((node) => activeNode(node) && !changedIds.has(node.id))
    .map((node) => ({
      node,
      score: (retrievedIds.has(node.id) ? 0.35 : 0)
        + relevanceScore(sourceText, nodeMeaning(node))
        + Math.max(
          0,
          ...changed.map((changedNode) => relevanceScore(
            changedNode.text,
            nodeMeaning(node),
          )),
        ) * 0.45
        + (node.type === 'GOAL' || node.status === 'OPEN' ? 0.08 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, 10)
    .map(({ node }) => node);

  const possibleNodes = [...changed, ...candidatePool];
  const possiblePairs = new Map<string, RelationshipCompletionPair>();
  possibleNodes.forEach((source) => {
    possibleNodes.forEach((target) => {
      if (source.id === target.id) return;
      if (!changedIds.has(source.id) && !changedIds.has(target.id)) return;
      const allowedTypes = completionAllowedRelationshipTypes(source, target);
      if (allowedTypes.length === 0) return;
      const pairId = `relationship:${source.id}:${target.id}`;
      possiblePairs.set(pairId, {
        pairId,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        allowedTypes,
        score: pairScore(sourceText, source, target, changedIds, reasoningProject),
      });
    });
  });

  const allPairs = [...possiblePairs.values()].sort((left, right) =>
    right.score - left.score || left.pairId.localeCompare(right.pairId)
  );
  const selected: RelationshipCompletionPair[] = [];
  const selectedIds = new Set<string>();
  // Give each changed node the strongest legal outgoing and incoming pair
  // before filling the remaining bounded budget by score. This keeps a
  // changed node from losing all of its representation to an early, highly
  // connected node in the flat score ordering.
  changed.forEach((node) => {
    const outgoing = allPairs.find((pair) => pair.sourceNodeId === node.id);
    const incoming = allPairs.find((pair) => pair.targetNodeId === node.id);
    [outgoing, incoming]
      .filter((pair): pair is RelationshipCompletionPair => Boolean(pair))
      .forEach((pair) => {
        if (selected.length >= 40 || selectedIds.has(pair.pairId)) return;
        selected.push(pair);
        selectedIds.add(pair.pairId);
      });
  });
  allPairs.forEach((pair) => {
    if (selected.length >= 40 || selectedIds.has(pair.pairId)) return;
    selected.push(pair);
    selectedIds.add(pair.pairId);
  });
  return selected;
}

function completionPrompt(
  source: Pick<ContextSource, 'filename' | 'content'>,
  project: Project,
  pairs: RelationshipCompletionPair[],
): string {
  const nodeIds = new Set(pairs.flatMap((pair) => [pair.sourceNodeId, pair.targetNodeId]));
  const nodes = project.nodes.filter((node) => nodeIds.has(node.id)).map(nodePromptValue);
  const edges = project.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type, confidence: edge.confidence ?? null }));
  return [
    'You are completing a sparse reasoning graph after project context has been reconciled.',
    `Source: ${source.filename}`,
    `Source text: ${source.content.trim().slice(0, 6000)}`,
    'Classify only the supplied directed pairs. Do not invent a pair, endpoint, or relationship.',
    'Most pairs should be NONE. Create a relationship only when the source text and supplied project state support a specific semantic connection.',
    'Use the narrowest valid relationship. Shared vocabulary, proximity, or general project relevance is not enough.',
    'informs means information helps evaluate the target; supports means evidence strengthens a conclusion; resolves means completed evidence already answers the target; satisfies means a NEXT_ACTION is intended to complete the target.',
    'contradicts or supersedes may connect resolved evidence to an OPEN RISK only when the evidence directly disproves or replaces the condition described by that risk.',
    'blocks means the source must be addressed before the target can proceed; depends_on means the source cannot proceed until the target is satisfied; affects means the source may materially change the target without necessarily blocking it.',
    'Return one classification for any pair you classify and choose only from that pair allowedTypes or NONE.',
    JSON.stringify({ nodes, existing_edges: edges, pairs }),
  ].join('\n');
}

export async function completeProjectRelationships(
  params: CompleteProjectRelationshipsInput,
): Promise<CompleteProjectRelationshipsResult> {
  const pairs = buildRelationshipCompletionPairs(
    params.projectAfter,
    params.changedNodeIds,
    params.source.content,
  );
  const emptyTrace: RelationshipCompletionTrace = {
    candidatePairs: pairs,
    classifications: [],
    acceptedRelationships: [],
    rejectedRelationships: [],
  };
  if (pairs.length === 0) return { project: params.projectAfter, trace: emptyTrace };

  const prompt = completionPrompt(params.source, params.projectAfter, pairs);
  try {
    assertExternalServicesAllowed('Vertex AI / Gemini relationship completion');
    const model = params.model ?? getAgentModelConfig('context').model;
    const genAI = params.genAI ?? getVertexGenAIClient();
    const response = await genAI.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['classifications'],
          properties: {
            classifications: {
              type: Type.ARRAY,
              maxItems: 40,
              items: {
                type: Type.OBJECT,
                required: ['pair_id', 'relationship', 'confidence'],
                properties: {
                  pair_id: { type: Type.STRING },
                  relationship: { type: Type.STRING, enum: [...completionRelationshipSchema.options] },
                  confidence: { type: Type.NUMBER },
                },
              },
            },
          },
        },
      },
    });
    const rawResponse = response.text ?? '';
    const parsed = JSON.parse(rawResponse.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    const validated = validateStructuredOutput(completionResponseSchema, parsed);
    const pairsById = new Map(pairs.map((pair) => [pair.pairId, pair]));
    const classifications = validated.classifications
      .filter((classification) => pairsById.has(classification.pair_id))
      .map((classification) => ({
        pair_id: classification.pair_id,
        relationship: classification.relationship as EdgeType | 'NONE',
        confidence: classification.confidence,
      }));
    const invalidClassifications = classifications
      .filter((classification) => classification.relationship !== 'NONE')
      .filter((classification) => {
        const pair = pairsById.get(classification.pair_id)!;
        return !pair.allowedTypes.includes(classification.relationship as EdgeType);
      });
    const rejectedByPair = invalidClassifications.map((classification) => {
      const pair = pairsById.get(classification.pair_id)!;
      return {
        sourceNodeId: pair.sourceNodeId,
        targetNodeId: pair.targetNodeId,
        type: classification.relationship as EdgeType,
        confidence: classification.confidence,
        reason: 'relationship_not_allowed_for_pair',
      };
    });
    const candidates = classifications
      .filter((classification) => classification.relationship === 'NONE'
        || pairsById.get(classification.pair_id)?.allowedTypes.includes(classification.relationship as EdgeType))
      .filter((classification): classification is RelationshipCompletionClassification & { relationship: EdgeType } => classification.relationship !== 'NONE')
      .map((classification) => {
        const pair = pairsById.get(classification.pair_id)!;
        return {
          sourceNodeId: pair.sourceNodeId,
          targetNodeId: pair.targetNodeId,
          type: classification.relationship,
          confidence: classification.confidence,
        };
      });
    const persisted = applyCanonicalRelationshipCandidates(
      params.projectAfter,
      candidates,
      params.source.id,
      params.source.filename,
    );
    return {
      project: persisted.project,
      trace: {
        ...emptyTrace,
        classifications,
        acceptedRelationships: persisted.trace.acceptedRelationships,
        rejectedRelationships: [
          ...rejectedByPair,
          ...persisted.trace.rejectedRelationships,
        ],
        prompt,
        rawResponse,
      },
    };
  } catch (error) {
    return {
      project: params.projectAfter,
      trace: {
        ...emptyTrace,
        prompt,
        error: error instanceof Error ? error.message : 'Relationship completion unavailable.',
      },
    };
  }
}
