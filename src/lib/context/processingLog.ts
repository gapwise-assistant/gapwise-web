import type { ContextProcessingLog } from '@/types/clarity';

/** Keep diagnostic logs well below Firestore's 1 MiB document limit. */
export const PROCESSING_LOG_MAX_BYTES = 200_000;

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)]),
    ) as T;
  }
  return value;
}

export function serializedProcessingLogSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}

function removeEmbeddedSourceData(snapshot: string): string {
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return snapshot;
    const { sources: _sources, ...semanticState } = parsed as Record<string, unknown>;
    return JSON.stringify(semanticState);
  } catch {
    return snapshot;
  }
}

function compactDiagnosticValue(
  value: unknown,
  options: { maxStringLength: number; maxArrayLength: number; maxObjectKeys: number },
): unknown {
  if (typeof value === 'string') {
    if (value.length <= options.maxStringLength) return value;
    const suffix = '… [truncated]';
    return `${value.slice(0, Math.max(0, options.maxStringLength - suffix.length))}${suffix}`;
  }
  if (Array.isArray(value)) {
    const retained = value
      .slice(0, options.maxArrayLength)
      .map((item) => compactDiagnosticValue(item, options));
    if (value.length > options.maxArrayLength) {
      retained.push(`[${value.length - options.maxArrayLength} items truncated]`);
    }
    return retained;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const compacted = Object.fromEntries(
      entries
        .slice(0, options.maxObjectKeys)
        .map(([key, item]) => [key, compactDiagnosticValue(item, options)]),
    ) as Record<string, unknown>;
    if (entries.length > options.maxObjectKeys) {
      compacted._truncated_keys = entries.length - options.maxObjectKeys;
    }
    return compacted;
  }
  return value;
}

/**
 * Make a processing log safe to write as a Firestore field. The first pass
 * preserves normal diagnostics; progressively smaller diagnostic values are
 * used only when the serialized log exceeds the bounded budget.
 */
export function compactProcessingLogForFirestore(
  log: ContextProcessingLog,
): ContextProcessingLog {
  const clean = stripUndefined(log);
  clean.input.project_snapshot = removeEmbeddedSourceData(clean.input.project_snapshot);
  const originalSize = serializedProcessingLogSize(clean);
  if (originalSize <= PROCESSING_LOG_MAX_BYTES) return clean;

  const options = [
    { maxStringLength: 8_192, maxArrayLength: 128, maxObjectKeys: 128 },
    { maxStringLength: 2_048, maxArrayLength: 64, maxObjectKeys: 96 },
    { maxStringLength: 512, maxArrayLength: 32, maxObjectKeys: 64 },
    { maxStringLength: 128, maxArrayLength: 16, maxObjectKeys: 48 },
  ];

  for (const option of options) {
    const compacted = stripUndefined(
      compactDiagnosticValue(clean, option),
    ) as ContextProcessingLog;
    const result = {
      ...compacted,
      truncated: true,
      original_size_bytes: originalSize,
    } as ContextProcessingLog;
    if (serializedProcessingLogSize(result) <= PROCESSING_LOG_MAX_BYTES) return result;
  }

  // The final shape retains the operational trace fields even if a caller
  // supplied an unusually large arbitrary diagnostic object.
  const minimal = {
    version: log.version,
    status: log.status,
    started_at: log.started_at,
    completed_at: log.completed_at,
    duration_ms: log.duration_ms,
    input: {
      source_id: log.input.source_id.slice(0, 512),
      filename: log.input.filename.slice(0, 512),
      type: log.input.type,
      hash: log.input.hash?.slice(0, 512),
      project_snapshot: log.input.project_snapshot.slice(0, 128),
      content: log.input.content.slice(0, 128),
    },
    stages: log.stages.slice(0, 64).map((stage) => ({
      name: stage.name.slice(0, 256),
      status: stage.status,
      started_at: stage.started_at,
      duration_ms: stage.duration_ms,
      ...(stage.error ? { error: stage.error.slice(0, 512) } : {}),
    })),
    ...(log.error ? { error: log.error.slice(0, 512) } : {}),
    truncated: true,
    original_size_bytes: originalSize,
  } as ContextProcessingLog;
  return minimal;
}
