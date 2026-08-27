import { Type } from '@google/genai';
import { z } from 'zod';
import type { ContextPack } from '@/types/contextPack';
import type {
  ClarityNode,
  Project,
  ProjectHistoryEvent,
} from '@/types/clarity';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';
import { getVertexGenAIClient } from '@/lib/google/genai';
import { projectForReasoning } from '@/lib/context/sourceState';
import { isNextActionSatisfied } from '@/lib/actions/completion';

export type ProjectTrajectory =
  | 'exploring'
  | 'taking_shape'
  | 'moving_forward'
  | 'at_risk'
  | 'blocked'
  | 'changing_direction'
  | 'ready_for_next_stage';

export interface ProjectOverviewAssessment {
  trajectory: {
    state: ProjectTrajectory;
    explanation: string;
  };
  summary: string;
  meaningfulChanges: Array<{
    title: string;
    whatChanged: string;
    consequence: string;
    sourceNodeIds: string[];
    historyEventIds: string[];
  }>;
  goalImpact: {
    summary: string;
    positiveFactors: Array<{
      text: string;
      sourceNodeIds: string[];
    }>;
    negativeFactors: Array<{
      text: string;
      sourceNodeIds: string[];
    }>;
  };
  unsettled: Array<{
    title: string;
    explanation: string;
    sourceNodeIds: string[];
  }>;
  criticalIssues: Array<{
    severity: 'high' | 'medium' | 'watch';
    title: string;
    explanation: string;
    sourceNodeIds: string[];
  }>;
  emergingInsights: Array<{
    text: string;
    explanation?: string;
    sourceNodeIds: string[];
  }>;
  confidence: number;
}

export interface ProjectOverviewReasoningPackage {
  project: {
    id: string;
    title: string;
    goal: string;
    deadline?: string;
  };
  canonicalNodes: Array<{
    id: string;
    type: ClarityNode['type'];
    status: ClarityNode['status'];
    text: string;
    impact: number;
    confidence: number;
    why_it_matters: string[];
  }>;
  canonicalRelationships: Array<{
    source: string;
    target: string;
    type: Project['edges'][number]['type'];
  }>;
  openItems: Array<{
    id: string;
    type: ClarityNode['type'];
    text: string;
    impact: number;
  }>;
  recentlyResolved: Array<{
    id: string;
    type: ClarityNode['type'];
    text: string;
    updatedAt: string;
  }>;
  recentHistory: Array<{
    id: string;
    type: ProjectHistoryEvent['type'];
    title: string;
    summary?: string;
    createdAt: string;
    sourceNodeIds: string[];
    affectedNodeIds: string[];
    changes: Array<{
      kind: string;
      nodeId?: string;
      text: string;
      status?: string;
    }>;
  }>;
  currentFocus: {
    kind: FocusAssessment['kind'];
    title: string;
    targetNodeId?: string;
    executionNodeId?: string;
    representedNodeIds: string[];
    actionNodeId?: string;
    sourceNodeIds: string[];
  } | null;
  upcomingCommitments: Array<{
    id: string;
    text: string;
    status: ClarityNode['status'];
  }>;
}

const trajectorySchema = z.enum([
  'exploring',
  'taking_shape',
  'moving_forward',
  'at_risk',
  'blocked',
  'changing_direction',
  'ready_for_next_stage',
]);

