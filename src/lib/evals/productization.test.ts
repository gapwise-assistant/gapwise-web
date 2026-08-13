import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearTracesForTests, listTraces, recordTrace } from '@/lib/observability/trace';
import { runEvaluationSuite } from '@/lib/evals/scenarios';

describe('productization checks', () => {
  it('PWA manifest is present and installable enough for demo', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(process.cwd(), 'public', 'manifest.webmanifest'), 'utf8')
    ) as { name: string; start_url: string; display: string; icons: unknown[] };

    expect(manifest.name).toBe('Gapswise');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('evaluation suite exposes at least 15 scenarios', () => {
    expect(runEvaluationSuite()).toHaveLength(15);
  });

  it('trace store records safe metadata without raw content requirement', () => {
    clearTracesForTests();
    recordTrace({
      userId: 'demo-user',
      route: '/api/agents/turn',
      label: 'Agent turn',
      started_at: '2026-08-10T10:00:00Z',
      duration_ms: 12,
      agentNames: ['Context Agent'],
      contextIds: ['node_goal'],
      scores: [{ id: 'rec_1', score: 0.8 }],
      toolCalls: ['buildContextPack'],
    });

    expect(listTraces('demo-user')).toHaveLength(1);
    expect(listTraces('demo-user')[0]).not.toHaveProperty('rawText');
  });
});
