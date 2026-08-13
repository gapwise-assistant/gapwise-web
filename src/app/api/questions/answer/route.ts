import { NextResponse } from 'next/server';
import { z } from 'zod';
import { answerQuestion } from '@/lib/questions/answerQuestion';
import { StorageError } from '@/lib/storage/types';

export const runtime = 'nodejs';

const requestSchema = z.object({
  userId: z.string().trim().min(1),
  nodeId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(5000),
  projectId: z.string().trim().min(1).optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid answer request.', issues: error.issues }, { status: 400 });
  }
  if (error instanceof StorageError) {
    const status = error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'VALIDATION_ERROR' ? 400 : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'The answer could not be saved.' },
    { status: 500 }
  );
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const result = await answerQuestion(body);
    return NextResponse.json({
      ...result,
      message: 'Understanding updated. This question is now resolved.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