const overviewAssessmentSchema = z.object({
  trajectory: z.object({
    state: trajectorySchema,
    explanation: z.string().min(1).max(360),
  }),
  summary: z.string().min(1).max(900),
  meaningfulChanges: z.array(z.object({
    title: z.string().min(1).max(180),
    whatChanged: z.string().min(1).max(420),
    consequence: z.string().min(1).max(420),
    sourceNodeIds: z.array(z.string()).max(8),
    historyEventIds: z.array(z.string()).max(5),
  })).max(3),
  goalImpact: z.object({
    summary: z.string().min(1).max(600),
    positiveFactors: z.array(z.object({
      text: z.string().min(1).max(240),
      sourceNodeIds: z.array(z.string()).max(6),
    })).max(3),
    negativeFactors: z.array(z.object({
      text: z.string().min(1).max(240),
      sourceNodeIds: z.array(z.string()).max(6),
    })).max(3),
  }),
  unsettled: z.array(z.object({
    title: z.string().min(1).max(180),
    explanation: z.string().min(1).max(360),
    sourceNodeIds: z.array(z.string()).max(6),
  })).max(3),
  criticalIssues: z.array(z.object({
    severity: z.enum(['high', 'medium', 'watch']),
    title: z.string().min(1).max(180),
    explanation: z.string().min(1).max(420),
    sourceNodeIds: z.array(z.string()).max(8),
  })).max(3),
  emergingInsights: z.array(z.object({
    text: z.string().min(1).max(260),
    explanation: z.string().max(360).optional(),
    sourceNodeIds: z.array(z.string()).max(8),
  })).max(2),
  confidence: z.number().min(0).max(1),
});

function parseModelJson(text: string): unknown {
  const trimmed = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  return JSON.parse(trimmed || '{}');
}

function meaningfulTokens(value: string): Set<string> {
  const ignored = new Set([
    'what', 'where', 'when', 'which', 'who', 'how', 'why', 'does', 'could',
    'would', 'should', 'the', 'and', 'for', 'from', 'with', 'this', 'that',
    'about', 'into', 'your', 'you', 'can', 'will', 'have', 'need', 'know',
  ]);
  return new Set(value.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= 4 && !ignored.has(token)));
}

function recentEventIds(history: ProjectHistoryEvent[]): Set<string> {
  return new Set(history.slice(0, 10).map((event) => event.id));
}

function activeHistory(history: ProjectHistoryEvent[]): ProjectHistoryEvent[] {
  return history
    .filter((event) => Boolean(
      event.changes?.length ||
      event.affectedNodeIds?.length ||
      event.primaryNodeId ||
      event.type === 'decision_resolved' ||
      event.type === 'gap_resolved' ||
      event.type === 'goal_changed',
    ))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 10);
}

