import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import {
  localQuestionSuggestions,
  parseQuestionSuggestions,
  questionSuggestionRequestMessage,
} from '@/lib/today/questionPlans';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  scopeLabel: z.string().trim().min(1).max(120).default('Everything'),
  questions: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    question: z.string().trim().min(1).max(300),
    reason: z.string().trim().max(500),
    provenance: z.string().trim().max(500),
  })).min(1).max(3),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid question planning request.', issues: parsed.error.issues }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, parsed.data.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }

  const questions = parsed.data.questions;
  if (isDemoMode()) {
    return NextResponse.json({
      suggestions: localQuestionSuggestions(questions),
      generatedBy: 'local-context',
    });
  }

  try {
    const result = await askGapswise({
      userId,
      projectId: parsed.data.projectId,
      message: questionSuggestionRequestMessage(parsed.data.scopeLabel, questions),
    });
    return NextResponse.json({
      suggestions: parseQuestionSuggestions(result.answer, questions),
      generatedBy: 'gapswise-agent',
    });
  } catch (error) {
    const stage = error instanceof AskAgentError ? error.stage : 'gemini';
    console.error('[Gapswise Today question plans]', {
      stage,
      error: error instanceof Error ? error.message : 'unknown-error',
      questionCount: questions.length,
      hasProjectScope: Boolean(parsed.data.projectId),
    });
    return NextResponse.json({
      error: error instanceof AskAgentError ? error.message : 'Today question plans are unavailable right now.',
      stage,
    }, { status: 502 });
  }
}
