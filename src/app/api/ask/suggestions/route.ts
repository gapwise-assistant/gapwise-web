import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askGapswise, AskAgentError, type AskFailureStage } from '@/lib/ask/adkClient';
import { generateLocalAskSuggestions } from '@/lib/ask/localDemoAdapter';
import { buildSuggestionRequestMessage, parseSuggestedQuestions } from '@/lib/ask/suggestions';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { CAREER_CONFLICT_DEMO_ID } from '@/lib/demo/careerConflict';

export const runtime = 'nodejs';

const suggestionsRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  scopeLabel: z.string().trim().min(1).max(120).default('Everything'),
});

function failureStage(error: unknown): AskFailureStage {
  const candidate = error instanceof AskAgentError || (error && typeof error === 'object' && 'stage' in error)
    ? (error as { stage?: unknown }).stage
    : undefined;
  if (candidate === 'agent-auth' || candidate === 'agent-unavailable' || candidate === 'context-pack' || candidate === 'gemini') {
    return candidate;
  }
  if (error instanceof AskAgentError) {
    return 'agent-unavailable';
  }
  return 'gemini';
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = suggestionsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid suggestions request.', issues: parsed.error.issues }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, parsed.data.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }

  try {
    if (isDemoMode() || parsed.data.projectId === CAREER_CONFLICT_DEMO_ID) {
      const groups = await generateLocalAskSuggestions({
        userId,
        projectId: parsed.data.projectId,
      });
      return NextResponse.json({
        topQuestions: groups.top,
        otherQuestions: groups.other,
        generatedBy: 'local-context',
      });
    }

    const result = await askGapswise({
      userId,
      projectId: parsed.data.projectId,
      message: buildSuggestionRequestMessage(parsed.data.scopeLabel),
    });
    const suggestions = parseSuggestedQuestions(result.answer);
    if (!suggestions.top.length && !suggestions.other.length) {
      throw new AskAgentError('Gemini returned no structured contextual suggestions.', { stage: 'gemini' });
    }
    return NextResponse.json({
      topQuestions: suggestions.top,
      otherQuestions: suggestions.other,
      generatedBy: 'gapswise-agent',
    });
  } catch (error) {
    const stage = failureStage(error);
    const errorMessage = error instanceof Error ? error.message : 'unknown-error';
    try {
      const fallback = await generateLocalAskSuggestions({
        userId,
        projectId: parsed.data.projectId,
      });
      console.error(
        '[Gapwise Ask suggestions]',
        `stage=${stage}`,
        'fallback=local-context',
        `hasProjectScope=${Boolean(parsed.data.projectId)}`,
        `scopeLabelLength=${parsed.data.scopeLabel.length}`,
        `message=${errorMessage.replace(/\s+/g, ' ').slice(0, 240)}`,
      );
      return NextResponse.json({
        topQuestions: fallback.top,
        otherQuestions: fallback.other,
        generatedBy: 'local-fallback',
        warning: 'Using saved context for these suggestions while AI is unavailable.',
        stage,
      });
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'unknown-fallback-error';
      console.error(
        '[Gapwise Ask suggestions]',
        `stage=${stage}`,
        'fallback=failed',
        `hasProjectScope=${Boolean(parsed.data.projectId)}`,
        `scopeLabelLength=${parsed.data.scopeLabel.length}`,
        `message=${errorMessage.replace(/\s+/g, ' ').slice(0, 180)}`,
        `fallbackMessage=${fallbackMessage.replace(/\s+/g, ' ').slice(0, 180)}`,
      );
      const message = error instanceof AskAgentError
        ? error.message
        : 'Contextual suggestions are unavailable right now.';
      return NextResponse.json({ error: message, stage }, { status: 502 });
    }
  }
}
