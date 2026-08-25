/**
 * Ask diagnostics are intentionally local-development only because payloads
 * can contain the user's project context and the model prompt/response.
 */
export function logAskDebug(stage: string, details: unknown): void {
  if (process.env.NODE_ENV === 'production') return;
  const enabled = process.env.GAPSWISE_ASK_DEBUG === 'true'
    || (process.env.NODE_ENV === 'development' && process.env.GAPSWISE_ASK_DEBUG !== 'false');
  if (!enabled) return;
  console.log(`[Gapwise Ask][debug] ${stage}`, details);
}
