const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

export function isLocalhostHostname(hostname: string): boolean {
  return LOCALHOST_HOSTNAMES.has(normalizeHostname(hostname));
}

export function isLocalhostRequest(request: Request): boolean {
  try {
    return isLocalhostHostname(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function isLocalhostBrowser(): boolean {
  return typeof window !== 'undefined' && isLocalhostHostname(window.location.hostname);
}
