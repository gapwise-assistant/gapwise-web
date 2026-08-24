import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listTraces, recordTrace } from '@/lib/observability/trace';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getAgentModelPolicy } from '@/lib/agents/modelPolicy';
import { isDemoMode } from '@/lib/runtime/demoMode';
import type { DecisionMapDebugTrace } from '@/lib/graph/decisionMapDebug';

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
  decisionMapDebug: z.object({
    schemaVersion: z.literal(1),
    projectId: z.string().trim().min(1),
    capturedAt: z.string().trim().min(1),
    render: z.object({ filter: z.string(), selectedNodeId: z.string().nullable(), focusMode: z.boolean(), pathMode: z.boolean(), rendererReported: z.boolean() }),
    rawProjectGraph: z.object({ totalNodes: z.number(), totalEdges: z.number(), nodes: z.array(z.object({ id: z.string() }).passthrough()), edges: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough(),
    semanticGraphInterpretation: z.unknown(),
    currentFocusAnalysis: z.unknown(),
    storyBackboneCandidates: z.unknown(),
    collapseExpansionAnalysis: z.unknown(),
    whyThisMattersDebug: z.unknown(),
    filterVisibilityTrace: z.unknown(),
    layoutDiagnostics: z.unknown(),
    renderedStoryReadabilitySummary: z.object({
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
      decisionMapDebug,
    });
    return NextResponse.json({ id: trace.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }
}
