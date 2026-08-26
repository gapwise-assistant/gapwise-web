import type { AskGraphContext } from '@/types/contextPack';
import { reasoningContextToAskGraphContext, retrieveProjectReasoningContext } from '@/lib/retrieval/projectReasoningContext';

/**
 * Selects a bounded, question-specific view of the persisted project graph.
 * This is read-only and is only called for the graph_reasoning Ask route.
 */
export function buildAskGraphContext(
  project: import('@/types/clarity').Project,
  message: string,
): AskGraphContext {
  const context = retrieveProjectReasoningContext({ project, query: message, mode: 'reasoning' });
  return reasoningContextToAskGraphContext(context, project.goal);
}
