import { describe, expect, it } from 'vitest';
import { createGoldenDemoProject } from '@/lib/demo/seed';
import { buildCurrentPicture } from '@/lib/projects/projectOverview';

describe('project current picture', () => {
  it('summarizes existing graph relationships and unresolved state without AI', () => {
    const picture = buildCurrentPicture(createGoldenDemoProject());

    expect(picture).toHaveLength(3);
    expect(picture.map((item) => item.text).join(' ')).toContain('blocking');
    expect(picture.map((item) => item.text).join(' ')).not.toMatch(/src_|node_/);
  });

  it('falls back to the project goal when no graph state exists', () => {
    const project = createGoldenDemoProject();
    project.nodes = [];
    project.edges = [];

    expect(buildCurrentPicture(project)).toEqual([
      expect.objectContaining({ text: expect.stringContaining(project.goal) }),
    ]);
  });
});
