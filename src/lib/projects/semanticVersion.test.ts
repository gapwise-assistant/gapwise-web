import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { semanticProjectVersion } from '@/lib/projects/semanticVersion';

describe('semantic project version', () => {
  it('ignores source content explicitly classified as no-change', () => {
    const project = createGoldenDemoProject();
    const initial = semanticProjectVersion(project);

    project.sources.push({
      id: 'source-no-change',
      filename: 'repeated-note.txt',
      type: 'note',
      content: 'This repeats information already represented in the graph.',
      extracted_at: '2026-08-28T12:00:00.000Z',
      derived_node_ids: [],
      processing_status: 'completed',
      semantic_contribution: false,
    });

    expect(semanticProjectVersion(project)).toBe(initial);
  });

  it('versions genuinely unrepresented source context', () => {
    const project = createGoldenDemoProject();
    const initial = semanticProjectVersion(project);

    project.sources.push({
      id: 'source-new-context',
      filename: 'follow-up-note.txt',
      type: 'note',
      content: 'A new requirement was confirmed.',
      extracted_at: '2026-08-28T12:00:00.000Z',
      derived_node_ids: [],
      processing_status: 'completed',
    });

    expect(semanticProjectVersion(project)).not.toBe(initial);
  });
});
