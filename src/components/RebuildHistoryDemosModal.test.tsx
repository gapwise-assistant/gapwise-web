import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RebuildHistoryDemosModal } from '@/components/RebuildHistoryDemosModal';

const preview = {
  projects: 2,
  snapshots: 8,
  askChats: 1,
  askMessages: 3,
  sources: 5,
  cloudObjects: 5,
};

const noop = () => undefined;

describe('RebuildHistoryDemosModal', () => {
  it('shows the destructive warning, counts, and exact confirmation requirement', () => {
    const html = renderToStaticMarkup(
      <RebuildHistoryDemosModal
        preview={preview}
        phase="Deleting old data…"
        isLoadingPreview={false}
        isRunning={false}
        onConfirm={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Rebuild Harbor + Riverside');
    expect(html).toContain('This permanently deletes');
    expect(html).toContain('DELETE_MY_LOCAL_DATA_AND_REBUILD_DEMOS');
    expect(html).toContain('>2</dd>');
    expect(html).toContain('>8</dd>');
    expect(html).toContain('Delete and rebuild');
  });

  it('renders the bounded rebuild progress sequence while running', () => {
    const html = renderToStaticMarkup(
      <RebuildHistoryDemosModal
        preview={null}
        phase="Creating Riverside…"
        isLoadingPreview={false}
        isRunning
        onConfirm={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Creating Riverside…');
    expect(html).toContain('Deleting old data…');
    expect(html).toContain('Creating Harbor…');
    expect(html).toContain('Preparing project history…');
    expect(html).toContain('Complete');
  });
});
