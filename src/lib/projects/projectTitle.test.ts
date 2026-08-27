import { describe, expect, it } from 'vitest';
import { projectTitlePresentation } from '@/lib/projects/projectTitle';

describe('projectTitlePresentation', () => {
  it('hides a legacy filename-safe timestamp without mutating the value', () => {
    const title = 'Riverside Meal Delivery Pilot · 2026-08-27T04-53-35-306Z';
    expect(projectTitlePresentation(title)).toEqual({
      title: 'Riverside Meal Delivery Pilot',
      legacyCreatedAt: '2026-08-27T04:53:35.306Z',
    });
  });

  it('leaves semantic titles unchanged', () => {
    expect(projectTitlePresentation('Harbor Pilot — History Demo')).toEqual({ title: 'Harbor Pilot — History Demo' });
  });
});
