import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { groupProjectSummaries, summarizeProject } from '@/lib/projects/projectSummaries';

describe('project summaries', () => {
  it('counts open important questions and sources without exposing internals', () => {
    const project = createGoldenDemoProject();
    const summary = summarizeProject(project, new Date('2026-08-11T12:00:00.000Z'));

    expect(summary).toMatchObject({
      name: 'Gapswise Hackathon Submission',
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
});
