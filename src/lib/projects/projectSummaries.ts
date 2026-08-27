import { Project } from '@/types/clarity';
import { highImpactProjectGaps } from '@/lib/you/sections';
import { projectForReasoning } from '@/lib/context/sourceState';
import { formatCompactDateTime, formatDateOnly, formatDateTime } from '@/lib/datetime/displayDateTime';
import { projectTitlePresentation } from '@/lib/projects/projectTitle';

export interface ProjectCardSummary {
  id: string;
  name: string;
  primaryGoal: string;
  status: 'active' | 'archived';
  openImportantCount: number;
  sourceCount: number;
  createdAt: string;
  createdLabel: string;
  createdTooltip: string;
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
  return `Updated ${formatDateOnly(updated, { includeYear: false })}`;
}

export function summarizeProject(project: Project, now = new Date()): ProjectCardSummary {
  const reasoningProject = projectForReasoning(project);
  const titlePresentation = projectTitlePresentation(project.title);
  const createdAt = titlePresentation.legacyCreatedAt ?? project.created_at;
  return {
    id: project.id,
    name: titlePresentation.title,
    primaryGoal: project.goal,
    status: project.status === 'archived' ? 'archived' : 'active',
    openImportantCount: highImpactProjectGaps(project).length,
    sourceCount: reasoningProject.sources.length,
    createdAt: project.created_at,
    createdLabel: formatCompactDateTime(createdAt),
    createdTooltip: formatDateTime(createdAt),
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
