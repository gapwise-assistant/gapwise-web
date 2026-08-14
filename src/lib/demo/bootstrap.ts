import { createGoldenDemoProject } from '@/lib/demo/seed';
import { getStorageProvider } from '@/lib/storage';
import { AppScope } from '@/types/scope';
import { Project } from '@/types/clarity';

export interface GoldenDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  created: boolean;
}

/**
 * Copy the reusable Golden Demo seed into one user's storage. The canonical
 * project ID makes this operation idempotent without touching demo-user.
 */
export async function loadGoldenDemoForUser(userId: string): Promise<GoldenDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.find((project) => project.id === 'hackathon_demo');
  const project = existingDemo ?? createGoldenDemoProject();
  const created = !existingDemo;

  if (created) {
    await storage.saveProject(userId, project);
  }

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    created,
  };
}
