import { Project } from '@/types/clarity';
import { highImpactProjectGaps } from '@/lib/you/sections';
import { projectForReasoning } from '@/lib/context/sourceState';

export interface ProjectCardSummary {
  id: string;
  name: string;
  primaryGoal: string;
  status: 'active' | 'archived';
  openImportantCount: number;
  sourceCount: number;
  updatedAt: string;
  updatedLabel: string;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function formatProjectUpdatedLabel(updatedAt: string, now = new Date()): string {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) return 'Updated recently';

  const dayDiff = Math.floor((startOfDay(now).getTime() - startOfDay(updated).getTime()) / 86_400_000);
  if (dayDiff <= 0) return 'Updated today';
  if (dayDiff === 1) return 'Updated yesterday';
  if (dayDiff < 7) return `Updated ${dayDiff} days ago`;
  return `Updated ${updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function summarizeProject(project: Project, now = new Date()): ProjectCardSummary {
  const reasoningProject = projectForReasoning(project);
  return {
    id: project.id,
    name: project.title,
    primaryGoal: project.goal,
    status: project.status === 'archived' ? 'archived' : 'active',
    openImportantCount: highImpactProjectGaps(project).length,
    sourceCount: reasoningProject.sources.length,
    updatedAt: project.updated_at,
    updatedLabel: formatProjectUpdatedLabel(project.updated_at, now),
  };
}

export function groupProjectSummaries(projects: Project[], now = new Date()) {
  const summaries = projects
    .map((project) => summarizeProject(project, now))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    active: summaries.filter((project) => project.status === 'active'),
    archived: summaries.filter((project) => project.status === 'archived'),
  };
}