function goalConnectedNodeIds(project: Project): Set<string> {
  const related = new Set(
    project.nodes
      .filter((node) => node.type === 'GOAL')
      .map((node) => node.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    project.edges.forEach((edge) => {
      if (related.has(edge.source) && !related.has(edge.target)) {
        related.add(edge.target);
        changed = true;
      }
      if (related.has(edge.target) && !related.has(edge.source)) {
        related.add(edge.source);
        changed = true;
      }
    });
  }
  return related;
}

function buildPackage(
  project: Project,
  history: ProjectHistoryEvent[],
  focusAssessment: FocusAssessment | null,
  contextPack?: ContextPack,
): ProjectOverviewReasoningPackage {
  const reasoningProject = projectForReasoning(project);
  const recent = activeHistory(history);
  const recentIds = recentEventIds(recent);
  const recentNodeIds = new Set(
    recent.flatMap((event) => [
      ...(event.sourceNodeIds ?? []),
      ...(event.affectedNodeIds ?? []),
      ...(event.changes ?? []).map((change) => change.nodeId ?? ''),
      event.primaryNodeId ?? '',
    ]).filter(Boolean),
  );
  const goalNodeIds = goalConnectedNodeIds(reasoningProject);
  const focusNodeIds = new Set([
    ...(focusAssessment?.sourceNodeIds ?? []),
    ...(focusAssessment?.targetNodeId ? [focusAssessment.targetNodeId] : []),
    ...(focusAssessment?.executionNodeId ? [focusAssessment.executionNodeId] : []),
    ...(focusAssessment?.representedNodeIds ?? []),
  ]);
  const goalTokens = meaningfulTokens(`${reasoningProject.goal} ${reasoningProject.title}`);
  const edgeDegree = new Map<string, number>();
  reasoningProject.edges.forEach((edge) => {
    edgeDegree.set(edge.source, (edgeDegree.get(edge.source) ?? 0) + 1);
    edgeDegree.set(edge.target, (edgeDegree.get(edge.target) ?? 0) + 1);
  });

  const scoreNode = (node: ClarityNode): number => {
    const nodeTokens = meaningfulTokens(`${node.text} ${node.why_it_matters?.join(' ') ?? ''}`);
    const overlap = [...nodeTokens].filter((token) => goalTokens.has(token)).length;
    const isOpenPriority = node.status === 'OPEN' && [
      'DECISION', 'UNKNOWN', 'ASSUMPTION', 'RISK', 'NEXT_ACTION',
    ].includes(node.type)
      && !(node.type === 'NEXT_ACTION' && isNextActionSatisfied(reasoningProject, node));
    return (goalNodeIds.has(node.id) ? 40 : 0)
      + (focusNodeIds.has(node.id) ? 35 : 0)
      + (recentNodeIds.has(node.id) ? 30 : 0)
      + (isOpenPriority ? 25 : 0)
      + (node.type === 'GOAL' ? 20 : 0)
      + Math.min(edgeDegree.get(node.id) ?? 0, 4) * 4
      + overlap * 3
      + node.impact * 10
      + node.confidence * 5;
  };

  const selectedNodes = reasoningProject.nodes
    .filter((node) => node.status !== 'DEPRECATED')
    .sort((left, right) => scoreNode(right) - scoreNode(left))
    .slice(0, 40);
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  const summarizeNode = (node: ClarityNode) => ({
    id: node.id,
    type: node.type,
    status: node.status,
    text: node.text,
    impact: node.impact,
    confidence: node.confidence,
    why_it_matters: node.why_it_matters?.slice(0, 2) ?? [],
  });

  return {
    project: {
      id: reasoningProject.id,
      title: reasoningProject.title,
      goal: reasoningProject.goal,
      deadline: reasoningProject.deadline,
    },
    canonicalNodes: selectedNodes.map(summarizeNode),
    canonicalRelationships: reasoningProject.edges
      .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type })),
    openItems: selectedNodes
      .filter((node) => node.status === 'OPEN')
      .filter((node) => ['DECISION', 'UNKNOWN', 'ASSUMPTION', 'RISK', 'NEXT_ACTION'].includes(node.type))
      .filter((node) => !(node.type === 'NEXT_ACTION' && isNextActionSatisfied(reasoningProject, node)))
      .slice(0, 18)
      .map((node) => ({ id: node.id, type: node.type, text: node.text, impact: node.impact })),
    recentlyResolved: selectedNodes
      .filter((node) => node.status === 'RESOLVED')
      .filter((node) => recentNodeIds.has(node.id) || recentIds.size === 0)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 8)
      .map((node) => ({ id: node.id, type: node.type, text: node.text, updatedAt: node.updated_at })),
    recentHistory: recent.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      summary: event.summary,
      createdAt: event.createdAt,
      sourceNodeIds: event.sourceNodeIds ?? [],
      affectedNodeIds: event.affectedNodeIds ?? [],
      changes: (event.changes ?? []).slice(0, 8).map((change) => ({
        kind: change.kind,
        nodeId: change.nodeId,
        text: change.text,
        status: change.snapshot?.status,
      })),
    })),
    currentFocus: focusAssessment
      ? {
        kind: focusAssessment.kind,
        title: focusAssessment.title,
        targetNodeId: focusAssessment.targetNodeId,
        executionNodeId: focusAssessment.executionNodeId,
        representedNodeIds: focusAssessment.representedNodeIds,
        actionNodeId: focusAssessment.actionNodeId,
        sourceNodeIds: focusAssessment.sourceNodeIds,
      }
      : null,
    upcomingCommitments: (contextPack?.upcomingCommitments ?? [])
      .slice(0, 8)
      .map((node) => ({ id: node.id, text: node.text, status: node.status })),
  };
}

