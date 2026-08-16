import { createGoldenDemoProject } from '@/lib/demo/seed';
import {
  CAREER_CONFLICT_DEMO_ID,
  createCareerConflictDemoMemories,
  createCareerConflictDemoProject,
} from '@/lib/demo/careerConflict';
import { getStorageProvider } from '@/lib/storage';
import { AppScope } from '@/types/scope';
import { Project } from '@/types/clarity';
import type { DurableMemory } from '@/types/contextPack';

export interface GoldenDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  created: boolean;
}

export interface CareerConflictDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
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

/** Loads a fresh, repeatable career-preference conflict demo into user-scoped storage. */
export async function loadCareerConflictDemoForUser(userId: string): Promise<CareerConflictDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.find((project) => project.id === CAREER_CONFLICT_DEMO_ID);
  const project = createCareerConflictDemoProject();
  const memories = createCareerConflictDemoMemories();

  await storage.saveProject(userId, project);
  const existingMemories = await storage.getMemories(userId);
  const retainedMemories = existingMemories.filter((memory) => !memory.id.startsWith('career_demo_'));
  const updatedMemories = [...retainedMemories, ...memories];
  await storage.replaceMemories(userId, updatedMemories);
  const existingFeedback = await storage.getFeedback(userId);
  await Promise.all(
    existingFeedback
      .filter((feedback) => feedback.id.startsWith('career_demo_'))
      .map((feedback) => storage.deleteFeedback(userId, feedback.id))
  );

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories: updatedMemories,
    created: !existingDemo,
  };
}
