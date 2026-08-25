import { Type } from '@google/genai';
import { z } from 'zod';
import type { Project, UserMemoryProfile } from '@/types/clarity';
import type { ContextPack } from '@/types/contextPack';
import type { AttentionCandidate, AttentionScoreFactors } from '@/types/attention';
import { generateAttentionCandidates } from '@/lib/attention/candidates';
import { calculateAttentionScore } from '@/lib/attention/scoring';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { sequenceFocusAssessments } from '@/lib/focus/sequencing';
import { isNextActionSatisfied } from '@/lib/actions/completion';
import { normalizeFocusAssessment } from '@/lib/focus/normalizeFocusAssessment';

export type FocusAssessment = {
  kind: 'question' | 'decision' | 'action' | 'discovery';
  title: string;
  nextAction?: string;
  whyNow?: string;
  /** The unresolved project state that controls the primary workflow. */
  targetNodeId?: string;
  /** An existing NEXT_ACTION that advances the target, when one exists. */
  executionNodeId?: string;
  /** Nodes already represented by this focus recommendation in Today. */
  representedNodeIds: string[];
  sourceNodeIds: string[];
  sourceIds: string[];
  /**
   * Backwards-compatible alias for the normalized target node.
   */
  actionNodeId?: string;
  score: number;
  confidence: number;
};

const factorsSchema = z.object({
  goal_alignment: z.number().min(0).max(1),
  impact: z.number().min(0).max(1),
  urgency: z.number().min(0).max(1),
  actionability: z.number().min(0).max(1),
  evidence_confidence: z.number().min(0).max(1),
  unresolved_risk: z.number().min(0).max(1),
  momentum: z.number().min(0).max(1),
  estimated_effort: z.number().min(0).max(1),
});

const derivedSchema = z.object({
  candidates: z.array(z.object({
    kind: z.enum(['question', 'decision', 'action', 'discovery']),
    title: z.string().min(1).max(180),
    nextAction: z.string().min(1).max(240),
    whyNow: z.string().min(1).max(280),
    sourceNodeIds: z.array(z.string()).max(8),
    sourceIds: z.array(z.string()).max(8),
    targetNodeId: z.string().optional(),
    executionNodeId: z.string().optional(),
    representedNodeIds: z.array(z.string()).max(8).optional(),
    actionNodeId: z.string().optional(),
    confidence: z.number().min(0).max(1),
    factors: factorsSchema,
  })).max(3),
});

type DerivedCandidate = z.infer<typeof derivedSchema>['candidates'][number];

function isGenericPrioritizationAction(node: Project['nodes'][number]): boolean {
  if (node.type !== 'NEXT_ACTION') return false;
  return /\b(?:decide|determine|choose|identify|resolve)\b.*\b(?:what|which)\b.*\b(?:focus|priorit)/i.test(node.text)
    || /\b(?:first focus area|what to focus on|what to prioritize|what should be addressed first)\b/i.test(node.text);
}

function assessmentKind(candidate: AttentionCandidate, project: Project): FocusAssessment['kind'] {
  const primary = project.nodes.find((node) => node.id === candidate.source_node_ids[0]);
  if (primary?.type === 'DECISION') return 'decision';
  if (primary?.type === 'NEXT_ACTION') return 'action';
  return 'question';
}

function fromAttentionCandidate(candidate: AttentionCandidate, project: Project): FocusAssessment {
  const actionNode = candidate.action_node_id
    ? project.nodes.find((node) => node.id === candidate.action_node_id)
    : undefined;
  const validActionNode = actionNode?.status === 'OPEN'
    && ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'NEXT_ACTION'].includes(actionNode.type)
    && !isGenericPrioritizationAction(actionNode)
    && (actionNode.type !== 'NEXT_ACTION' || !isNextActionSatisfied(project, actionNode))
    ? actionNode
    : undefined;
  return {
    kind: assessmentKind(candidate, project),
    title: candidate.title,
    nextAction: candidate.next_action,
    whyNow: candidate.reason,
    sourceNodeIds: candidate.source_node_ids,
    sourceIds: candidate.source_ids,
    targetNodeId: validActionNode?.id,
    representedNodeIds: [],
    actionNodeId: validActionNode?.id,
    score: candidate.score,
    confidence: candidate.factors.evidence_confidence,
  };
}

