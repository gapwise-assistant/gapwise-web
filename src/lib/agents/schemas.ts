import { z } from 'zod';
import { NodeType } from '@/types/clarity';

export const agentNames = {
  context: 'Context Agent',
  gap: 'Gap Agent',
  attention: 'Attention Agent',
  partner: 'Partner Agent',
} as const;

export const nodeTypeSchema = z.enum([
  'GOAL',
  'KNOWN',
  'CONSTRAINT',
  'ASSUMPTION',
  'DECISION',
  'UNKNOWN',
  'EVIDENCE',
  'EXPERIMENT',
  'RISK',
  'NEXT_ACTION',
  'PREFERENCE',
] satisfies [NodeType, ...NodeType[]]);

export const contextExtractionSchema = z.object({
  facts: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  commitments: z.array(z.string()).default([]),
  candidateUnknowns: z.array(z.string()).default([]),
  durableMemoryCandidates: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
});

export const graphUpdateSchema = z.object({
  createNodes: z.array(
    z.object({
      type: nodeTypeSchema,
      text: z.string().min(1),
      confidence: z.number().min(0).max(1),
      impact: z.number().min(0).max(1),
      sourceRefs: z.array(z.string()).default([]),
    })
  ),
  createEdges: z.array(
    z.object({
      source: z.string().min(1),
      target: z.string().min(1),
      type: z.enum(['supports', 'contradicts', 'depends_on', 'blocks', 'informs', 'resolves', 'satisfies', 'derived_from', 'supersedes', 'affects']),
    })
  ),
});

export const gapAgentOutputSchema = z.object({
  selectedGapNodeId: z.string().nullable(),
  question: z.string().nullable(),
  priority: z.number().min(0).max(1).nullable(),
  retrievalAnswered: z.boolean(),
  reasons: z.array(z.string()),
});

export const attentionRecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  score: z.number().min(0).max(1),
  sourceNodeIds: z.array(z.string()).default([]),
  nextAction: z.string(),
});

export const attentionAgentOutputSchema = z.object({
  recommendations: z.array(attentionRecommendationSchema).max(5),
});

export const partnerAgentOutputSchema = z.object({
  mode: z.enum(['ask_question', 'recommend_action', 'acknowledge']),
  message: z.string(),
  question: z.string().nullable(),
  action: z.string().nullable(),
  citedNodeIds: z.array(z.string()).default([]),
});

export const orchestratorTraceSchema = z.object({
  turnId: z.string(),
  userId: z.string(),
  input: z.string(),
  agentEvents: z.array(
    z.object({
      agentName: z.enum([
        agentNames.context,
        agentNames.gap,
        agentNames.attention,
        agentNames.partner,
      ]),
      summary: z.string(),
      timestamp: z.string(),
      contextIds: z.array(z.string()).optional(),
    })
  ),
});

export type ContextExtraction = z.infer<typeof contextExtractionSchema>;
export type GraphUpdate = z.infer<typeof graphUpdateSchema>;
export type GapAgentOutput = z.infer<typeof gapAgentOutputSchema>;
export type AttentionRecommendation = z.infer<typeof attentionRecommendationSchema>;
export type AttentionAgentOutput = z.infer<typeof attentionAgentOutputSchema>;
export type PartnerAgentOutput = z.infer<typeof partnerAgentOutputSchema>;
export type OrchestratorTrace = z.infer<typeof orchestratorTraceSchema>;

export function validateStructuredOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
