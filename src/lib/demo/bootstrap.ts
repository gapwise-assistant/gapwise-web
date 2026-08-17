import { createGoldenDemoProject } from '@/lib/demo/seed';
import {
  CAREER_CONFLICT_DEMO_ID,
  createCareerConflictDemoMemories,
  createCareerConflictDemoProject,
} from '@/lib/demo/careerConflict';
import {
  createHackathonDemoMemories,
  createHackathonDemoProject,
  HACKATHON_DEMO_ID,
} from '@/lib/demo/hackathon';
import {
  createKintaGenDemoMemories,
  createKintaGenDemoProject,
  KINTAGEN_DEMO_ID,
} from '@/lib/demo/kintagen';
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

export interface HackathonDemoBootstrapResult {
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
  created: boolean;
}

export interface KintaGenDemoBootstrapResult {
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

  await storage.resetUserData(userId);
  await storage.saveProject(userId, project);
  await storage.replaceMemories(userId, memories);

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories,
    created: !existingDemo,
  };
}

/** Loads a fresh, repeatable non-meta hackathon project into user-scoped storage. */
export async function loadHackathonDemoForUser(userId: string): Promise<HackathonDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.some((candidate) => candidate.id === HACKATHON_DEMO_ID);
  const project = createHackathonDemoProject();
  const memories = createHackathonDemoMemories();

  await storage.resetUserData(userId);
  await storage.saveProject(userId, project);
  await storage.replaceMemories(userId, memories);

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories,
    created: !existingDemo,
  };
}

/** Loads a fresh, repeatable scientific AI assistant project into user-scoped storage. */
export async function loadKintaGenDemoForUser(userId: string): Promise<KintaGenDemoBootstrapResult> {
  const storage = getStorageProvider();
  const existingProjects = await storage.listProjects(userId);
  const existingDemo = existingProjects.some((candidate) => candidate.id === KINTAGEN_DEMO_ID);
  const project = createKintaGenDemoProject();
  const memories = createKintaGenDemoMemories();

  await storage.resetUserData(userId);
  await storage.saveProject(userId, project);
  await storage.replaceMemories(userId, memories);

  const scope: AppScope = { type: 'project', projectId: project.id };
  await storage.setAppScope(userId, scope);

  return {
    project,
    projects: await storage.listProjects(userId),
    activeProjectId: project.id,
    scope,
    memories,
    created: !existingDemo,
  };
}
