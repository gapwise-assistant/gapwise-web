import type { ClarityNode } from '@/types/clarity';

export type GraphQuestionIntent = 'confirm' | 'correct';

/**
 * Keeps the presentation of an open assumption consistent across every
 * surface that opens it.
 */
export function graphQuestionIntent(
  node: Pick<ClarityNode, 'type' | 'status'>,
  requestedIntent?: GraphQuestionIntent,
): GraphQuestionIntent | undefined {
  if (requestedIntent) return requestedIntent;
  return node.type === 'ASSUMPTION' && node.status === 'OPEN' ? 'confirm' : undefined;
}
