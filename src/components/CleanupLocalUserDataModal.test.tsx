import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CleanupLocalUserDataModal } from '@/components/CleanupLocalUserDataModal';

describe('CleanupLocalUserDataModal', () => {
  it('shows the preview and requires the exact destructive confirmation', () => {
    const html = renderToStaticMarkup(
      <CleanupLocalUserDataModal
        preview={{ projects: 2, sources: 4, cloudObjects: 3, askChats: 1, askMessages: 5, askResearch: 2, snapshots: 8 }}
        isLoadingPreview={false}
        isRunning={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Delete my local Gapwise data');
    expect(html).toContain('DELETE MY LOCAL DATA');
    expect(html).toContain('>2</dd>');
    expect(html).toContain('>8</dd>');
    expect(html).toContain('Delete data');
  });

  it('shows a non-dismissible progress state while cleanup is running', () => {
    const html = renderToStaticMarkup(
      <CleanupLocalUserDataModal
        preview={null}
        isLoadingPreview={false}
        isRunning
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Deleting your local Gapwise data');
  });
});
