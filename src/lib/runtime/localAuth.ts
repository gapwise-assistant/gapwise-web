import { isLocalhostRequest as isLocalhostHostRequest } from '@/lib/runtime/localhost';

/**
 * Local development uses the stable demo identity so localhost never needs a
 * Firebase redirect. This is deliberately limited to the Next development
 * server; production localhost requests still require real authentication.
 */
export function isLocalhostRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  return isLocalhostHostRequest(request);
}
