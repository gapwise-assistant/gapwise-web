import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { askGapswiseLocally } from '@/lib/ask/localDemoAdapter';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getConfiguredGeminiModel } from '@/lib/google/genai';
import { estimateTokenCount, recordTrace } from '@/lib/observability/trace';
import { getAgentModelConfig } from '@/lib/agents/modelPolicy';

export const runtime = 'nodejs';

const offlineFallbackNotices = [
  'AI is not active right now. This response uses the data already in this project.',
  'The AI service is offline, so this is a local response based on your saved context.',
  'Here is an AI-style response using the context already available in this project.',
];
const localFallbackSystemPrompt = 'Use only the selected project context and clearly distinguish known facts from unresolved questions.';

function configuredModelConfig(provider: string, execution: string) {
  const config = getAgentModelConfig('partner');
  return {
    provider,
    agent: 'Partner Agent',
    model: config.model,
    thinkingLevel: config.thinkingLevel,
    maxOutputTokens: config.maxOutputTokens,
    retryAttempts: 3,
    profile: process.env.AGENT_MODEL_PROFILE?.trim().toLowerCase() === 'flagship' ? 'flagship' : 'cheap',
    execution,
  } as const;
}

function localModelConfig() {
  return configuredModelConfig(
    'Deterministic local response',
    'Not called locally; Partner Agent would be used when ADK is available',
  );
}

const askRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1),
  sessionId: z.string().trim().optional(),
  projectId: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  const started = Date.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = askRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid Ask request.', issues: parsed.error.issues }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, parsed.data.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }

  const askInput = { ...parsed.data, userId };

  try {
    const live = !isDemoMode();
    const result = live
      ? await askGapswise(askInput)
      : await askGapswiseLocally(askInput);
    if (live) {
      recordTrace({
        userId,
        route: '/api/ask',
        label: 'Live Ask response',
        started_at: new Date(started).toISOString(),
        duration_ms: Date.now() - started,
        agentNames: ['Partner Agent'],
        contextIds: [],
        scores: [],
        toolCalls: ['ADK /run_sse'],
        model: getConfiguredGeminiModel(),
        agentConfigs: [{
          ...configuredModelConfig('Vertex AI / Google ADK', 'Used'),
          agentName: 'Partner Agent',
          execution: 'used',
        }],
        agentRuns: [{
          runId: `partner_${started}`,
          agent: 'Partner Agent',
          model: getConfiguredGeminiModel(),
          thinkingLevel: getAgentModelConfig('partner').thinkingLevel,
          inputTokens: estimateTokenCount(parsed.data.message),
          outputTokens: estimateTokenCount(result.answer ?? ''),
          latencyMs: Date.now() - started,
          estimatedCost: 0,
          costSource: 'unavailable',
          validationStatus: 'passed',
          confidence: null,
          escalated: false,
          execution: 'used',
          inputSummary: 'Project-scoped Context Pack supplied to the Partner Agent',
          outputSummary: 'Structured answer returned to Ask UI',
        }],
      });
    }
    return NextResponse.json(isDemoMode()
      ? {
          ...result,
          generatedBy: 'local-context',
          modelConfig: localModelConfig(),
          fallbackPrompt: parsed.data.message,
          fallbackSystemPrompt: localFallbackSystemPrompt,
        }
      : {
          ...result,
          modelConfig: {
            ...configuredModelConfig('Vertex AI / Google ADK', 'Used'),
            model: getConfiguredGeminiModel(),
          },
        });
  } catch (error) {
    if (isDemoMode()) {
      return NextResponse.json(
        { error: error instanceof Error ? `Local demo Ask failed: ${error.message}` : 'Local demo Ask failed.' },
        { status: 500 }
      );
    }
    try {
      const fallback = await askGapswiseLocally(askInput);
      const notice = offlineFallbackNotices[Math.floor(Math.random() * offlineFallbackNotices.length)];
      return NextResponse.json({
        ...fallback,
        modelConfig: localModelConfig(),
        answer: `${notice}\n\n${fallback.answer}`,
        generatedBy: 'local-fallback',
        fallbackPrompt: parsed.data.message,
        fallbackSystemPrompt: localFallbackSystemPrompt,
        warning: 'The deployed AI agent is unavailable; this answer was generated from the current project context.',
      });
    } catch {
      // Preserve the existing error response if the local context fallback is also unavailable.
    }
    const message = error instanceof AskAgentError
      ? error.message
      : 'Gapwise agent is unavailable right now.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
