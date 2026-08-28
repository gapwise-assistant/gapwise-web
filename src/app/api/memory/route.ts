import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';
import { loadDurableMemories, loadUserMemoryProfile, replaceDurableMemories, saveUserMemoryProfile } from '@/lib/memory/serverStore';
import { StorageError } from '@/lib/storage/types';
import { DurableMemory } from '@/types/contextPack';
import { requireAuthenticatedUserId } from '@/lib/auth/server';

export const runtime = 'nodejs';

const memorySchema = z.object({
  id: z.string().min(1),
  userId: z.string().optional(),
  category: z.enum(['career', 'communication', 'learning', 'current_priorities', 'custom']),
  text: z.string().min(1),
  source: z.enum(['explicit', 'repeated_fact', 'user_confirmed', 'seed']),
  source_refs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  status: z.enum(['active', 'forgotten']).optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  last_confirmed_at: z.string().optional(),
  lastConfirmedAt: z.string().optional(),
  expires_at: z.string().optional(),
  forgotten_at: z.string().optional(),
  why_remembered: z.string().min(1),
  provenance: z.string().optional(),
});

const profileSchema = z.object({
  answer_density: z.enum(['concise', 'balanced', 'detailed']),
  question_frequency: z.enum(['low', 'moderate', 'high']),
  challenge_level: z.enum(['low', 'moderate', 'high']),
  evidence_preference: z.enum(['research_first', 'intuition_allowed', 'strict_data']),
  brainstorm_style: z.enum(['diverge_then_converge', 'direct_to_solution']),
  uncertainty_style: z.enum(['explicit', 'implicit']),
  durable_notes: z.array(z.string()),
});

const replaceRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  memories: z.array(memorySchema),
  profile: profileSchema.partial().optional(),
});

function jsonError(error: unknown) {
  if (error instanceof StorageError) {
    const status =
      error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'PERMISSION_DENIED'
          ? 403
          : error.code === 'VALIDATION_ERROR'
            ? 400
            : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid memory request.', issues: error.issues }, { status: 400 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Memory request failed.', code: 'UNAVAILABLE' },
    { status: 500 }
  );
}

async function readUserId(request: NextRequest): Promise<string> {
  const userId = request.nextUrl.searchParams.get('userId')?.trim();
  return requireAuthenticatedUserId(request, userId);
}

export async function GET(request: NextRequest) {
  try {
    const userId = await readUserId(request);
    const profile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    const memories = await loadDurableMemories(userId, profile);
    return NextResponse.json({ profile, memories });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = replaceRequestSchema.parse(await request.json());
    const userId = await requireAuthenticatedUserId(request, body.userId);
    const currentProfile = await loadUserMemoryProfile(userId, DEFAULT_USER_PROFILE);
    const profile = body.profile
      ? await saveUserMemoryProfile(userId, { ...currentProfile, ...body.profile })
      : currentProfile;
    const memories = await replaceDurableMemories(userId, body.memories as DurableMemory[]);
    return NextResponse.json({ profile, memories });
  } catch (error) {
    return jsonError(error);
  }
}
