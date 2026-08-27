import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Project } from '@/types/clarity';
import { ContextProcessingDetails, sourceActivityRenderKey } from '@/components/DecisionMapActivity';

describe('DecisionMapActivity source keys', () => {
  it('keeps legacy duplicate source records renderable', () => {
    const source = {
      id: 'legacy-source',
      filename: 'same-note.txt',
      extracted_at: '2026-08-26T12:00:00.000Z',
    };

    const firstKey = sourceActivityRenderKey(source, 0);
    const secondKey = sourceActivityRenderKey(source, 1);

    expect(firstKey).not.toBe(secondKey);
    expect(new Set([firstKey, secondKey]).size).toBe(2);

    const html = renderToStaticMarkup(
      <ContextProcessingDetails
        project={{
          sources: [
            { ...source, processing_status: 'completed', derived_node_ids: [] },
            { ...source, processing_status: 'completed', derived_node_ids: [] },
          ],
        } as unknown as Project}
      />,
    );
    expect((html.match(/same-note\.txt/g) ?? []).length).toBe(2);
  });
});
