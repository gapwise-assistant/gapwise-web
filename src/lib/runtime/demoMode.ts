import { StorageError } from '@/lib/storage/types';
import { isLocalhostRequest as isLocalhostHostRequest } from '@/lib/runtime/localhost';

export function isDemoMode(): boolean {
  return process.env.GAPSWISE_DEMO_MODE?.trim().toLowerCase() === 'true';
}

/**
 * Detailed context traces contain the complete source text and model payloads.
 * They are intentionally available only from a local development request.
 */
export function isLocalhostRequest(request: Request): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return isLocalhostHostRequest(request);
}

export function assertExternalServicesAllowed(service: string): void {
  if (isDemoMode()) {
    throw new StorageError(
      `${service} is disabled while GAPSWISE_DEMO_MODE=true.`,
      'CONFIGURATION_ERROR'
    );
  }
}
