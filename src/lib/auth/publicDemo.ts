import type { AuthenticatedPrincipal } from '@/lib/auth/server';
import { StorageError, type PublicDemoUsage, type StorageProvider } from '@/lib/storage/types';
import type { Project } from '@/types/clarity';

export const PUBLIC_DEMO_MAX_ASK_MESSAGES = 3;

export function publicDemoDailyDemoLimit(): number {
  const raw = process.env.GAPSWISE_PUBLIC_DAILY_DEMO_LIMIT?.trim();
  const limit = raw ? Number(raw) : 0;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new StorageError('The public demo is temporarily unavailable.', 'CONFIGURATION_ERROR');
  }
  return limit;
}

export function isPublicDemoPrincipal(principal: AuthenticatedPrincipal): boolean {
  return principal.accessTier === 'public_demo';
}

export function publicDemoDailyAskLimit(): number {
  const raw = process.env.GAPSWISE_PUBLIC_DAILY_ASK_LIMIT?.trim();
  const limit = raw ? Number(raw) : 0;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new StorageError('The public demo is unavailable.', 'CONFIGURATION_ERROR');
  }
  return limit;
}

export function publicDemoMessagesRemaining(usage: PublicDemoUsage | null): number {
  return Math.max(0, PUBLIC_DEMO_MAX_ASK_MESSAGES - (usage?.askMessagesUsed ?? 0));
}

export function publicDemoUsageExpired(
  usage: PublicDemoUsage | null | undefined,
  now = Date.now(),
): boolean {
  if (!usage?.expiresAt) return false;
  const expiresAt = Date.parse(usage.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function assertPublicDemoProject(
  principal: AuthenticatedPrincipal,
  projectId: string | undefined,
  usage: PublicDemoUsage | null,
): void {
  if (!isPublicDemoPrincipal(principal)) return;
  if (!projectId || !usage?.quickDemoProjectId) {
    throw new StorageError('The public demo workspace was not found.', 'NOT_FOUND');
  }
  if (publicDemoUsageExpired(usage)) {
    throw new StorageError('The public demo workspace is no longer available.', 'UNAVAILABLE');
  }
  if (usage.quickDemoProjectId !== projectId) {
    throw new StorageError('This workspace is not available in the public demo.', 'PERMISSION_DENIED');
  }
  if (usage.quickDemoStatus === 'creating') {
    throw new StorageError('The public demo workspace is still being prepared.', 'UNAVAILABLE');
  }
  if (usage.quickDemoStatus === 'failed') {
    throw new StorageError('The public demo workspace is temporarily unavailable.', 'UNAVAILABLE');
  }
}

export async function loadPublicDemoProject(
  principal: AuthenticatedPrincipal,
  storage: StorageProvider,
  projectId: string | undefined,
): Promise<Project> {
  const usage = await storage.getPublicDemoUsage(principal.uid);
  assertPublicDemoProject(principal, projectId, usage);
  if (!projectId) {
    throw new StorageError('The public demo workspace was not found.', 'NOT_FOUND');
  }
  const project = await storage.getProject(principal.uid, projectId);
  if (!project) {
    throw new StorageError('The public demo workspace was not found.', 'NOT_FOUND');
  }
  return project;
}
