import { NextResponse } from 'next/server';
import { z } from 'zod';
import { latestDecisionMapActivity, listTraces, recordTrace, updateLatestDecisionMapRenderer } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getAgentModelPolicy } from '@/lib/agents/modelPolicy';
import { isDemoMode } from '@/lib/runtime/demoMode';
import type { DecisionMapDebugTrace } from '@/lib/graph/decisionMapDebug';
import {
  buildDecisionMapActivityFingerprintFromDebug,
  decisionMapWarningCodes,
  nodeTextFromDebug,
  type DecisionMapActivityType,
} from '@/lib/graph/decisionMapActivity';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const userId = await requireAuthenticatedUserId(request, url.searchParams.get('userId') ?? undefined);
    const execution = isDemoMode() ? 'not_used' : 'would_use';
    const agentPolicy = Object.values(getAgentModelPolicy()).map((config) => ({
      agentName: `${config.role[0].toUpperCase()}${config.role.slice(1)} Agent`,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      maxOutputTokens: config.maxOutputTokens,
      execution,
    }));
    return NextResponse.json({ traces: listTraces(userId), agentPolicy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }
}

const decisionMapTraceSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  persistActivity: z.boolean().optional(),
  activityFingerprint: z.string().min(1).optional(),
  activityTrigger: z.string().trim().max(240).optional(),
  decisionMapDebug: z.object({
    schemaVersion: z.literal(1),
    projectId: z.string().trim().min(1),
    capturedAt: z.string().trim().min(1),
    render: z.object({ filter: z.string(), selectedNodeId: z.string().nullable(), focusMode: z.boolean(), pathMode: z.boolean(), rendererReported: z.boolean() }),
    rawProjectGraph: z.object({ totalNodes: z.number(), totalEdges: z.number(), nodes: z.array(z.object({ id: z.string() }).passthrough()), edges: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough(),
    semanticGraphInterpretation: z.unknown(),
    currentFocusAnalysis: z.unknown(),
    whyThisMattersDebug: z.unknown(),
    filterVisibilityTrace: z.unknown(),
    layoutDiagnostics: z.unknown(),
    renderedMapReadabilitySummary: z.object({
      visibleNodes: z.number(),
      currentFocusActionNodeId: z.string().nullable(),
    }).passthrough(),
  }).passthrough(),
});

/**
 * The renderer sends deterministic, user-owned graph diagnostics here so the
 * existing Decision Map Activity panel can inspect the same in-memory trace
 * feed as server-side graph work. No project data is modified.
 */
export async function POST(request: Request) {
  const parsed = decisionMapTraceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid Decision Map debug trace.' }, { status: 400 });
  try {
    const userId = await requireAuthenticatedUserId(request, parsed.data.userId);
    const decisionMapDebug = parsed.data.decisionMapDebug as unknown as DecisionMapDebugTrace;
    const warningCodes = decisionMapWarningCodes(decisionMapDebug);
    const fingerprint = parsed.data.activityFingerprint
      ?? buildDecisionMapActivityFingerprintFromDebug(decisionMapDebug, warningCodes);

    if (parsed.data.persistActivity === false) {
      const trace = updateLatestDecisionMapRenderer(userId, decisionMapDebug.projectId, fingerprint, decisionMapDebug);
      return NextResponse.json({ id: trace?.id ?? null, updated: Boolean(trace) });
    }

    const previous = latestDecisionMapActivity(userId, decisionMapDebug.projectId);
    if (previous?.decisionMapActivity?.fingerprint === fingerprint) {
      return NextResponse.json({ id: previous.id, duplicate: true });
    }

    const activityType: DecisionMapActivityType = !previous
      ? 'map_built'
      : warningCodes.some((warning) => !previous.decisionMapActivity?.warningCodes.includes(warning))
        ? 'map_debug'
        : 'map_updated';
    const previousDebug = previous?.decisionMapDebug;
    const currentNodes = new Map(decisionMapDebug.rawProjectGraph.nodes.map((node) => [node.id, node]));
    const previousNodes = new Map(previousDebug?.rawProjectGraph.nodes.map((node) => [node.id, node]) ?? []);
    const addedNodes = [...currentNodes.keys()].filter((id) => !previousNodes.has(id)).length;
    const removedNodes = [...previousNodes.keys()].filter((id) => !currentNodes.has(id)).length;
    const resolvedNodes = [...currentNodes.values()].filter((node) => node.status === 'RESOLVED' && previousNodes.get(node.id)?.status !== 'RESOLVED').length;
    const currentEdges = new Set(decisionMapDebug.rawProjectGraph.edges.map((edge) => `${edge.source.id}:${edge.relationship}:${edge.target.id}`));
    const previousEdges = new Set(previousDebug?.rawProjectGraph.edges.map((edge) => `${edge.source.id}:${edge.relationship}:${edge.target.id}`) ?? []);
    const addedEdges = [...currentEdges].filter((edge) => !previousEdges.has(edge)).length;
    const removedEdges = [...previousEdges].filter((edge) => !currentEdges.has(edge)).length;
    const previousFocusId = previousDebug?.rawProjectGraph.focusAssessment?.actionNodeId ?? null;
    const currentFocusId = decisionMapDebug.rawProjectGraph.focusAssessment?.actionNodeId ?? null;
    const previousFocus = nodeTextFromDebug(previousDebug, previousFocusId);
    const currentFocus = nodeTextFromDebug(decisionMapDebug, currentFocusId);
    const changes = [
      addedNodes ? `+${addedNodes} node${addedNodes === 1 ? '' : 's'}` : '',
      removedNodes ? `-${removedNodes} node${removedNodes === 1 ? '' : 's'}` : '',
      addedEdges ? `+${addedEdges} relationship${addedEdges === 1 ? '' : 's'}` : '',
      removedEdges ? `-${removedEdges} relationship${removedEdges === 1 ? '' : 's'}` : '',
      resolvedNodes ? `${resolvedNodes} item${resolvedNodes === 1 ? '' : 's'} resolved` : '',
      previousFocus !== currentFocus && currentFocus ? `Focus: ${previousFocus ?? 'none'} → ${currentFocus}` : '',
    ].filter(Boolean);

    const trace = recordTrace({
      userId,
      route: '/ui/decision-map',
      label: 'Decision Map debug trace',
      started_at: decisionMapDebug.capturedAt,
      duration_ms: 0,
      agentNames: [],
      contextIds: decisionMapDebug.rawProjectGraph.nodes.map((node) => node.id),
      scores: [],
      toolCalls: ['deterministic Decision Map debug instrumentation'],
      decisionMapActivity: {
        projectId: decisionMapDebug.projectId,
        type: activityType,
        fingerprint,
        trigger: parsed.data.activityTrigger,
        change: changes.join(' · ') || (activityType === 'map_built' ? 'Initial semantic graph captured.' : undefined),
        focus: currentFocus,
        warningCodes,
      },
      decisionMapDebug,
    });
    return NextResponse.json({ id: trace.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }
}
