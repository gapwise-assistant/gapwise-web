import { StorageError } from '@/lib/storage/types';

export function isDemoMode(): boolean {
  return process.env.GAPSWISE_DEMO_MODE?.trim().toLowerCase() === 'true';
}

/**
 * Detailed context traces contain the complete source text and model payloads.
 * They are intentionally available only from a local development request.
 */
export function isLocalhostRequest(request: Request): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const hostname = new URL(request.url).hostname;
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '0.0.0.0'
      || hostname === '::1';
  } catch {
    return false;
  }
}

export function assertExternalServicesAllowed(service: string): void {
  if (isDemoMode()) {
    throw new StorageError(
      `${service} is disabled while GAPSWISE_DEMO_MODE=true.`,
      'CONFIGURATION_ERROR'
    );
  }
}
