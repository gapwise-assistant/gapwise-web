import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';

describe('createProjectFromInput', () => {
  it('creates a minimal project with a deterministic initial GOAL node', () => {
    const project = createProjectFromInput(
      {
        name: 'Find a new job',
        goal: 'Find a higher-paying backend/AI role by November.',
        description: 'Focus on backend and applied AI roles.',
        deadline: '2026-11-01',
      },
      '2026-08-11T12:00:00.000Z'
    );

    expect(project).toMatchObject({
      id: 'project_find-a-new-job_1786449600000',
      title: 'Find a new job',
      goal: 'Find a higher-paying backend/AI role by November.',
      deadline: '2026-11-01',
      one_sentence_context: 'Focus on backend and applied AI roles.',
      sources: [],
      edges: [],
      history: [],
      active_question: null,
    });
    expect(project.nodes).toEqual([
      expect.objectContaining({
        id: 'goal_project_find-a-new-job_1786449600000',
        type: 'GOAL',
        text: 'Find a higher-paying backend/AI role by November.',
        status: 'OPEN',
        created_by: 'user',
        source_refs: [],
      }),
    ]);
    expect(project.historyEvents).toEqual([{
      id: 'project_find-a-new-job_1786449600000:history:project_started:2026-08-11T12:00:00.000Z',
      projectId: 'project_find-a-new-job_1786449600000',
      createdAt: '2026-08-11T12:00:00.000Z',
      type: 'project_started',
      title: 'Project started',
      summary: 'Created this project with its initial goal.',
    }]);
  });

  it('keeps demo-style titles semantic while using createdAt for identity', () => {
    const project = createProjectFromInput(
      { name: 'Harbor Pilot — History Demo', goal: 'Launch the pilot.' },
      '2026-08-27T04:53:35.306Z',
    );

    expect(project.title).toBe('Harbor Pilot — History Demo');
    expect(project.created_at).toBe('2026-08-27T04:53:35.306Z');
    expect(project.id).toBe('project_harbor-pilot-history-demo_1787806415306');
    expect(project.title).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
