import { describe, expect, it } from 'vitest';
import {
  compactProcessingLogForFirestore,
  PROCESSING_LOG_MAX_BYTES,
  serializedProcessingLogSize,
} from '@/lib/context/processingLog';
import type { ContextProcessingLog } from '@/types/clarity';

function logWithLargeDiagnostics(): ContextProcessingLog {
  return {
    version: 1,
    status: 'completed',
    started_at: '2026-08-27T12:00:00.000Z',
    completed_at: '2026-08-27T12:00:01.000Z',
    duration_ms: 1000,
    input: {
      source_id: 'source-large',
      filename: 'large.txt',
      type: 'text',
      content: 'source content '.repeat(50_000),
      project_snapshot: JSON.stringify({ project_id: 'project-1', important_nodes: [] }),
    },
    stages: [{
      name: 'Context Agent model analysis',
      status: 'completed',
      started_at: '2026-08-27T12:00:00.000Z',
      duration_ms: 900,
      input: { prompt: 'prompt '.repeat(50_000) },
      output: { raw_response: 'response '.repeat(50_000) },
    }],
  };
}

describe('processing log Firestore compaction', () => {
  it('bounds oversized diagnostic data and records truncation metadata', () => {
    const original = logWithLargeDiagnostics();
    const originalSize = serializedProcessingLogSize(original);
    const compacted = compactProcessingLogForFirestore(original);

    expect(originalSize).toBeGreaterThan(PROCESSING_LOG_MAX_BYTES);
    expect(compacted.truncated).toBe(true);
    expect(compacted.original_size_bytes).toBe(originalSize);
    expect(serializedProcessingLogSize(compacted)).toBeLessThanOrEqual(PROCESSING_LOG_MAX_BYTES);
    expect(compacted.stages[0]).toMatchObject({
      name: 'Context Agent model analysis',
      status: 'completed',
    });
    expect(JSON.stringify(compacted)).toContain('[truncated]');
  });

  it('does not change a small log', () => {
    const log = logWithLargeDiagnostics();
    log.input.content = 'short source';
    log.stages[0]!.input = { prompt: 'short prompt' };
    log.stages[0]!.output = { raw_response: 'short response' };

    expect(compactProcessingLogForFirestore(log)).toEqual(log);
  });

  it('removes source data from a legacy project snapshot before persisting it', () => {
    const log = logWithLargeDiagnostics();
    log.input.content = 'short source';
    log.input.project_snapshot = JSON.stringify({
      project_id: 'project-1',
      important_nodes: [],
      sources: [{ content: 'full source', processing_log: { previous: true } }],
    });

    const compacted = compactProcessingLogForFirestore(log);

    expect(compacted.input.project_snapshot).toBe(JSON.stringify({
      project_id: 'project-1',
      important_nodes: [],
    }));
    expect(compacted.input.project_snapshot).not.toContain('processing_log');
    expect(compacted.input.project_snapshot).not.toContain('full source');
  });
});
