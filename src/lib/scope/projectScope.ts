import { Project } from '@/types/clarity';
import { AppScope, EVERYTHING_SCOPE } from '@/types/scope';
import { relevanceScore } from '@/lib/retrieval/relevance';
import { projectForReasoning } from '@/lib/context/sourceState';

const EVERYTHING_PROJECT_ID = '__everything__';
export const GENERAL_CONTEXT_ID = '__general_context__';

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export function emptyGeneralContext(now = new Date().toISOString()): Project {
  return {
    id: GENERAL_CONTEXT_ID,
    title: 'General context',
    goal: 'User-level context that is not assigned to a project.',
    status: 'active',
    clarity_score: 0,
    nodes: [],
    edges: [],
    sources: [],
    history: [],
    historyEvents: [],
    active_question: null,
    created_at: now,
    updated_at: now,
  };
}

export function mergeProjectsForEverything(projects: Project[], generalContext?: Project): Project {
  const activeProjects = projects.filter((project) => project.status !== 'archived');
  const included = generalContext ? [...activeProjects, generalContext] : activeProjects;
  const timestamps = included.map((project) => project.updated_at).filter(Boolean).sort();
  const created = included.map((project) => project.created_at).filter(Boolean).sort();
  const clarity = activeProjects.length
    ? Math.round(activeProjects.reduce((sum, project) => sum + project.clarity_score, 0) / activeProjects.length)
    : 0;

  return {
    id: EVERYTHING_PROJECT_ID,
    title: 'Everything',
    goal: 'Reason across all active projects and general context.',
    status: 'active',
    clarity_score: clarity,
    nodes: dedupeById(included.flatMap((project) => project.nodes)),
    edges: dedupeById(included.flatMap((project) => project.edges)),
    sources: dedupeById(included.flatMap((project) => project.sources)),
    history: included
      .flatMap((project) => project.history)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    historyEvents: included
      .flatMap((project) => project.historyEvents ?? [])
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    active_question: null,
    created_at: created[0] ?? new Date().toISOString(),
    updated_at: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
  };
}

export function resolveScope(scope: AppScope | null | undefined, projects: Project[]): AppScope {
  if (scope?.type === 'project' && projects.some((project) => project.id === scope.projectId && project.status !== 'archived')) {
    return scope;
  }
  return EVERYTHING_SCOPE;
}

export function projectForScope(scope: AppScope, projects: Project[], generalContext?: Project): Project {
  if (scope.type === 'project') {
    const selected = projects.find((project) => project.id === scope.projectId);
    if (selected) return selected;
  }
  return mergeProjectsForEverything(projects, generalContext);
}

export function contextTargetForScope(
  scope: AppScope,
  projects: Project[],
  generalContext: Project,
  requestedProjectId?: string
): Project {
  if (scope.type === 'project') {
    return projects.find((project) => project.id === scope.projectId) ?? generalContext;
  }
  if (requestedProjectId && requestedProjectId !== GENERAL_CONTEXT_ID) {
    return projects.find((project) => project.id === requestedProjectId) ?? generalContext;
  }
  return generalContext;
}

function projectRelevanceText(project: Project): string {
  const reasoningProject = projectForReasoning(project);
  return [
    reasoningProject.title,
    reasoningProject.goal,
    reasoningProject.one_sentence_context,
    ...reasoningProject.nodes.slice(0, 20).map((node) => node.text),
    ...reasoningProject.sources.slice(0, 20).flatMap((source) => [source.filename, source.extraction_summary, source.content]),
  ].filter(Boolean).join(' ');
}

export function isTextRelevantToProject(text: string, project: Project): boolean {
  const projectText = projectRelevanceText(project);
  return relevanceScore(text, projectText) >= 0.16;
}
