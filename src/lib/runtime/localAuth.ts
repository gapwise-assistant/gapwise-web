/**
 * Local development uses the stable demo identity so localhost never needs a
 * Firebase redirect. This is deliberately limited to the Next development
 * server; production localhost requests still require real authentication.
 */
export function isLocalhostRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== 'development') return false;

  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}
