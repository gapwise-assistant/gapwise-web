import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askGapswise, AskAgentError } from '@/lib/ask/adkClient';
import { isDemoMode } from '@/lib/runtime/demoMode';
import { requireAuthenticatedPrincipal, requireAuthenticatedUserId } from '@/lib/auth/server';
import { isPublicDemoPrincipal, loadPublicDemoProject } from '@/lib/auth/publicDemo';
import { requireFirestoreStorage } from '@/lib/storage';
import { StorageError } from '@/lib/storage/types';
import {
  localQuestionSuggestions,
  localQuestionPresentations,
  normalizeQuestionPlanRequest,
  parseQuestionPresentations,
  parseQuestionSuggestions,
  QUESTION_PLAN_CONTEXT_MAX_LENGTH,
  QUESTION_PLAN_ID_MAX_LENGTH,
  QUESTION_PLAN_MAX_CONTEXT_ENTRIES,
  QUESTION_PLAN_MAX_QUESTIONS,
  QUESTION_PLAN_PROVENANCE_MAX_LENGTH,
  QUESTION_PLAN_QUESTION_MAX_LENGTH,
  QUESTION_PLAN_REASON_MAX_LENGTH,
  QUESTION_PLAN_SCOPE_LABEL_MAX_LENGTH,
  questionSuggestionRequestMessage,
} from '@/lib/today/questionPlans';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  scopeLabel: z.string().default('Everything'),
  questions: z.array(z.object({
    // The raw request may contain long text that the shared normalizer will
    // bound before the final contract is checked. IDs are different: they
    // must remain intact because they are canonical lookup keys.
    id: z.string().min(1).max(QUESTION_PLAN_ID_MAX_LENGTH),
    question: z.string(),
    reason: z.string(),
    provenance: z.string(),
    presentationContext: z.array(z.string()).optional(),
  })).min(1),
});

const normalizedRequestSchema = z.object({
  userId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  scopeLabel: z.string().min(1).max(QUESTION_PLAN_SCOPE_LABEL_MAX_LENGTH),
  questions: z.array(z.object({
    id: z.string().min(1).max(QUESTION_PLAN_ID_MAX_LENGTH),
    question: z.string().min(1).max(QUESTION_PLAN_QUESTION_MAX_LENGTH),
    reason: z.string().max(QUESTION_PLAN_REASON_MAX_LENGTH),
    provenance: z.string().max(QUESTION_PLAN_PROVENANCE_MAX_LENGTH),
    presentationContext: z.array(z.string().min(1).max(QUESTION_PLAN_CONTEXT_MAX_LENGTH)).max(QUESTION_PLAN_MAX_CONTEXT_ENTRIES).optional(),
  })).min(1).max(QUESTION_PLAN_MAX_QUESTIONS),
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

  const normalized = normalizedRequestSchema.safeParse(normalizeQuestionPlanRequest(parsed.data));
  if (!normalized.success) {
    return NextResponse.json({ error: 'Invalid question planning request.', issues: normalized.error.issues }, { status: 400 });
  }

  let principal: Awaited<ReturnType<typeof requireAuthenticatedPrincipal>>;
  try {
    principal = await requireAuthenticatedPrincipal(request, normalized.data.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }

  const questions = normalized.data.questions;
  if (isPublicDemoPrincipal(principal)) {
    try {
      const storage = requireFirestoreStorage();
      await loadPublicDemoProject(principal, storage, normalized.data.projectId);
      return NextResponse.json({
        suggestions: localQuestionSuggestions(questions),
        presentations: localQuestionPresentations(questions),
        generatedBy: 'public-demo-local',
      });
    } catch (error) {
      const status = error instanceof StorageError
        ? error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'PERMISSION_DENIED'
            ? 403
            : 503
        : 503;
      return NextResponse.json({ error: 'Today question suggestions are unavailable.' }, { status });
    }
  }

  let userId: string;
  try {
    userId = await requireAuthenticatedUserId(request, normalized.data.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign in is required.' }, { status: 401 });
  }

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
      projectId: normalized.data.projectId,
      message: questionSuggestionRequestMessage(normalized.data.scopeLabel, questions),
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
      `hasProjectScope=${Boolean(normalized.data.projectId)}`,
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
