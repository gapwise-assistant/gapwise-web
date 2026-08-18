import { ClarityNode, ContextSource, EdgeType, Project, UserMemoryProfile } from '@/types/clarity';
import { calculateClarityScore, selectTopGap } from '@/lib/prioritization';
import { projectForReasoning } from '@/lib/context/sourceState';
import { linkOpenDecisionQuestions, matchesExplicitDecisionTitle } from '@/lib/decisions/anchoring';

export interface PrecomputedSourceNode {
  id?: string;
  type: ClarityNode['type'];
  text: string;
  confidence: number;
  impact?: number;
  whyItMatters?: string[];
  relatedNodeIds?: string[];
  relationship?: EdgeType;
  status?: ClarityNode['status'];
}

export interface PrecomputedRelationship {
  sourceNodeIndex: number;
  targetNodeId: string;
  type: EdgeType;
  confidence?: number;
}

export interface IngestSourceInput {
  sourceId?: string;
  filename: string;
  content: string;
  type: ContextSource['type'];
  mimeType?: string;
  sizeBytes?: number;
  storageUrl?: string;
  hash?: string;
  origin?: ContextSource['origin'];
  processingStatus?: ContextSource['processing_status'];
  errorMessage?: string;
  extractionSummary?: string;
  processedAt?: string;
  modelUsed?: string;
  extractionHash?: string;
  relevance?: ContextSource['relevance'];
  discardedAt?: string;
  derivedNodes?: PrecomputedSourceNode[];
  relationships?: PrecomputedRelationship[];
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function hashText(value: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `fallback_${Math.abs(hash)}`;
}

export function inferNodeType(content: string): ClarityNode['type'] {
  const lower = content.toLowerCase();
  if (/[?]|\bunknown\b|\bunclear\b|\bnot sure\b|\bmissing\b/.test(lower)) return 'UNKNOWN';
  if (/\bmust\b|\brequire\b|\bdeadline\b|\bconstraint\b|\bcannot\b|\bcan't\b|\bbudget\b/.test(lower)) return 'CONSTRAINT';
  if (/\bprefer\b|\bpriority\b|\bimportant to me\b|\bwork style\b/.test(lower)) return 'PREFERENCE';
  if (/\brisk\b|\bdownside\b|\bconcern\b|\bworried\b/.test(lower)) return 'RISK';
  return 'KNOWN';
}

export function summarizeExtraction(source: Pick<ContextSource, 'type' | 'content'>): string {
  if (source.type === 'image') return 'Image/screenshot added with user-visible text or description for provenance.';
  if (source.type === 'voice') return 'Voice note transcript or summary captured as personal context.';
  if (source.type === 'pdf') return 'PDF text/excerpt captured for graph extraction and retrieval.';
  return 'Text context captured for graph extraction and retrieval.';
}

function statusForNodeType(
  type: ClarityNode['type'],
  requestedStatus?: ClarityNode['status'],
  sourceContent = '',
  nodeText = '',
): ClarityNode['status'] {
  if (type === 'DECISION') {
    if (requestedStatus === 'OPEN' || requestedStatus === 'RESOLVED') return requestedStatus;
    if (matchesExplicitDecisionTitle(nodeText, sourceContent)) return 'OPEN';
  }
  return type === 'UNKNOWN' || type === 'ASSUMPTION' || type === 'RISK' || type === 'NEXT_ACTION' || type === 'GOAL' || type === 'EXPERIMENT'
    ? 'OPEN'
    : 'RESOLVED';
}

function nodeKey(type: ClarityNode['type'], text: string): string {
  return `${type}:${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

function mergeUnique(values: string[] | undefined, additions: string[] | undefined): string[] | undefined {
  const merged = Array.from(new Set([...(values ?? []), ...(additions ?? [])].filter(Boolean)));
  return merged.length ? merged : undefined;
}

function reconciliationNote(
  relationship: EdgeType,
  sourceFilename: string,
  targetText: string
): string | undefined {
  if (relationship === 'contradicts') {
    return `Questioned by newer evidence from ${sourceFilename}: ${targetText}`;
  }
  if (relationship === 'supersedes') {
    return `Superseded by newer evidence from ${sourceFilename}: ${targetText}`;
  }
  if (relationship === 'resolves') {
    return `Resolved by newer evidence from ${sourceFilename}: ${targetText}`;
  }
  return undefined;
}

function applyRelationshipState(
  target: ClarityNode,
  relationship: EdgeType,
  sourceId: string,
  sourceFilename: string,
  now: string
): void {
  target.source_refs = Array.from(new Set([...target.source_refs, sourceId]));
  const note = reconciliationNote(relationship, sourceFilename, target.text);
  if (note) target.why_it_matters = mergeUnique(target.why_it_matters, [note]);
  target.updated_at = now;

  if (relationship === 'contradicts' && ['KNOWN', 'ASSUMPTION', 'DECISION', 'EVIDENCE'].includes(target.type)) {
    target.status = 'DEFERRED';
  }
  if (relationship === 'supersedes') target.status = 'DEPRECATED';
  if (relationship === 'resolves' && ['UNKNOWN', 'ASSUMPTION'].includes(target.type)) {
    target.status = 'RESOLVED';
  }
}

export async function ingestContextSource(
  project: Project,
  input: IngestSourceInput,
  profile: UserMemoryProfile
): Promise<Project> {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const now = new Date().toISOString();
  const sourceId = input.sourceId ?? makeId('src');
  const content = input.content.trim();
  const previousSource = updated.sources.find((source) => source.id === sourceId);
  const previousDerivedNodeIds = new Set(previousSource?.derived_node_ids ?? []);
  const shouldCreateNode = Boolean(content) && (input.processingStatus ?? (content ? 'completed' : 'failed')) !== 'failed';
  if (previousSource) {
    if (shouldCreateNode) {
      previousDerivedNodeIds.forEach((nodeId) => {
        const previousNode = updated.nodes.find((node) => node.id === nodeId);
        if (!previousNode) return;
        const hasOtherActiveSource = previousNode.source_refs.some((ref) =>
          ref !== sourceId && updated.sources.some((source) => source.id === ref && !source.discarded_at)
        );
        if (hasOtherActiveSource) return;
        previousNode.status = 'DEPRECATED';
        previousNode.why_it_matters = mergeUnique(previousNode.why_it_matters, [
          `Retained as historical context after ${input.filename} was re-analyzed.`,
        ]);
        previousNode.updated_at = now;
      });
    }
    updated.sources = updated.sources.filter((source) => source.id !== sourceId);
  }
  const nodeType = inferNodeType(content);
  const processingStatus = input.processingStatus ?? (content ? 'completed' : 'failed');
  const derivedNodes = input.derivedNodes ?? [];

  const newSource: ContextSource = {
    id: sourceId,
    filename: input.filename,
    type: input.type,
    content,
    extracted_at: now,
    derived_node_ids: [],
    processing_status: processingStatus,
    storage_url: input.storageUrl,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    hash: input.hash ?? (await hashText(`${input.filename}:${content}`)),
    origin: input.origin ?? 'user',
    extraction_summary: input.extractionSummary ?? summarizeExtraction({ type: input.type, content }),
    error_message: input.errorMessage ?? (content ? undefined : 'No extractable text or user description was provided.'),
    processed_at: input.processedAt,
    model_used: input.modelUsed,
    extraction_hash: input.extractionHash,
    relevance: input.relevance ?? 'relevant',
    discarded_at: input.discardedAt ?? previousSource?.discarded_at,
  };

  updated.sources.push(newSource);

  if (shouldCreateNode) {
    const nodesToProcess = derivedNodes.length
      ? derivedNodes
      : [{
          type: nodeType,
          text: `From ${input.filename}: ${content.slice(0, 140)}${content.length > 140 ? '...' : ''}`,
          confidence: input.type === 'text' || input.type === 'note' || input.type === 'pdf' ? 0.86 : 0.68,
          impact: nodeType === 'CONSTRAINT' || nodeType === 'UNKNOWN' ? 0.78 : 0.62,
        }];
    const nodeIds: string[] = [];

    nodesToProcess.forEach((node) => {
      const key = nodeKey(node.type, node.text);
      const existingNode = updated.nodes.find((candidate) => nodeKey(candidate.type, candidate.text) === key);
      if (existingNode) {
        existingNode.source_refs = Array.from(new Set([...existingNode.source_refs, sourceId]));
        existingNode.confidence = Math.max(existingNode.confidence, node.confidence);
        existingNode.impact = Math.max(existingNode.impact, node.impact ?? node.confidence);
        existingNode.why_it_matters = mergeUnique(existingNode.why_it_matters, node.whyItMatters);
        existingNode.updated_at = now;
        if (previousDerivedNodeIds.has(existingNode.id)) {
          existingNode.status = statusForNodeType(existingNode.type, node.status, content, node.text);
        } else if (existingNode.type === 'DECISION' && node.status === 'OPEN') {
          existingNode.status = 'OPEN';
        }
        nodeIds.push(existingNode.id);
        return;
      }

      const createdNode: ClarityNode = {
        id: node.id ?? makeId('node_ext'),
        type: node.type,
        text: node.text,
        status: statusForNodeType(node.type, node.status, content, node.text),
        confidence: node.confidence,
        impact: node.impact ?? node.confidence,
        source_refs: [sourceId],
        why_it_matters: node.whyItMatters,
        created_by: 'agent',
        created_at: now,
        updated_at: now,
        x: 180 + Math.random() * 360,
        y: 220 + Math.random() * 280,
      };
      updated.nodes.push(createdNode);
      nodeIds.push(createdNode.id);
    });

    newSource.derived_node_ids = nodeIds;

    const relationships: PrecomputedRelationship[] = [
      ...(input.relationships ?? []),
      ...nodesToProcess.flatMap((node, sourceNodeIndex) =>
        node.relationship && node.relatedNodeIds?.length
          ? node.relatedNodeIds.map((targetNodeId) => ({
              sourceNodeIndex,
              targetNodeId,
              type: node.relationship as EdgeType,
              confidence: node.confidence,
            }))
          : []
      ),
    ];

    relationships.forEach((relationship) => {
      const sourceNodeId = nodeIds[relationship.sourceNodeIndex];
      const targetNodeId = relationship.targetNodeId.startsWith('new:')
        ? nodeIds[Number(relationship.targetNodeId.slice(4))]
        : relationship.targetNodeId;
      if (!sourceNodeId || !targetNodeId) return;
      const targetNode = updated.nodes.find((candidate) => candidate.id === targetNodeId);
      if (sourceNodeId === targetNodeId) {
        if (targetNode && relationship.type === 'resolves') {
          applyRelationshipState(targetNode, relationship.type, sourceId, input.filename, now);
        }
        return;
      }
      if (!updated.nodes.some((candidate) => candidate.id === targetNodeId)) return;
      const confidence = relationship.confidence ?? nodesToProcess[relationship.sourceNodeIndex]?.confidence ?? 0;
      if (confidence < 0.6) return;
      const exists = updated.edges.some((edge) =>
        edge.source === sourceNodeId && edge.target === targetNodeId && edge.type === relationship.type
      );
      if (!exists) {
        updated.edges.push({
          id: makeId('edge_context'),
          source: sourceNodeId,
          target: targetNodeId,
          type: relationship.type,
          confidence,
        });
      }
      if (targetNode) applyRelationshipState(targetNode, relationship.type, sourceId, input.filename, now);
    });

    linkOpenDecisionQuestions(updated, sourceId, content, nodeIds, now);
  }

  const reasoningProject = projectForReasoning(updated);
  updated.clarity_score = calculateClarityScore(reasoningProject);
  updated.active_question = selectTopGap(reasoningProject, profile);
  updated.updated_at = now;
  return updated;
}

export function discardContextSource(project: Project, sourceId: string, profile: UserMemoryProfile): Project {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const source = updated.sources.find((candidate) => candidate.id === sourceId);
  if (!source) return project;
  source.discarded_at = source.discarded_at ?? new Date().toISOString();
  const reasoningProject = projectForReasoning(updated);
  updated.clarity_score = calculateClarityScore(reasoningProject);
  updated.active_question = selectTopGap(reasoningProject, profile);
  updated.updated_at = new Date().toISOString();
  return updated;
}

export function restoreContextSource(project: Project, sourceId: string, profile: UserMemoryProfile): Project {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const source = updated.sources.find((candidate) => candidate.id === sourceId);
  if (!source) return project;
  delete source.discarded_at;
  const reasoningProject = projectForReasoning(updated);
  updated.clarity_score = calculateClarityScore(reasoningProject);
  updated.active_question = selectTopGap(reasoningProject, profile);
  updated.updated_at = new Date().toISOString();
  return updated;
}

// Compatibility for older callers: removal now means reversible discard.
export function removeContextSource(project: Project, sourceId: string, profile: UserMemoryProfile): Project {
  return discardContextSource(project, sourceId, profile);
}
