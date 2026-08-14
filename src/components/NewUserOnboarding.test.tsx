import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewUserOnboarding } from '@/components/NewUserOnboarding';

describe('NewUserOnboarding', () => {
  it('offers a clean project start and an explicit demo load', () => {
    const html = renderToStaticMarkup(
      <NewUserOnboarding
        isLoadingDemo={false}
        onCreateProject={vi.fn()}
        onLoadDemo={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    expect(html).toContain('No projects yet');
    expect(html).toContain('Create project');
    expect(html).toContain('Load demo');
  });

  it('shows a loading state while demo data is being copied', () => {
    const html = renderToStaticMarkup(
      <NewUserOnboarding
        isLoadingDemo
        onCreateProject={vi.fn()}
        onLoadDemo={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    expect(html).toContain('Loading demo...');
  });
});
