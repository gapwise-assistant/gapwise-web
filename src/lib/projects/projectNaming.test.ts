import { describe, expect, it } from 'vitest';
import { createProjectFromInput } from '@/lib/projects/createProject';
import { nextAvailableProjectTitle } from '@/lib/projects/projectNaming';

function project(title: string, status: 'active' | 'archived' = 'active') {
  const value = createProjectFromInput({ name: title, goal: 'Test workspace naming.' });
  return { ...value, status };
}

describe('nextAvailableProjectTitle', () => {
  it.each([
    { name: 'no existing match', projects: [], expected: 'Riverside Pilot' },
    { name: 'one active match', projects: [project('Riverside Pilot')], expected: 'Riverside Pilot (2)' },
    { name: 'two active matches', projects: [project('Riverside Pilot'), project('Riverside Pilot (2)')], expected: 'Riverside Pilot (3)' },
    { name: 'one archived match', projects: [project('Riverside Pilot', 'archived')], expected: 'Riverside Pilot' },
    { name: 'multiple archived matches', projects: [project('Riverside Pilot', 'archived'), project('Riverside Pilot (2)', 'archived')], expected: 'Riverside Pilot' },
    { name: 'active base plus archived suffix', projects: [project('Riverside Pilot'), project('Riverside Pilot (2)', 'archived')], expected: 'Riverside Pilot (2)' },
    { name: 'archived base plus active suffix', projects: [project('Riverside Pilot', 'archived'), project('Riverside Pilot (2)')], expected: 'Riverside Pilot' },
  ])('$name', ({ projects, expected }) => {
    expect(nextAvailableProjectTitle('Riverside Pilot', projects)).toBe(expected);
  });

  it('does not mutate archived project records', () => {
    const archived = project('Riverside Pilot', 'archived');
    const before = structuredClone(archived);

    expect(nextAvailableProjectTitle('Riverside Pilot', [archived])).toBe('Riverside Pilot');
    expect(archived).toEqual(before);
  });
});