function compactProjectState(project: Project, contextPack: ContextPack, profile?: UserMemoryProfile): string {
  const openNodes = project.nodes
    .filter((node) => node.status === 'OPEN')
    .slice(0, 30)
    .map((node) => ({
      id: node.id,
      type: node.type,
      text: node.text,
      impact: node.impact,
      confidence: node.confidence,
      source_refs: node.source_refs,
    }));
  return JSON.stringify({
    project: { title: project.title, goal: project.goal, deadline: project.deadline },
    openNodes,
    evidence: contextPack.relevantEvidence.slice(0, 10),
    commitments: contextPack.upcomingCommitments.slice(0, 8),
    recentDecisions: contextPack.recentDecisions.slice(0, 8),
    preferences: contextPack.userPreferences.slice(0, 8).map((memory) => memory.text),
    edges: project.edges
      .filter((edge) => edge.type === 'blocks' || edge.type === 'depends_on')
      .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
    profile,
  });
}

async function deriveCandidates(
  project: Project,
  contextPack: ContextPack,
  profile?: UserMemoryProfile,
): Promise<DerivedCandidate[]> {
  if (isDemoMode()) return [];
  const model = getAgentModelConfig('attention');
  const response = await getVertexGenAIClient().models.generateContent({
    model: model.model,
    contents: [{ role: 'user', parts: [{ text: [
      'Assess what would most usefully move this project forward now.',
      'You may propose a derived action or discovery that is not stored as a graph node, especially when validating a key premise would be more useful than prematurely deciding logistics.',
      'Do not merely restate the user question, project goal, or a vague instruction to decide what to do first.',
      'Every recommendation must be grounded in the supplied project state. Cite only IDs that appear there.',
      'Every focus recommendation should identify an existing actionable project node when one directly represents the decision, uncertainty, or action the user should address.',
      'targetNodeId identifies the unresolved project state the user is trying to change and controls the workflow CTA.',
      'executionNodeId identifies an existing NEXT_ACTION that describes how to advance the target.',
      'When an action investigates or resolves an existing open question, targetNodeId must reference the question and executionNodeId must reference the action.',
      'representedNodeIds contains the target and execution nodes already covered by the recommendation.',
      'sourceNodeIds are supporting provenance and must not be treated as action targets.',
      'Do not use a generic planning or prioritization action as targetNodeId when its only purpose is deciding what to focus on.',
      'A recommendation may be derived, but if acting on it means resolving an existing OPEN DECISION, UNKNOWN, or ASSUMPTION, targetNodeId should point to that node.',
      'Leave targetNodeId unset only when no existing actionable node directly represents the recommendation.',
      'Do not recommend an action node as the current focus when it has an unresolved prerequisite.',
      'For depends_on, the source depends on the target. For blocks, the source blocks the target.',
      'When a candidate is blocked, prefer the unresolved actionable prerequisite that must be addressed first.',
      'Relationships such as informs and affects may influence priority but do not make a candidate ineligible.',
      'Score every candidate using the supplied Attention factors. Do not invent a different scoring system.',
      'Return at most three candidates. Return none when stored project items already express the best focus.',
      compactProjectState(project, contextPack, profile),
    ].join('\n\n') }] }],
    config: {
      temperature: 0,
      maxOutputTokens: model.maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: ['candidates'],
        properties: {
          candidates: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['kind', 'title', 'nextAction', 'whyNow', 'sourceNodeIds', 'sourceIds', 'confidence', 'factors'],
              properties: {
                kind: { type: Type.STRING, enum: ['question', 'decision', 'action', 'discovery'] },
                title: { type: Type.STRING },
                nextAction: { type: Type.STRING },
                whyNow: { type: Type.STRING },
                sourceNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                sourceIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                targetNodeId: { type: Type.STRING },
                executionNodeId: { type: Type.STRING },
                representedNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                actionNodeId: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                factors: {
                  type: Type.OBJECT,
                  required: ['goal_alignment', 'impact', 'urgency', 'actionability', 'evidence_confidence', 'unresolved_risk', 'momentum', 'estimated_effort'],
                  properties: Object.fromEntries([
                    'goal_alignment', 'impact', 'urgency', 'actionability', 'evidence_confidence',
                    'unresolved_risk', 'momentum', 'estimated_effort',
                  ].map((key) => [key, { type: Type.NUMBER }])),
                },
              },
            },
          },
        },
      },
    },
  });
  const parsed = JSON.parse(response.text?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '') || '{}');
  return derivedSchema.parse(parsed).candidates;
}

