import { Project } from '@/types/clarity';
import { emptyGeneralContext } from '@/lib/scope/projectScope';
import {
  FirestoreContext,
  FirestoreConversation,
  FirestoreEdge,
  FirestoreNode,
  FirestoreSource,
} from '@/lib/storage/types';

export interface ProjectCollections {
  contexts: FirestoreContext[];
  nodes: FirestoreNode[];
  edges: FirestoreEdge[];
  sources: FirestoreSource[];
  conversations: FirestoreConversation[];
}

function nowIso(): string {
  return new Date().toISOString();
}

export function assertUserId(userId: string): void {
  if (!userId.trim()) {
    throw new Error('Storage calls require a non-empty userId.');
  }
}

export function projectToCollections(userId: string, project: Project): ProjectCollections {
  assertUserId(userId);
  const updatedAt = project.updated_at || nowIso();
  const projectId = project.id;

  return {
    contexts: [
      {
        id: project.id,
        userId,
        projectId,
        title: project.title,
        goal: project.goal,
        deadline: project.deadline,
        one_sentence_context: project.one_sentence_context,
        clarity_score: project.clarity_score,
        active_question: project.active_question ?? null,
        status: project.status === 'archived' ? 'ARCHIVED' : 'ACTIVE',
        createdAt: project.created_at,
        updatedAt,
      },
    ],
    nodes: project.nodes.map((node) => ({
      id: node.id,
      userId,
      projectId,
      createdBy: node.created_by,
      type: node.type,
      text: node.text,
      status: node.status,
      scope: 'project',
      confidence: node.confidence,
      importance: node.impact,
      priority: node.priority,
      sourceIds: node.source_refs,
      why_it_matters: node.why_it_matters,
      createdAt: node.created_at,
      updatedAt: node.updated_at,
      x: node.x,
      y: node.y,
    })),
    edges: project.edges.map((edge) => ({
      id: edge.id,
      userId,
      projectId,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      confidence: edge.confidence,
      scope: 'project',
      status: 'ACTIVE',
      createdAt: updatedAt,
      updatedAt,
    })),
    sources: project.sources.map((source) => ({
      id: source.id,
      userId,
      projectId,
      filename: source.filename,
      type: source.type,
      content: source.content,
      extracted_at: source.extracted_at,
      derived_node_ids: source.derived_node_ids,
      processing_status: source.processing_status ?? 'completed',
      storage_url: source.storage_url,
      mime_type: source.mime_type,
      size_bytes: source.size_bytes,
      hash: source.hash,
      origin: source.origin ?? 'user',
      extraction_summary: source.extraction_summary,
      error_message: source.error_message,
      processed_at: source.processed_at,
      model_used: source.model_used,
      extraction_hash: source.extraction_hash,
      relevance: source.relevance,
      discarded_at: source.discarded_at,
      status: 'ACTIVE',
      createdAt: source.extracted_at,
      updatedAt: source.extracted_at,
    })),
    conversations: project.history.map((item, index) => ({
      id: `conversation_${index}_${item.timestamp}`,
      userId,
      projectId,
      question: item.question,
      answer: item.answer,
      graph_diff_summary: item.graph_diff_summary,
      status: 'COMPLETED',
      createdAt: item.timestamp,
      updatedAt: item.timestamp,
    })),
  };
}

function belongsToProject<T extends { projectId?: string; scope?: string }>(
  item: T,
  context: FirestoreContext,
  defaultContextId?: string
): boolean {
  if (item.scope === 'global') return false;
  if (item.projectId) return item.projectId === context.id;
  return context.id === defaultContextId;
}