export function buildProjectOverviewReasoningPackage(
  project: Project,
  history: ProjectHistoryEvent[] = project.historyEvents ?? [],
  focusAssessment: FocusAssessment | null = null,
  contextPack?: ContextPack,
): ProjectOverviewReasoningPackage {
  return buildPackage(project, history, focusAssessment, contextPack);
}

function validateReferences(
  assessment: ProjectOverviewAssessment,
  reasoningPackage: ProjectOverviewReasoningPackage,
): ProjectOverviewAssessment {
  const nodeIds = new Set(reasoningPackage.canonicalNodes.map((node) => node.id));
  const nodeById = new Map(reasoningPackage.canonicalNodes.map((node) => [node.id, node]));
  const historyIds = new Set(reasoningPackage.recentHistory.map((event) => event.id));
  const unique = (ids: string[]) => [...new Set(ids)];
  const validNodes = (ids: string[]) => unique(ids).filter((id) => nodeIds.has(id));
  const validHistory = (ids: string[]) => unique(ids).filter((id) => historyIds.has(id));
  const validUnsettledNodes = (ids: string[]) => validNodes(ids).filter((id) => {
    const node = nodeById.get(id);
    return node?.status === 'OPEN' && ['DECISION', 'UNKNOWN', 'ASSUMPTION'].includes(node.type);
  });
  const validIssueNodes = (ids: string[]) => validNodes(ids).filter((id) => nodeById.get(id)?.type !== 'NEXT_ACTION');

  return {
    ...assessment,
    meaningfulChanges: assessment.meaningfulChanges
      .map((change) => ({
        ...change,
        sourceNodeIds: validNodes(change.sourceNodeIds),
        historyEventIds: validHistory(change.historyEventIds),
      }))
      .filter((change) => change.sourceNodeIds.length > 0 && change.historyEventIds.length > 0),
    goalImpact: {
      ...assessment.goalImpact,
      positiveFactors: assessment.goalImpact.positiveFactors
        .map((factor) => ({ ...factor, sourceNodeIds: validNodes(factor.sourceNodeIds) }))
        .filter((factor) => factor.sourceNodeIds.length > 0),
      negativeFactors: assessment.goalImpact.negativeFactors
        .map((factor) => ({ ...factor, sourceNodeIds: validNodes(factor.sourceNodeIds) }))
        .filter((factor) => factor.sourceNodeIds.length > 0),
    },
    unsettled: assessment.unsettled
      .map((item) => ({ ...item, sourceNodeIds: validUnsettledNodes(item.sourceNodeIds) }))
      .filter((item) => item.sourceNodeIds.length > 0),
    criticalIssues: assessment.criticalIssues
      .map((issue) => ({ ...issue, sourceNodeIds: validIssueNodes(issue.sourceNodeIds) }))
      .filter((issue) => issue.sourceNodeIds.length > 0),
    emergingInsights: assessment.emergingInsights
      .map((insight) => ({ ...insight, sourceNodeIds: validNodes(insight.sourceNodeIds) }))
      .filter((insight) => insight.sourceNodeIds.length >= 2),
  };
}

