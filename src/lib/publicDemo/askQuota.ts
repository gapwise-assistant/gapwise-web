import { randomUUID } from 'node:crypto';
import type {
  PublicDemoAskOperation,
  PublicDemoUsage,
} from '@/lib/storage/types';

export const PUBLIC_DEMO_ASK_RESERVATION_LEASE_MS = 30_000;

export function publicDemoAskOperations(
  value: Partial<PublicDemoUsage> | undefined,
  fallbackAt: string,
): PublicDemoAskOperation[] {
  const operations: PublicDemoAskOperation[] = [];
  const seen = new Set<string>();
  const supplied = Array.isArray(value?.askOperations) ? value.askOperations : [];

  for (const operation of supplied) {
    if (
      !operation
      || typeof operation.operationId !== 'string'
      || typeof operation.reservationId !== 'string'
      || (operation.status !== 'pending' && operation.status !== 'completed')
    ) continue;
    if (seen.has(operation.operationId)) continue;
    seen.add(operation.operationId);
    operations.push(operation);
  }

  // Older usage records only retained completed operation IDs. Keep those
  // retries idempotent after the schema gains its pending/completed lifecycle.
  for (const operationId of value?.askOperationIds ?? []) {
    if (typeof operationId !== 'string' || seen.has(operationId)) continue;
    seen.add(operationId);
    operations.push({
      operationId,
      reservationId: `legacy:${operationId}`,
      status: 'completed',
      createdAt: fallbackAt,
      updatedAt: fallbackAt,
      completedAt: fallbackAt,
    });
  }

  return operations;
}

export function compactPublicDemoAskOperations(
  operations: PublicDemoAskOperation[],
  now: string,
): PublicDemoAskOperation[] {
  const nowMs = Date.parse(now);
  return operations
    .filter((operation) => {
      if (operation.status !== 'pending') return true;
      const expiresAt = operation.leaseExpiresAt ? Date.parse(operation.leaseExpiresAt) : NaN;
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    })
    .slice(-16);
}

export function createPublicDemoAskReservationId(): string {
  return randomUUID();
}

export function hasValidPublicDemoAskLease(
  operation: PublicDemoAskOperation,
  now: string,
): boolean {
  if (operation.status !== 'pending' || !operation.leaseExpiresAt) return false;
  const expiresAt = Date.parse(operation.leaseExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.parse(now);
}
