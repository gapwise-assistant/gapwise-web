import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { groupProjectSummaries, summarizeProject } from '@/lib/projects/projectSummaries';

describe('project summaries', () => {
  it('counts open important questions and sources without exposing internals', () => {
    const project = createGoldenDemoProject();
    const summary = summarizeProject(project, new Date('2026-08-11T12:00:00.000Z'));

    expect(summary).toMatchObject({
      name: 'Gapwise Hackathon Submission',
      primaryGoal: 'Ship a winning Collaborative Partner project in 2-3 weeks',
      status: 'active',
      sourceCount: 4,
    });
    expect(summary.openImportantCount).toBeGreaterThan(0);
    expect(summary.updatedLabel).toBe('Updated yesterday');
  });

  it('groups active projects before archived projects', () => {
    const active = createProjectFromInput(
      { name: 'Active project', goal: 'Keep moving.' },
      '2026-08-11T12:00:00.000Z'
    );
    const archived = createProjectFromInput(
      { name: 'Archived project', goal: 'Done for now.' },
      '2026-08-12T12:00:00.000Z'
    );
    archived.status = 'archived';

    const grouped = groupProjectSummaries([archived, active], new Date('2026-08-12T13:00:00.000Z'));

    expect(grouped.active).toEqual([expect.objectContaining({ name: 'Active project' })]);
    expect(grouped.archived).toEqual([expect.objectContaining({ name: 'Archived project' })]);
  });

  it('shows a readable creation time while preserving the stored title and timestamps', () => {
    const project = createProjectFromInput(
      { name: 'Riverside Meal Delivery Pilot', goal: 'Launch the pilot.' },
      '2026-08-27T04:53:35.306Z',
    );
    const summary = summarizeProject(project);

    expect(project.title).toBe('Riverside Meal Delivery Pilot');
    expect(project.created_at).toBe('2026-08-27T04:53:35.306Z');
    expect(project.id).toContain('1787806415306');
    expect(summary.name).toBe('Riverside Meal Delivery Pilot');
    expect(summary.createdLabel).toMatch(/Aug \d+ · \d+:\d+ (AM|PM)/);
    expect(summary.createdLabel).not.toContain('T');
    expect(summary.createdTooltip).toMatch(/Aug \d+, 2026 · \d+:\d+ (AM|PM)/);
  });

  it('strips a legacy title suffix only for presentation', () => {
    const project = createProjectFromInput(
      { name: 'Legacy project · 2026-08-27T04-53-35-306Z', goal: 'Keep moving.' },
      '2026-08-27T05:00:00.000Z',
    );
    const summary = summarizeProject(project);

    expect(project.title).toContain('2026-08-27T04-53-35-306Z');
    expect(summary.name).toBe('Legacy project');
    expect(summary.createdLabel).toMatch(/Aug \d+ · \d+:\d+ (AM|PM)/);
  });
});
