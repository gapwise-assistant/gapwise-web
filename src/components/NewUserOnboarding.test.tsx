import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewUserOnboarding } from '@/components/NewUserOnboarding';

describe('NewUserOnboarding', () => {
  it('offers only workspace creation and the prepared demo', () => {
    const html = renderToStaticMarkup(
      <NewUserOnboarding
        isLoadingDemo={false}
        onCreateProject={vi.fn()}
        onLoadDemo={vi.fn()}
      />
    );

    expect(html).toContain('Start your first workspace');
    expect(html).toContain('Add your project and let Gapwise identify what needs attention, or explore a prepared example.');
    expect(html).toContain('+ Create workspace');
    expect(html).toContain('▶ Load demo');
    expect((html.match(/<button/g) ?? []).length).toBe(2);
    expect(html).not.toContain('Career demo');
    expect(html).not.toContain('Harbor');
  });

  it('keeps loading feedback inside the demo button', () => {
    const html = renderToStaticMarkup(
      <NewUserOnboarding
        isLoadingDemo
        onCreateProject={vi.fn()}
        onLoadDemo={vi.fn()}
      />
    );

    expect(html).toContain('Loading demo…');
    expect(html).not.toContain('▶ Load demo');
    expect((html.match(/<button/g) ?? []).length).toBe(2);
  });

  it('shows a short inline load error', () => {
    const html = renderToStaticMarkup(
      <NewUserOnboarding
        isLoadingDemo={false}
        error="The prepared demo could not be loaded."
        onCreateProject={vi.fn()}
        onLoadDemo={vi.fn()}
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('The prepared demo could not be loaded.');
  });
});
