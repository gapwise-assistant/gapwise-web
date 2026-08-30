import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '@/components/Header';
import { createProjectFromInput } from '@/lib/projects/createProject';

function renderHeader(accessTier: 'owner' | 'public_demo', projects = [createProjectFromInput({ name: 'Quick Demo', goal: 'Explore Gapwise.' }, '2026-08-30T12:00:00.000Z')]) {
  const project = projects[0];
  return renderToStaticMarkup(
    <Header
      projects={projects}
      scope={{ type: 'project', projectId: project.id }}
      activeTab="today"
      setActiveTab={vi.fn()}
      onResetDemo={vi.fn()}
      onSelectProject={vi.fn()}
      onOpenNewProject={vi.fn()}
      onOpenSettings={vi.fn()}
      isSettingsOpen={false}
      accessTier={accessTier}
    />,
  );
}

describe('Header workspace selection', () => {
  it('renders a fixed assigned workspace label for public-demo users', () => {
    const html = renderHeader('public_demo');

    expect(html).not.toContain('<select');
    expect(html).toContain('aria-label="Current workspace"');
    expect(html).toContain('Quick Demo');
    expect(html).not.toContain('+ New workspace');
  });

  it('keeps the editable workspace selector for full-access users', () => {
    const projects = [
      createProjectFromInput({ name: 'First workspace', goal: 'First goal.' }, '2026-08-30T12:00:00.000Z'),
      createProjectFromInput({ name: 'Second workspace', goal: 'Second goal.' }, '2026-08-30T12:01:00.000Z'),
    ];
    const html = renderHeader('owner', projects);

    expect(html).toContain('<select');
    expect(html).toContain('First workspace');
    expect(html).toContain('Second workspace');
    expect(html).toContain('+ New workspace');
  });
});
