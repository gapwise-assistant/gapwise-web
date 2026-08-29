import type { Project } from '@/types/clarity';

/**
 * Return the first available title for a newly created active workspace.
 * Archived workspaces remain visible under their original names, but do not
 * reserve a suffix for future active workspaces.
 */
export function nextAvailableProjectTitle(baseTitle: string, projects: Project[]): string {
  const base = baseTitle.trim().replace(/\s+\(\d+\)$/, '').trim() || 'Project';
  const activeTitles = new Set(
    projects
      .filter((project) => project.status !== 'archived')
      .map((project) => project.title.trim().toLowerCase()),
  );

  if (!activeTitles.has(base.toLowerCase())) return base;

  let suffix = 2;
  while (activeTitles.has(`${base} (${suffix})`.toLowerCase())) suffix += 1;
  return `${base} (${suffix})`;
}
