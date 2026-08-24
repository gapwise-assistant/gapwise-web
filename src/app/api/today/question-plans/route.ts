import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import {
  localQuestionSuggestions,
  localQuestionPresentations,
  parseQuestionPresentations,
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
    presentationContext: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
  })).min(1).max(4),
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
      presentations: localQuestionPresentations(questions),
      generatedBy: 'local-context',
    });
  }

  try {
    const result = await askGapswise({
      userId,
      projectId: parsed.data.projectId,
      message: questionSuggestionRequestMessage(parsed.data.scopeLabel, questions),
      structuredResponse: false,
    });
    return NextResponse.json({
      suggestions: parseQuestionSuggestions(result.answer, questions),
      presentations: parseQuestionPresentations(result.answer, questions),
      generatedBy: 'gapswise-agent',
    });
  } catch (error) {
    const stage = error instanceof AskAgentError ? error.stage : 'gemini';
    const errorMessage = error instanceof Error ? error.message : 'unknown-error';
    // Keep this flat so Cloud Run/Next logs retain the failure stage and message.
    console.error(
      '[Gapwise Today question suggestions]',
      `stage=${stage}`,
      `questionCount=${questions.length}`,
      `hasProjectScope=${Boolean(parsed.data.projectId)}`,
      `message=${errorMessage.replace(/\s+/g, ' ').slice(0, 240)}`,
    );

    // Today already has a conservative context-only answer suggestion path.
    // Keep the page usable when the optional AI enrichment service is offline.
    return NextResponse.json({
      suggestions: localQuestionSuggestions(questions),
      presentations: localQuestionPresentations(questions),
      generatedBy: 'local-fallback',
      warning: 'AI answer suggestions are unavailable right now. Showing deterministic question copy instead.',
      stage,
    });
  }
}