export async function generateFocusAssessment(
  project: Project,
  contextPack: ContextPack,
  profile?: UserMemoryProfile,
): Promise<FocusAssessment | null> {
  const stored = generateAttentionCandidates({
    userId: contextPack.id || 'focus-assessment',
    project,
    memories: contextPack.userPreferences,
    contextPack,
  }).filter((candidate) => candidate.status === 'active' && candidate.kind !== 'risk');
  const assessments = stored.map((candidate) => fromAttentionCandidate(candidate, project));
  try {
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    const actionableNodeIds = new Set(project.nodes
      .filter((node) => node.status === 'OPEN'
        && ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'NEXT_ACTION'].includes(node.type)
        && !isGenericPrioritizationAction(node)
        && (node.type !== 'NEXT_ACTION' || !isNextActionSatisfied(project, node)))
      .map((node) => node.id));
    const sourceIds = new Set(project.sources.map((source) => source.id));
    const derived = await deriveCandidates(project, contextPack, profile);
    derived.forEach((candidate) => {
      const candidateTargetId = candidate.targetNodeId ?? candidate.actionNodeId;
      const targetNodeId = candidateTargetId && actionableNodeIds.has(candidateTargetId)
        ? candidateTargetId
        : undefined;
      // An explicitly targeted recommendation is invalid when that target is
      // already satisfied (or otherwise no longer actionable). Do not retain
      // it as an untargeted high-scoring recommendation.
      if (candidateTargetId && !targetNodeId) return;
      const factors = candidate.factors as AttentionScoreFactors;
      assessments.push({
        kind: candidate.kind,
        title: candidate.title,
        nextAction: candidate.nextAction,
        whyNow: candidate.whyNow,
        sourceNodeIds: candidate.sourceNodeIds.filter((id) => nodeIds.has(id)),
        sourceIds: candidate.sourceIds.filter((id) => sourceIds.has(id)),
        targetNodeId,
        executionNodeId: candidate.executionNodeId,
        representedNodeIds: candidate.representedNodeIds?.filter((id) => nodeIds.has(id)) ?? [],
        actionNodeId: targetNodeId,
        score: calculateAttentionScore(factors),
        confidence: candidate.confidence,
      });
    });
  } catch (error) {
    console.warn('[Focus Assessment] Derived recommendation unavailable; using stored candidates.', error);
  }
  const normalized = assessments.map((assessment) => normalizeFocusAssessment(project, assessment));
  return sequenceFocusAssessments(project, normalized)
    .map((assessment) => normalizeFocusAssessment(project, assessment))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)[0] ?? null;
}

function focusAssessmentPromptLines(
  assessment: FocusAssessment,
  focusIntent: boolean,
): string {
  const lines = [
    'CURRENT SHARED FOCUS ASSESSMENT',
    `Kind: ${assessment.kind}`,
    `Title: ${assessment.title}`,
    assessment.whyNow ? `Why now: ${assessment.whyNow}` : '',
    assessment.nextAction ? `Next action: ${assessment.nextAction}` : '',
    assessment.targetNodeId ? `Target node ID: ${assessment.targetNodeId}` : '',
    assessment.executionNodeId ? `Execution node ID: ${assessment.executionNodeId}` : '',
    `Represented node IDs: ${(assessment.representedNodeIds ?? []).join(', ') || 'none'}`,
    `Source node IDs: ${assessment.sourceNodeIds.join(', ') || 'none (derived assessment)'}`,
    `Source IDs: ${assessment.sourceIds.join(', ') || 'none'}`,
  ];

  if (focusIntent) {
    lines.push(
      'The user is asking for project prioritization.',
      'Treat this Focus Assessment as the selected current project priority.',
      'Use targetNodeId as the primary project state and workflow target.',
      'Use executionNodeId and Next action only to explain how to advance that target; do not describe the execution as already complete.',
      'Do not replace it with a different primary recommendation.',
      'Explain it, justify it, or make it actionable conversationally.',
    );
  } else {
    lines.push('Use this assessment when relevant, but do not force it into unrelated answers.');
  }

  return lines.filter(Boolean).join('\n');
}

export function focusAssessmentPromptSection(
  assessment: FocusAssessment | null,
  focusIntent = false,
): string {
  if (!assessment) return '';
  return focusAssessmentPromptLines(assessment, focusIntent);
}