export async function generateProjectOverviewAssessment(
  project: Project,
  history: ProjectHistoryEvent[] = project.historyEvents ?? [],
  focusAssessment: FocusAssessment | null = null,
  contextPack?: ContextPack,
  deps: {
    genAI?: ReturnType<typeof getVertexGenAIClient>;
    model?: string;
  } = {},
): Promise<ProjectOverviewAssessment> {
  const reasoningPackage = buildPackage(project, history, focusAssessment, contextPack);
  const modelConfig = getAgentModelConfig('context');
  const model = deps.model ?? modelConfig.model;
  const genAI = deps.genAI ?? getVertexGenAIClient();
  // Overview is a bounded synthesis, but it has several grounded sections.
  // Keep the cheap model while allowing enough room for complete structured JSON.
  const maxOutputTokens = Math.max(modelConfig.maxOutputTokens, 4096);
  const prompt = [
    'You are the Project Overview Assessment agent.',
    'Synthesize the canonical project state into a strategic briefing for a person returning to the project after some time away.',
    'Interpret the project; do not merely restate the goal, count nodes, or list graph records.',
    'The summary must be one strong 3–5 sentence synthesis of where the project stands. Do not repeat the trajectory explanation inside it.',
    'Keep the Overview strategic. Do not use tactical Today-style wording such as current efforts focus on, next step, review the evidence, or what to do first.',
    'Use only the supplied canonical nodes, relationships, history events, focus assessment, deadline, and commitments.',
    'Every meaningful change must reference at least one supplied sourceNodeId and one supplied historyEventId.',
    'Every goal factor, critical issue, and emerging insight must reference supplied sourceNodeIds.',
    'Do not invent facts, progress percentages, deadlines, categories, or unsupported team sentiment.',
    'Trajectory is qualitative. Choose the state that best describes the project now and explain it in one sentence.',
    'Meaningful changes must use whatChanged for the event and consequence for its project-level effect. Do not turn them into instructions.',
    'Still unsettled must contain at most three important OPEN DECISION, UNKNOWN, or ASSUMPTION nodes only.',
    'Critical issues should be current and strategic. Do not present resolved or deprecated items as current problems. Do not list unfinished NEXT_ACTIONs as issues unless the supplied project state shows that the action itself represents a risk.',
    'Emerging insights must synthesize at least two distinct supplied canonical nodes into an emerging pattern or direction. Do not restate one decision, congratulate the user, or provide generic advice. Omit weak insights.',
    'Do not expose technical relationship names in prose.',
    'Keep the output concise and within the schema limits. Return JSON only.',
    `Reasoning package:\n${JSON.stringify(reasoningPackage)}`,
  ].join('\n\n');

  const response = await genAI.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        required: [
          'trajectory',
          'summary',
          'meaningfulChanges',
          'goalImpact',
          'unsettled',
          'criticalIssues',
          'emergingInsights',
          'confidence',
        ],
        properties: {
          trajectory: {
            type: Type.OBJECT,
            required: ['state', 'explanation'],
            properties: {
              state: { type: Type.STRING, enum: trajectorySchema.options },
              explanation: { type: Type.STRING },
            },
          },
          summary: { type: Type.STRING },
          meaningfulChanges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['title', 'whatChanged', 'consequence', 'sourceNodeIds', 'historyEventIds'],
              properties: {
                title: { type: Type.STRING },
                whatChanged: { type: Type.STRING },
                consequence: { type: Type.STRING },
                sourceNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                historyEventIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
          },
          goalImpact: {
            type: Type.OBJECT,
            required: ['summary', 'positiveFactors', 'negativeFactors'],
            properties: {
              summary: { type: Type.STRING },
              positiveFactors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ['text', 'sourceNodeIds'],
                  properties: {
                    text: { type: Type.STRING },
                    sourceNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                },
              },
              negativeFactors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ['text', 'sourceNodeIds'],
                  properties: {
                    text: { type: Type.STRING },
                    sourceNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                },
              },
            },
          },
          unsettled: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['title', 'explanation', 'sourceNodeIds'],
              properties: {
                title: { type: Type.STRING },
                explanation: { type: Type.STRING },
                sourceNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
          },
          criticalIssues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['severity', 'title', 'explanation', 'sourceNodeIds'],
              properties: {
                severity: { type: Type.STRING, enum: ['high', 'medium', 'watch'] },
                title: { type: Type.STRING },
                explanation: { type: Type.STRING },
                sourceNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
          },
          emergingInsights: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['text', 'sourceNodeIds'],
              properties: {
                text: { type: Type.STRING },
                explanation: { type: Type.STRING },
                sourceNodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
          },
          confidence: { type: Type.NUMBER },
        },
      },
    },
  });

  const parsed = overviewAssessmentSchema.parse(parseModelJson(response.text ?? ''));
  return validateReferences(parsed, reasoningPackage);
}

export { overviewAssessmentSchema };
