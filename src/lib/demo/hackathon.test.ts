import { describe, expect, it } from 'vitest';
import { createHackathonDemoProject, createHackathonDemoMemories } from '@/lib/demo/hackathon';

describe('HarborHelp hackathon demo', () => {
  it('is a concrete non-meta project with enough context to explore', () => {
    const project = createHackathonDemoProject();

    expect(project.title).toBe('HarborHelp — Community Food Rescue');
    expect(project.title).not.toMatch(/gapwise/i);
    expect(project.sources.length).toBeGreaterThanOrEqual(5);
    expect(project.nodes.filter((node) => node.type === 'UNKNOWN' && node.status === 'OPEN')).toHaveLength(3);
    expect(project.nodes.filter((node) => node.type === 'DECISION')).toHaveLength(2);
    expect(project.nodes.some((node) => /shelter|food|volunteer/i.test(node.text))).toBe(true);
    expect(project.nodes.some((node) => /Gapswise/i.test(node.text))).toBe(false);
    expect(createHackathonDemoMemories()).toHaveLength(2);
  });

  it('recreates the same seed for repeatable demos', () => {
    expect(JSON.stringify(createHackathonDemoProject())).toBe(JSON.stringify(createHackathonDemoProject()));
  });
});