export function collectionsToProject(collections: ProjectCollections, projectId?: string): Project | null {
  const context =
    collections.contexts.find((item) => item.id === projectId) ??
    collections.contexts[0];

  if (!context) return null;
  const defaultContextId = collections.contexts[0]?.id;
  const nodes = collections.nodes.filter((node) => belongsToProject(node, context, defaultContextId));
  const edges = collections.edges.filter((edge) => belongsToProject(edge, context, defaultContextId));
  const sources = collections.sources.filter((source) => belongsToProject(source, context, defaultContextId));
  const conversations = collections.conversations.filter((conversation) =>
    belongsToProject(conversation, context, defaultContextId)
  );

  return {
    id: context.id,
    title: context.title,
    goal: context.goal,
    status: context.status === 'ARCHIVED' ? 'archived' : 'active',
    deadline: context.deadline,
    one_sentence_context: context.one_sentence_context,
    clarity_score: context.clarity_score,
    active_question: context.active_question ?? null,
    created_at: context.createdAt,
    updated_at: context.updatedAt,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      text: node.text,
      status: node.status as Project['nodes'][number]['status'],
      confidence: node.confidence,
      impact: node.importance,
      priority: node.priority,
      source_refs: node.sourceIds ?? [],
      why_it_matters: node.why_it_matters,
      created_by: node.createdBy ?? 'agent',
      created_at: node.createdAt,
      updated_at: node.updatedAt,
      x: node.x,
      y: node.y,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      confidence: edge.confidence,
    })),
    sources: sources.map((source) => ({
      id: source.id,
      filename: source.filename,
      type: source.type,
      content: source.content,
      extracted_at: source.extracted_at,
      derived_node_ids: source.derived_node_ids,
      processing_status: source.processing_status,
      storage_url: source.storage_url,
      mime_type: source.mime_type,
      size_bytes: source.size_bytes,
      hash: source.hash,
      origin: source.origin,
      extraction_summary: source.extraction_summary,
      error_message: source.error_message,
      processed_at: source.processed_at,
      model_used: source.model_used,
      extraction_hash: source.extraction_hash,
      relevance: source.relevance,
      discarded_at: source.discarded_at,
    })),
    history: conversations
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((conversation) => ({
        question: conversation.question,
        answer: conversation.answer,
        timestamp: conversation.createdAt,
        graph_diff_summary: conversation.graph_diff_summary,
      })),
  };
}

export function collectionsToProjects(collections: ProjectCollections): Project[] {
  return collections.contexts
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((context) => collectionsToProject(collections, context.id))
    .filter((project): project is Project => Boolean(project));
}

export function generalContextToCollections(userId: string, project: Project): Pick<ProjectCollections, 'nodes' | 'edges' | 'sources'> {
  const collections = projectToCollections(userId, project);
  return {
    nodes: collections.nodes.map(({ projectId: _projectId, ...node }) => ({ ...node, scope: 'global' })),
    edges: collections.edges.map(({ projectId: _projectId, ...edge }) => ({ ...edge, scope: 'global' })),
    sources: collections.sources.map(({ projectId: _projectId, ...source }) => ({ ...source, scope: 'global' })),
  };
}

type GeneralContextCollections = Pick<ProjectCollections, 'nodes' | 'sources'> & { edges?: FirestoreEdge[] };

export function collectionsToGeneralContext(collections: GeneralContextCollections): Project {
  const context = emptyGeneralContext();
  const nodes = collections.nodes.filter((node) => node.scope === 'global' && !node.projectId);
  const edges = (collections.edges ?? []).filter((edge) => edge.scope === 'global' && !edge.projectId);
  const sources = collections.sources.filter((source) => source.scope === 'global' && !source.projectId);
  const updatedAt = [...nodes.map((node) => node.updatedAt), ...edges.map((edge) => edge.updatedAt), ...sources.map((source) => source.updatedAt)].sort().at(-1);
  return {
    ...context,
    updated_at: updatedAt ?? context.updated_at,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      text: node.text,
      status: node.status as Project['nodes'][number]['status'],
      confidence: node.confidence,
      impact: node.importance,
      priority: node.priority,
      source_refs: node.sourceIds ?? [],
      why_it_matters: node.why_it_matters,
      created_by: node.createdBy ?? 'agent',
      created_at: node.createdAt,
      updated_at: node.updatedAt,
      x: node.x,
      y: node.y,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      confidence: edge.confidence,
    })),
    sources: sources.map((source) => ({
      id: source.id,
      filename: source.filename,
      type: source.type,
      content: source.content,
      extracted_at: source.extracted_at,
      derived_node_ids: source.derived_node_ids,
      processing_status: source.processing_status,
      storage_url: source.storage_url,
      mime_type: source.mime_type,
      size_bytes: source.size_bytes,
      hash: source.hash,
      origin: source.origin,
      extraction_summary: source.extraction_summary,
      error_message: source.error_message,
      processed_at: source.processed_at,
      model_used: source.model_used,
      extraction_hash: source.extraction_hash,
      relevance: source.relevance,
      discarded_at: source.discarded_at,
    })),
  };
}
