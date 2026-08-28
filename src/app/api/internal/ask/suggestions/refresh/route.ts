import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/lib/auth/server';
import { getStorageProvider } from '@/lib/storage';
import { refreshAskSuggestionsForProject } from '@/lib/ask/suggestionsRefresh';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, parsed.userId);
    const project = await getStorageProvider().getProject(userId, parsed.projectId);
    if (!project || project.id !== parsed.projectId) {
      return NextResponse.json({ error: 'The requested workspace was not found.' }, { status: 404 });
    }
    const suggestions = await refreshAskSuggestionsForProject({ userId, project });
    return NextResponse.json({
      topQuestions: suggestions.top,
      otherQuestions: suggestions.other,
      projectId: project.id,
      semanticVersion: project.semantic_version,
      generatedBy: suggestions.generatedBy,
      status: suggestions.status ?? (suggestions.warning ? 'failed' : 'ready'),
      cached: suggestions.cached,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid suggestions refresh request.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Suggestions refresh failed.' }, { status: 503 });
  }
}
