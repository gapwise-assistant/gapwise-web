import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { generateLocalAskSuggestions } from '@/lib/ask/localDemoAdapter';
import { buildSuggestionRequestMessage, parseSuggestedQuestions } from '@/lib/ask/suggestions';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

export const runtime = 'nodejs';

const suggestionsRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  scopeLabel: z.string().trim().min(1).max(120).default('Everything'),
});

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
    if (isDemoMode()) {
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
      throw new AskAgentError('Gapswise returned no contextual suggested questions.');
    }
    return NextResponse.json({
      topQuestions: suggestions.top,
      otherQuestions: suggestions.other,
      generatedBy: 'gapswise-agent',
    });
  } catch (error) {
    const message = error instanceof AskAgentError
      ? error.message
      : 'Contextual suggestions are unavailable right now.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
