import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { DEFAULT_USER_PROFILE } from '@/lib/demo/seed';

describe('SettingsDrawer', () => {
  it('uses one narrow, full-width settings surface without nested page grids', () => {
    const html = renderToStaticMarkup(
      <SettingsDrawer
        userId="settings-user"
        accountLabel="Martel"
        scope={{ type: 'project', projectId: 'project_settings' }}
        project={createProjectFromInput({ name: 'Settings project', goal: 'Test settings.' }, '2026-08-25T12:00:00.000Z')}
        generalContext={createProjectFromInput({ name: 'General context', goal: 'Remember user details.' }, '2026-08-25T12:00:00.000Z')}
        profile={DEFAULT_USER_PROFILE}
        memories={[]}
        onUpdateProject={vi.fn()}
        onUpdateGeneralContext={vi.fn()}
        onUpdateProfile={vi.fn()}
        onUpdateMemories={vi.fn()}
        onSignOut={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Manage your account and what Gapwise remembers.');
    expect(html).toContain('Connections');
    expect(html).toContain('What Gapwise remembers');
    expect(html).toContain('Durable memory');
    expect(html).toContain('Preferences');
    expect(html).toContain('Account');
    expect(html).not.toContain('>SETTINGS<');
    expect(html).not.toContain('lg:grid-cols-');
    expect(html).toContain('No active memories');
  });
});
