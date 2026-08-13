import { StorageError } from '@/lib/storage/types';

export function isDemoMode(): boolean {
  return process.env.GAPSWISE_DEMO_MODE?.trim().toLowerCase() === 'true';
}

export function assertExternalServicesAllowed(service: string): void {
  if (isDemoMode()) {
    throw new StorageError(
      `${service} is disabled while GAPSWISE_DEMO_MODE=true.`,
      'CONFIGURATION_ERROR'
    );
  }
}
