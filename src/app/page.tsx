'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from '@/components/Header';
import { NewProjectModal } from '@/components/NewProjectModal';
import { Today } from '@/components/Today';
import { AskGapswise } from '@/components/AskGapswise';
import type { ContextEntry } from '@/components/ContextInbox';
import { ScopeDestination } from '@/components/YouDestination';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { IdontKnowModal, type IdontKnowStrategyResult } from '@/components/IdontKnowModal';
import { AnswerQuestionModal, AnswerQuestionTarget } from '@/components/AnswerQuestionModal';
import { TracePanel } from '@/components/dev/TracePanel';
import { Project, UserMemoryProfile, CandidateGap } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import type { AskTarget, PendingAskHandoff } from '@/types/ask';
import { FeedbackEvent } from '@/types/feedback';
import { DEMO_USER_ID, GOLDEN_DEMO_PROJECT, DEFAULT_USER_PROFILE } from '@/lib/store';
import { processIdontKnowStrategy } from '@/lib/questions/idontKnowStrategies';
import { memoriesFromProfile } from '@/lib/memory/store';
import { appendFeedbackEvent, loadFeedbackEvents, saveFeedbackEvents } from '@/lib/personalization/feedbackStore';
import { createFeedbackEvent } from '@/lib/personalization/applyFeedback';
import {
  CAREER_CONFLICT_QUESTION_ID,
  CAREER_CONFLICT_DEMO_ID,
  careerRoleDisposition,
  updateCareerConflictMemories,
} from '@/lib/demo/careerConflict';
import { HACKATHON_DEMO_ID } from '@/lib/demo/hackathon';
import { KINTAGEN_DEMO_ID } from '@/lib/demo/kintagen';
import { BAKERY_DEMO_ID } from '@/lib/demo/bakery';
import { BAKERY_JOURNEY_DEMO_ID } from '@/lib/demo/bakeryJourney';
import { NORTHSTAR_PILOT_DEMO_ID } from '@/lib/demo/northstarPilot';
import type { CreateProjectInput } from '@/lib/projects/createProject';
import { AppScope, WorkspaceScope } from '@/types/scope';
import type { TodayQuestion } from '@/lib/today/sections';
import { localQuestionPresentation } from '@/lib/today/questionPlans';
import { emptyGeneralContext, GENERAL_CONTEXT_ID, projectForScope, resolveScope } from '@/lib/scope/projectScope';
import { authFetch } from '@/lib/auth/client';
import { isLocalhostBrowser } from '@/lib/runtime/localhost';
import { useAuth } from '@/components/AuthProvider';
import { LoginScreen } from '@/components/LoginScreen';
import { DemoLoadingState } from '@/components/DemoLoadingState';
import { WorkspaceLoadingState } from '@/components/WorkspaceLoadingState';
import { CleanupLocalUserDataModal } from '@/components/CleanupLocalUserDataModal';
import type { LocalCleanupPreview } from '@/lib/demo/cleanupLocalUserData';
import { NewUserOnboarding } from '@/components/NewUserOnboarding';
import { DecisionWorkspace } from '@/components/DecisionWorkspace';
import { AppDestination } from '@/lib/navigation';
import { buildQuestionWhyExplanation } from '@/lib/questions/whyQuestion';
import { buildDecisionWorkspace, decisionQuestionForDisplay, findDecisionForNode } from '@/lib/decisions/workspace';
import type { ResolvedGapRecord } from '@/lib/questions/history';
import { calculateGapPriority } from '@/lib/prioritization';
import { appendGoalChangedHistory } from '@/lib/history/projectHistory';
import { projectTitlePresentation } from '@/lib/projects/projectTitle';
import type { QuickDemoResult } from '@/lib/demo/quickDemo';
import type { SoftwareReleaseDemoResult } from '@/lib/demo/softwareReleaseDemo';
import type { ResolutionValidationSubmission } from '@/types/resolutionValidation';
import { graphQuestionIntent } from '@/lib/questions/answerIntent';

type AppTab = AppDestination;

function workspaceScopeForProject(project: Project): WorkspaceScope {
  return { type: 'project', projectId: project.id };
}

async function loadProjectsFromAPI(userId: string): Promise<{ projects: Project[]; activeProjectId: string | null; scope: WorkspaceScope | null }> {
  const res = await authFetch(`/api/projects?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error('Workspaces API is not available');
  const data = await res.json();
  return {
    projects: data.projects as Project[],
    activeProjectId: typeof data.activeProjectId === 'string' ? data.activeProjectId : null,
    scope: data.scope?.type === 'project' ? data.scope as WorkspaceScope : null,
  };
}

async function loadGeneralContextFromAPI(userId: string): Promise<Project> {
  try {
    const response = await authFetch(`/api/context/general?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error('General context API is unavailable');
    return (await response.json()).context as Project;
  } catch {
    return emptyGeneralContext();
  }
}

async function persistGeneralContextToAPI(userId: string, context: Project): Promise<boolean> {
  try {
    const response = await authFetch('/api/context/general', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, context }),
    });
    if (!response.ok) throw new Error('General context write failed');
    return true;
  } catch {
    return false;
  }
}

async function persistProjectToAPI(userId: string, project: Project): Promise<boolean> {
  try {
    const res = await authFetch('/api/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, project }),
    });
    if (!res.ok) throw new Error('Persistent storage write failed');
    return true;
  } catch {
    return false;
  }
}

async function createProjectViaAPI(userId: string, input: CreateProjectInput): Promise<{ project: Project; projects: Project[] }> {
  const res = await authFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...input }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Workspace creation failed.');
  }
  return (await res.json()) as { project: Project; projects: Project[] };
}

async function loadGoldenDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
}> {
  const res = await authFetch('/api/projects/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The demo could not be loaded.');
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
  };
}

async function loadCareerConflictDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
}> {
  const res = await authFetch('/api/projects/career-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The career conflict demo could not be loaded.');
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
    memories: DurableMemory[];
  };
}

async function loadHackathonDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
}> {
  const res = await authFetch('/api/projects/hackathon-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The voluntary demo could not be loaded.');
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
    memories: DurableMemory[];
  };
}

async function loadKintaGenDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
}> {
  const res = await authFetch('/api/projects/kintagen-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The scientific assistant demo could not be loaded.');
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
    memories: DurableMemory[];
  };
}

async function loadBakeryDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
}> {
  const res = await authFetch('/api/projects/bakery-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The bakery pop-up demo could not be loaded.');
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
    memories: DurableMemory[];
  };
}

async function loadBakeryJourneyDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
}> {
  const res = await authFetch('/api/projects/bakery-journey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The bakery journey demo could not be loaded.');
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
    memories: DurableMemory[];
  };
}

async function loadNorthstarPilotDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
  memories: DurableMemory[];
}> {
  const res = await authFetch('/api/projects/northstar-pilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The Northstar pilot demo could not be loaded.');
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
    memories: DurableMemory[];
  };
}

async function loadHarborHotelsCheckpointViaAPI(userId: string, checkpoint: 'early' | 'middle' | 'late'): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
}> {
  const res = await authFetch(`/api/projects/harbor-hotels/${checkpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `The Harbor Hotels ${checkpoint} checkpoint could not be loaded.`);
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
  };
}

async function createHarborHistoryDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
}> {
  const res = await authFetch('/api/dev/harbor-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, fresh: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error ?? 'The Harbor history demo could not be created.') as Error & {
      generationRunId?: string;
      projectId?: string;
    };
    error.generationRunId = typeof body.generationRunId === 'string' ? body.generationRunId : undefined;
    error.projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
    throw error;
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
  };
}

async function createRiversideHistoryDemoViaAPI(userId: string): Promise<{
  project: Project;
  projects: Project[];
  activeProjectId: string;
  scope: AppScope;
}> {
  const res = await authFetch('/api/dev/riverside-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, fresh: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error ?? 'The Riverside history demo could not be created.') as Error & {
      generationRunId?: string;
      projectId?: string;
    };
    error.generationRunId = typeof body.generationRunId === 'string' ? body.generationRunId : undefined;
    error.projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
    throw error;
  }
  return (await res.json()) as {
    project: Project;
    projects: Project[];
    activeProjectId: string;
    scope: AppScope;
  };
}

async function createQuickDemoViaAPI(userId: string): Promise<QuickDemoResult> {
  const res = await authFetch('/api/demos/quick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The quick Gapwise demo could not be created.');
  }
  return (await res.json()) as QuickDemoResult;
}

async function createSoftwareReleaseDemoViaAPI(userId: string): Promise<SoftwareReleaseDemoResult> {
  const res = await authFetch('/api/demos/software-release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error ?? 'The software release demo could not be created.') as Error & {
      generationRunId?: string;
      projectId?: string;
    };
    error.generationRunId = typeof body.generationRunId === 'string' ? body.generationRunId : undefined;
    error.projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
    throw error;
  }
  return (await res.json()) as SoftwareReleaseDemoResult;
}

async function loadCleanupPreviewViaAPI(): Promise<LocalCleanupPreview> {
  const res = await authFetch('/api/dev/cleanup-local-user');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'The local data cleanup preview could not be loaded.');
  }
  const data = await res.json() as { preview: LocalCleanupPreview };
  return data.preview;
}

async function cleanupLocalUserDataViaAPI(): Promise<{
  deleted: LocalCleanupPreview & { cloudDeletionFailures: Array<{ storageUrl: string; error: string }> };
  partialFailures: Array<{ stage: string; error: string }>;
}> {
  const res = await authFetch('/api/dev/cleanup-local-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE MY LOCAL DATA' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 207) {
    throw new Error(data.error ?? 'Local data cleanup failed.');
  }
  return data as {
    deleted: LocalCleanupPreview & { cloudDeletionFailures: Array<{ storageUrl: string; error: string }> };
    partialFailures: Array<{ stage: string; error: string }>;
  };
}

interface ScopePersistenceResult {
  scope?: WorkspaceScope;
  activeProjectId?: string;
  project?: Project;
  projects?: Project[];
}

async function persistScopeToAPI(userId: string, scope: WorkspaceScope): Promise<ScopePersistenceResult | null> {
  try {
    const res = await authFetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, scope }),
    });
    if (!res.ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[Gapwise workspace selection persistence failed]', { status: res.status });
      }
      throw new Error('Scope write failed');
    }
    return await res.json() as ScopePersistenceResult;
  } catch {
    return null;
  }
}

function reportDemoFailure(label: string, caught: unknown): void {
  const error = caught instanceof Error ? caught : new Error(String(caught));
  const diagnostic = error as Error & { generationRunId?: string; projectId?: string };
  console.error('[Gapwise developer demo failed]', {
    demo: label,
    error,
    generationRunId: diagnostic.generationRunId,
    projectId: diagnostic.projectId,
  });
}

async function loadMemorySettingsFromAPI(userId: string): Promise<{ profile: UserMemoryProfile; memories: DurableMemory[] } | null> {
  try {
    const res = await authFetch(`/api/memory?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error(`Memory settings request failed (${res.status})`);
    const data = await res.json();
    return {
      profile: { ...DEFAULT_USER_PROFILE, ...(data.profile ?? {}) },
      memories: Array.isArray(data.memories) ? data.memories as DurableMemory[] : [],
    };
  } catch (error) {
    console.error('[Gapwise settings] Failed to load memory settings', error);
    return null;
  }
}

async function persistMemorySettingsToAPI(
  userId: string,
  profile: UserMemoryProfile,
  memories: DurableMemory[],
): Promise<boolean> {
  try {
    const res = await authFetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, profile, memories }),
    });
    if (!res.ok) throw new Error(`Memory settings write failed (${res.status})`);
    return true;
  } catch (error) {
    console.error('[Gapwise settings] Failed to save memory settings', error);
    return false;
  }
}

function clearLegacyProjectBrowserState(userId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`gapwise_state_${userId}`);
  localStorage.removeItem(`gapwise_active_project_${userId}`);
  localStorage.removeItem(`gapwise_scope_${userId}`);
}

function clearDemoBrowserState(userId: string): void {
  if (typeof window === 'undefined') return;
  clearLegacyProjectBrowserState(userId);
  const keysToRemove = new Set([
    `gapwise_state_${userId}`,
    `gapwise_active_project_${userId}`,
    `gapwise_scope_${userId}`,
    `gapwise_profile_${userId}`,
    `gapwise_memories_${userId}`,
    `gapwise_feedback_${userId}`,
  ]);
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if ((key?.startsWith(`gapwise_ask_`) && key.includes(`_${userId}_`)) || keysToRemove.has(key ?? '')) {
      localStorage.removeItem(key!);
    }
  }
}

export default function Home() {
  const auth = useAuth();
  const userId = auth.userId ?? DEMO_USER_ID;
  const [project, setProject] = useState<Project>(() => emptyGeneralContext());
  const [projects, setProjects] = useState<Project[]>([]);
  const [scope, setScope] = useState<WorkspaceScope | null>(null);
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);
  const [generalContext, setGeneralContext] = useState<Project>(() => emptyGeneralContext());
  const [profile, setProfile] = useState<UserMemoryProfile>(DEFAULT_USER_PROFILE);
  const [memories, setMemories] = useState<DurableMemory[]>([]);
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEvent[]>([]);
  const [activeTab, setActiveTab] = useState<AppTab>('today');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [askInitialPrompt, setAskInitialPrompt] = useState('');
  const [askNewChatPrompt, setAskNewChatPrompt] = useState<PendingAskHandoff | null>(null);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [isLoadingCareerDemo, setIsLoadingCareerDemo] = useState(false);
  const [isLoadingHackathonDemo, setIsLoadingHackathonDemo] = useState(false);
  const [isLoadingKintaGenDemo, setIsLoadingKintaGenDemo] = useState(false);
  const [isLoadingBakeryDemo, setIsLoadingBakeryDemo] = useState(false);
  const [isLoadingBakeryJourneyDemo, setIsLoadingBakeryJourneyDemo] = useState(false);
  const [isLoadingNorthstarPilotDemo, setIsLoadingNorthstarPilotDemo] = useState(false);
  const [isLoadingHarborEarly, setIsLoadingHarborEarly] = useState(false);
  const [isLoadingHarborMiddle, setIsLoadingHarborMiddle] = useState(false);
  const [isLoadingHarborLate, setIsLoadingHarborLate] = useState(false);
  const [isLoadingHarborHistoryDemo, setIsLoadingHarborHistoryDemo] = useState(false);
  const [isLoadingRiversideHistoryDemo, setIsLoadingRiversideHistoryDemo] = useState(false);
  const [isLoadingQuickDemo, setIsLoadingQuickDemo] = useState(false);
  const [isLoadingSoftwareReleaseDemo, setIsLoadingSoftwareReleaseDemo] = useState(false);
  const [isCleanupLocalDataOpen, setIsCleanupLocalDataOpen] = useState(false);
  const [isLoadingCleanupPreview, setIsLoadingCleanupPreview] = useState(false);
  const [isCleaningUpLocalData, setIsCleaningUpLocalData] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<LocalCleanupPreview | null>(null);
  const [cleanupError, setCleanupError] = useState('');
  const [isLocalhostDeveloper, setIsLocalhostDeveloper] = useState(false);
  const [projectFocusKey, setProjectFocusKey] = useState(0);
  const [idontKnowGap, setIdontKnowGap] = useState<CandidateGap | null>(null);
  const [idontKnowProjectId, setIdontKnowProjectId] = useState<string | null>(null);
  const [answerTarget, setAnswerTarget] = useState<AnswerQuestionTarget | null>(null);
  const [answerTargetError, setAnswerTargetError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [storageMessage, setStorageMessage] = useState('');
  const [contextEntry, setContextEntry] = useState<ContextEntry | null>(null);
  const [reasoningPathRequest, setReasoningPathRequest] = useState<{ projectId: string; nodeId: string } | null>(null);
  const [gapsNavigationRequest, setGapsNavigationRequest] = useState<{ status: 'resolved'; key: number } | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{
    projectId: string;
    nodeId: string;
    initialOutcome?: string;
    historyTimestamp?: string;
  } | null>(null);
  const demoMode = auth.demoMode;
  const isPublicDemo = auth.accessTier === 'public_demo';
  useEffect(() => {
    setIsLocalhostDeveloper(isLocalhostBrowser());
  }, []);
  useEffect(() => {
    if (auth.userId) clearLegacyProjectBrowserState(auth.userId);
  }, [auth.userId]);
  const loadingDemoLabel = isLoadingCareerDemo
    ? 'Career demo'
    : isLoadingHackathonDemo
      ? 'Voluntary demo'
      : isLoadingKintaGenDemo
        ? 'Scientific AI assistant'
        : isLoadingBakeryDemo
          ? 'Bakery pop-up demo'
          : isLoadingBakeryJourneyDemo
            ? 'Bakery journey'
            : isLoadingNorthstarPilotDemo
              ? 'Northstar pilot'
              : isLoadingHarborEarly
                ? 'Harbor Hotels · Early'
                : isLoadingHarborMiddle
                  ? 'Harbor Hotels · Middle'
                  : isLoadingHarborLate
                    ? 'Harbor Hotels · Late'
              : isLoadingHarborHistoryDemo
                ? 'Harbor history demo'
              : isLoadingRiversideHistoryDemo
                  ? 'Riverside history demo'
                  : isLoadingSoftwareReleaseDemo
                    ? 'RelayDesk software release demo'
                  : isLoadingQuickDemo
                    ? 'quick Gapwise demo'
                  : isLoadingDemo
                        ? 'demo'
                        : null;
  const openContext = useCallback((entry: ContextEntry = { tab: 'recent' }) => {
    setContextEntry(entry);
    setActiveTab('scope');
  }, []);

  // Load project from persistent storage on mount and user switch
  useEffect(() => {
    if (!auth.isReady || !auth.userId) return;
    setIsLoading(true);
    setStorageMessage('');
    let active = true;
    setFeedbackEvents(loadFeedbackEvents(userId));
    void loadMemorySettingsFromAPI(userId).then((settings) => {
      if (!active || !settings) return;
      setProfile(settings.profile);
      setMemories(settings.memories);
    });
    Promise.all([
      loadProjectsFromAPI(userId),
      isPublicDemo ? Promise.resolve(emptyGeneralContext()) : loadGeneralContextFromAPI(userId),
    ]).then(([loaded, loadedGeneralContext]) => {
      if (!active) return;
      const nextProjects = loaded.projects;
      const nextScope = resolveScope(loaded.scope, nextProjects, loaded.activeProjectId);
      const selectedProject =
        (nextScope ? nextProjects.find((item) => item.id === nextScope.projectId) : undefined) ??
        nextProjects.find((item) => item.id === loaded.activeProjectId && item.status !== 'archived') ??
        nextProjects.find((item) => item.status !== 'archived') ??
        nextProjects[0] ??
        loadedGeneralContext;
      setProjects(nextProjects);
      setProject(selectedProject);
      setScope(nextScope);
      setGeneralContext(loadedGeneralContext);
      setIsLoading(false);
    }).catch((error) => {
      console.error('[Gapwise project state load failed]', error);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [auth.isReady, auth.userId, isPublicDemo]);

  const scopedProject = useMemo(
    () => projectForScope(scope, projects, generalContext),
    [scope, projects, generalContext]
  );

  // Auto-persist whenever project changes
  const updateProject = useCallback(async (updated: Project): Promise<boolean> => {
    const previous = projects.find((candidate) => candidate.id === updated.id)
      ?? (project.id === updated.id ? project : undefined);
    const next = previous ? appendGoalChangedHistory(previous, updated) : updated;
    const savedToApi = await persistProjectToAPI(userId, next);
    setStorageMessage(savedToApi ? '' : 'Persistent storage was unavailable; the change was not saved.');
    if (!savedToApi) return false;
    setProject((current) => (current.id === next.id ? next : current));
    setProjects((current) => {
      const existingIndex = current.findIndex((item) => item.id === next.id);
      if (existingIndex < 0) return [next, ...current];
      return current.map((item) => (item.id === next.id ? next : item));
    });
    return savedToApi;
  }, [project, projects, userId]);

  const refreshProjectData = useCallback(async () => {
    try {
      const [loadedProjects, loadedGeneralContext] = await Promise.all([
        loadProjectsFromAPI(userId),
        loadGeneralContextFromAPI(userId),
      ]);
      setProjects(loadedProjects.projects);
      setGeneralContext(loadedGeneralContext);
      setProject((current) => current.id === GENERAL_CONTEXT_ID
        ? loadedGeneralContext
        : loadedProjects.projects.find((item) => item.id === current.id) ?? current);
      setProjectRefreshVersion((current) => current + 1);
    } catch (error) {
      console.error('[Gapwise project state refresh failed]', error);
      // The mutation is already persisted; keep the last successfully loaded view.
    }
  }, [userId]);

  const reloadProjectListFromFirestore = useCallback(async (preferredProjectId?: string) => {
    const loaded = await loadProjectsFromAPI(userId);
    const nextProjects = loaded.projects;
    const preferredProject = preferredProjectId
      ? nextProjects.find((item) => item.id === preferredProjectId)
      : undefined;
    if (preferredProjectId && !preferredProject) {
      throw new Error('The newly created workspace was not returned by persistent storage.');
    }
    const nextScope = preferredProject
      ? { type: 'project' as const, projectId: preferredProject.id }
      : resolveScope(loaded.scope, nextProjects, loaded.activeProjectId);
    const nextProject = preferredProject
      ?? (nextScope
        ? nextProjects.find((item) => item.id === nextScope.projectId)
        : undefined)
      ?? nextProjects.find((item) => item.id === loaded.activeProjectId && item.status !== 'archived')
      ?? nextProjects.find((item) => item.status !== 'archived')
      ?? nextProjects[0]
      ?? emptyGeneralContext();

    setProjects(nextProjects);
    setProject(nextProject);
    setScope(nextScope);
    setProjectFocusKey((current) => current + 1);
    return { ...loaded, scope: nextScope, project: nextProject };
  }, [userId]);

  const handleSelectProject = useCallback(async (projectId: string): Promise<{ success: boolean }> => {
    const selected = projects.find((item) => item.id === projectId);
    if (!selected) {
      setStorageMessage('The requested workspace could not be found.');
      return { success: false };
    }
    const nextScope: AppScope = { type: 'project', projectId: selected.id };

    // Public-demo projects are server-assigned and read-only. The projects
    // list has already been filtered by the authenticated server response;
    // require that single returned project before changing local navigation.
    if (isPublicDemo) {
      if (projects.length !== 1 || projects[0]?.id !== selected.id) {
        setStorageMessage('The requested workspace could not be found.');
        return { success: false };
      }
      setProject(selected);
      setScope(nextScope);
      setProjectFocusKey((current) => current + 1);
      setStorageMessage('');
      return { success: true };
    }

    // Selecting the already active, known project is a local no-op. This is
    // intentionally after the project-list lookup so it cannot authorize an
    // arbitrary project ID.
    if (scope?.type === 'project' && scope.projectId === selected.id && project.id === selected.id) {
      setProject(selected);
      setScope(nextScope);
      setStorageMessage('');
      return { success: true };
    }

    const persisted = await persistScopeToAPI(userId, nextScope);
    if (!persisted?.scope || persisted.scope.type !== 'project') {
      setStorageMessage('Workspace selection could not be saved to persistent storage.');
      return { success: false };
    }
    if (persisted.projects) setProjects(persisted.projects);
    setProject(persisted.project ?? selected);
    setScope(persisted.scope);
    setStorageMessage('');
    return { success: true };
  }, [isPublicDemo, project, projects, scope, userId]);

  const handleNoActiveWorkspace = useCallback(() => {
    setScope(null);
    setProject(emptyGeneralContext());
    setActiveTab('scope');
    setProjectFocusKey((current) => current + 1);
  }, []);

  const openResolvedGaps = useCallback(() => {
    setGapsNavigationRequest({ status: 'resolved', key: Date.now() });
    setActiveTab('scope');
  }, []);

  const handleProjectBranched = useCallback((branchedProject: Project) => {
    const nextScope: AppScope = { type: 'project', projectId: branchedProject.id };
    setProjects((current) => [
      branchedProject,
      ...current.filter((candidate) => candidate.id !== branchedProject.id),
    ]);
    setProject(branchedProject);
    setScope(nextScope);
    setProjectFocusKey((current) => current + 1);
    setActiveTab('scope');
    setStorageMessage('');
  }, [userId]);

  const handleCreateProject = useCallback(async (input: CreateProjectInput) => {
    const result = await createProjectViaAPI(userId, input);
    setProjects(result.projects);
    setProject(result.project);
    setScope({ type: 'project', projectId: result.project.id });
    setIsNewProjectOpen(false);
    setActiveTab('scope');
    setProjectFocusKey((current) => current + 1);
    setStorageMessage('');
    return result.project;
  }, [userId]);

  const handleLoadDemo = useCallback(async () => {
    setIsLoadingDemo(true);
    try {
      const result = await loadGoldenDemoViaAPI(userId);
      setProjects(result.projects);
      setProject(result.project);
      setScope(workspaceScopeForProject(result.project));
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
    } catch (caught) {
      reportDemoFailure('demo', caught);
    } finally {
      setIsLoadingDemo(false);
    }
  }, [userId]);

  const handleLoadCareerConflictDemo = useCallback(async () => {
    setIsLoadingCareerDemo(true);
    try {
      const result = await loadCareerConflictDemoViaAPI(userId);
      setProjects(result.projects);
      setProject(result.project);
      setScope(workspaceScopeForProject(result.project));
      setMemories(result.memories);
      setProfile(DEFAULT_USER_PROFILE);
      clearDemoBrowserState(userId);
      void persistMemorySettingsToAPI(userId, DEFAULT_USER_PROFILE, result.memories);
      setFeedbackEvents([]);
      saveFeedbackEvents(userId, []);
      setGeneralContext(emptyGeneralContext());
      setContextEntry(null);
      setReasoningPathRequest(null);
      setDecisionTarget(null);
      setAnswerTarget(null);
      setIdontKnowGap(null);
      setIdontKnowProjectId(null);
      setAskInitialPrompt('');
      setAskNewChatPrompt(null);
      setStorageMessage('');
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
    } catch (caught) {
      reportDemoFailure('career conflict demo', caught);
    } finally {
      setIsLoadingCareerDemo(false);
    }
  }, [userId]);

  const handleLoadHackathonDemo = useCallback(async () => {
    setIsLoadingHackathonDemo(true);
    try {
      const result = await loadHackathonDemoViaAPI(userId);
      setProjects(result.projects);
      setProject(result.project);
      setScope(workspaceScopeForProject(result.project));
      setMemories(result.memories);
      setProfile(DEFAULT_USER_PROFILE);
      clearDemoBrowserState(userId);
      void persistMemorySettingsToAPI(userId, DEFAULT_USER_PROFILE, result.memories);
      setFeedbackEvents([]);
      saveFeedbackEvents(userId, []);
      setGeneralContext(emptyGeneralContext());
      setContextEntry(null);
      setReasoningPathRequest(null);
      setDecisionTarget(null);
      setAnswerTarget(null);
      setIdontKnowGap(null);
      setIdontKnowProjectId(null);
      setAskInitialPrompt('');
      setAskNewChatPrompt(null);
      setStorageMessage('');
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
    } catch (caught) {
      reportDemoFailure('voluntary demo', caught);
    } finally {
      setIsLoadingHackathonDemo(false);
    }
  }, [userId]);

  const handleLoadKintaGenDemo = useCallback(async () => {
    setIsLoadingKintaGenDemo(true);
    try {
      const result = await loadKintaGenDemoViaAPI(userId);
      setProjects(result.projects);
      setProject(result.project);
      setScope(workspaceScopeForProject(result.project));
      setMemories(result.memories);
      setProfile(DEFAULT_USER_PROFILE);
      clearDemoBrowserState(userId);
      void persistMemorySettingsToAPI(userId, DEFAULT_USER_PROFILE, result.memories);
      setFeedbackEvents([]);
      saveFeedbackEvents(userId, []);
      setGeneralContext(emptyGeneralContext());
      setContextEntry(null);
      setReasoningPathRequest(null);
      setDecisionTarget(null);
      setAnswerTarget(null);
      setIdontKnowGap(null);
      setIdontKnowProjectId(null);
      setAskInitialPrompt('');
      setAskNewChatPrompt(null);
      setStorageMessage('');
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
    } catch (caught) {
      reportDemoFailure('scientific assistant demo', caught);
    } finally {
      setIsLoadingKintaGenDemo(false);
    }
  }, [userId]);

  const handleLoadBakeryDemo = useCallback(async () => {
    setIsLoadingBakeryDemo(true);
    try {
      const result = await loadBakeryDemoViaAPI(userId);
      setProjects(result.projects);
      setProject(result.project);
      setScope(workspaceScopeForProject(result.project));
      setMemories(result.memories);
      setProfile(DEFAULT_USER_PROFILE);
      clearDemoBrowserState(userId);
      void persistMemorySettingsToAPI(userId, DEFAULT_USER_PROFILE, result.memories);
      setFeedbackEvents([]);
      saveFeedbackEvents(userId, []);
      setGeneralContext(emptyGeneralContext());
      setContextEntry(null);
      setReasoningPathRequest(null);
      setDecisionTarget(null);
      setAnswerTarget(null);
      setIdontKnowGap(null);
      setIdontKnowProjectId(null);
      setAskInitialPrompt('');
      setAskNewChatPrompt(null);
      setStorageMessage('');
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
    } catch (caught) {
      reportDemoFailure('bakery pop-up demo', caught);
    } finally {
      setIsLoadingBakeryDemo(false);
    }
  }, [userId]);

  const handleLoadBakeryJourneyDemo = useCallback(async () => {
    setIsLoadingBakeryJourneyDemo(true);
    try {
      const result = await loadBakeryJourneyDemoViaAPI(userId);
      setProjects(result.projects);
      setProject(result.project);
      setScope(workspaceScopeForProject(result.project));
      setMemories(result.memories);
      setProfile(DEFAULT_USER_PROFILE);
      clearDemoBrowserState(userId);
      void persistMemorySettingsToAPI(userId, DEFAULT_USER_PROFILE, result.memories);
      setFeedbackEvents([]);
      saveFeedbackEvents(userId, []);
      setGeneralContext(emptyGeneralContext());
      setContextEntry(null);
      setReasoningPathRequest(null);
      setDecisionTarget(null);
      setAnswerTarget(null);
      setIdontKnowGap(null);
      setIdontKnowProjectId(null);
      setAskInitialPrompt('');
      setAskNewChatPrompt(null);
      setStorageMessage('');
      setProjectFocusKey((current) => current + 1);
      setActiveTab('scope');
    } catch (caught) {
      reportDemoFailure('bakery journey demo', caught);
    } finally {
      setIsLoadingBakeryJourneyDemo(false);
    }
  }, [userId]);

  const handleLoadNorthstarPilotDemo = useCallback(async () => {
    setIsLoadingNorthstarPilotDemo(true);
    try {
      const result = await loadNorthstarPilotDemoViaAPI(userId);
      setProjects(result.projects);
      setProject(result.project);
      setScope(workspaceScopeForProject(result.project));
      setMemories(result.memories);
      setProfile(DEFAULT_USER_PROFILE);
      clearDemoBrowserState(userId);
      void persistMemorySettingsToAPI(userId, DEFAULT_USER_PROFILE, result.memories);
      setFeedbackEvents([]);
      saveFeedbackEvents(userId, []);
      setGeneralContext(emptyGeneralContext());
      setContextEntry(null);
      setReasoningPathRequest(null);
      setDecisionTarget(null);
      setAnswerTarget(null);
      setIdontKnowGap(null);
      setIdontKnowProjectId(null);
      setAskInitialPrompt('');
      setAskNewChatPrompt(null);
      setStorageMessage('');
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
    } catch (caught) {
      reportDemoFailure('Northstar pilot demo', caught);
    } finally {
      setIsLoadingNorthstarPilotDemo(false);
    }
  }, [userId]);

  const loadHarborCheckpoint = useCallback(async (
    checkpoint: 'early' | 'middle' | 'late',
    setLoadingCheckpoint: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    setLoadingCheckpoint(true);
    try {
      const result = await loadHarborHotelsCheckpointViaAPI(userId, checkpoint);
      setProjects(result.projects);
      setProject(result.project);
      setScope(workspaceScopeForProject(result.project));
      setMemories([]);
      setProfile(DEFAULT_USER_PROFILE);
      clearDemoBrowserState(userId);
      void persistMemorySettingsToAPI(userId, DEFAULT_USER_PROFILE, []);
      setFeedbackEvents([]);
      saveFeedbackEvents(userId, []);
      setGeneralContext(emptyGeneralContext());
      setContextEntry(null);
      setReasoningPathRequest(null);
      setDecisionTarget(null);
      setAnswerTarget(null);
      setIdontKnowGap(null);
      setIdontKnowProjectId(null);
      setAskInitialPrompt('');
      setAskNewChatPrompt(null);
      setStorageMessage('');
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
    } catch (caught) {
      reportDemoFailure(`Harbor Hotels ${checkpoint} checkpoint`, caught);
    } finally {
      setLoadingCheckpoint(false);
    }
  }, [userId]);

  const handleLoadHarborEarly = useCallback(() => {
    void loadHarborCheckpoint('early', setIsLoadingHarborEarly);
  }, [loadHarborCheckpoint]);

  const handleLoadHarborMiddle = useCallback(() => {
    void loadHarborCheckpoint('middle', setIsLoadingHarborMiddle);
  }, [loadHarborCheckpoint]);

  const handleLoadHarborLate = useCallback(() => {
    void loadHarborCheckpoint('late', setIsLoadingHarborLate);
  }, [loadHarborCheckpoint]);

  const handleCreateHarborHistoryDemo = useCallback(async () => {
    setIsLoadingHarborHistoryDemo(true);
    try {
      const result = await createHarborHistoryDemoViaAPI(userId);
      await reloadProjectListFromFirestore(result.project.id);
      setStorageMessage('');
    } catch (caught) {
      try {
        await reloadProjectListFromFirestore(scope?.projectId);
      } catch (reloadError) {
        reportDemoFailure('Harbor history project reload after failure', reloadError);
      }
      reportDemoFailure('Harbor history demo', caught);
    } finally {
      setIsLoadingHarborHistoryDemo(false);
    }
  }, [reloadProjectListFromFirestore, scope, userId]);

  const handleCreateRiversideHistoryDemo = useCallback(async () => {
    setIsLoadingRiversideHistoryDemo(true);
    try {
      const result = await createRiversideHistoryDemoViaAPI(userId);
      await reloadProjectListFromFirestore(result.project.id);
      setStorageMessage('');
    } catch (caught) {
      try {
        await reloadProjectListFromFirestore(scope?.projectId);
      } catch (reloadError) {
        reportDemoFailure('Riverside history project reload after failure', reloadError);
      }
      reportDemoFailure('Riverside history demo', caught);
    } finally {
      setIsLoadingRiversideHistoryDemo(false);
    }
  }, [reloadProjectListFromFirestore, scope, userId]);

  const handleCreateQuickDemo = useCallback(async () => {
    const previousProjectId = scope?.projectId;
    setIsLoadingQuickDemo(true);
    try {
      const result = await createQuickDemoViaAPI(userId);
      await reloadProjectListFromFirestore(result.project.id);
      setStorageMessage('');
      setActiveTab('today');
    } catch (caught) {
      try {
        await reloadProjectListFromFirestore(previousProjectId);
      } catch (reloadError) {
        console.error('[Quick Gapwise demo] project reload after failure failed', reloadError);
      }
      console.error('[Quick Gapwise demo] generation failed', caught);
      setStorageMessage('The quick Gapwise demo could not be created. Your current workspace was kept.');
    } finally {
      setIsLoadingQuickDemo(false);
    }
  }, [reloadProjectListFromFirestore, scope?.projectId, userId]);

  const handleCreateSoftwareReleaseDemo = useCallback(async () => {
    const previousProjectId = scope?.projectId;
    setIsLoadingSoftwareReleaseDemo(true);
    try {
      const result = await createSoftwareReleaseDemoViaAPI(userId);
      await reloadProjectListFromFirestore(result.project.id);
      setStorageMessage('');
      setActiveTab('scope');
    } catch (caught) {
      try {
        await reloadProjectListFromFirestore(previousProjectId);
      } catch (reloadError) {
        reportDemoFailure('RelayDesk demo reload after failure', reloadError);
      }
      reportDemoFailure('RelayDesk software release demo', caught);
      setStorageMessage('The software release demo could not be created. Your current workspace was kept.');
    } finally {
      setIsLoadingSoftwareReleaseDemo(false);
    }
  }, [reloadProjectListFromFirestore, scope?.projectId, userId]);

  const handleOpenCleanupLocalData = useCallback(() => {
    setIsCleanupLocalDataOpen(true);
    setCleanupError('');
    setCleanupPreview(null);
    setIsLoadingCleanupPreview(true);
    void loadCleanupPreviewViaAPI()
      .then(setCleanupPreview)
      .catch((caught) => setCleanupError(caught instanceof Error ? caught.message : 'The local data cleanup preview could not be loaded.'))
      .finally(() => setIsLoadingCleanupPreview(false));
  }, []);

  const handleCleanupLocalData = useCallback(async () => {
    setIsCleaningUpLocalData(true);
    setCleanupError('');
    try {
      const result = await cleanupLocalUserDataViaAPI();
      const loaded = await loadProjectsFromAPI(userId);
      const loadedGeneralContext = await loadGeneralContextFromAPI(userId);
      clearDemoBrowserState(userId);
      setProjects(loaded.projects);
      setProject(emptyGeneralContext());
      setGeneralContext(loadedGeneralContext);
      setScope(null);
      setMemories([]);
      setFeedbackEvents([]);
      setContextEntry(null);
      setReasoningPathRequest(null);
      setDecisionTarget(null);
      setAnswerTarget(null);
      setIdontKnowGap(null);
      setIdontKnowProjectId(null);
      setAskInitialPrompt('');
      setAskNewChatPrompt(null);
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
      setIsCleanupLocalDataOpen(false);
      if (result.partialFailures.length > 0) {
        setStorageMessage(`Your local Gapwise data was deleted, but some cleanup steps need attention: ${result.partialFailures.map((failure) => failure.error).join(' ')}`);
      } else {
        setStorageMessage('Your local Gapwise data was deleted. You can now create a fresh Harbor or Riverside demo.');
      }
    } catch (caught) {
      setCleanupError(caught instanceof Error ? caught.message : 'Local data cleanup failed.');
    } finally {
      setIsCleaningUpLocalData(false);
    }
  }, [userId]);

  const handleResetDemo = async () => {
    try {
      await authFetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'RESET' }),
      });
    } catch {}
    // Remove obsolete browser keys, but never use browser storage as project
    // or scope persistence.
    if (typeof window !== 'undefined') {
      clearLegacyProjectBrowserState(userId);
    }
    const fresh = JSON.parse(JSON.stringify(GOLDEN_DEMO_PROJECT));
    const seedMemories = memoriesFromProfile(DEFAULT_USER_PROFILE);
    setProject(fresh);
    setProjects([fresh]);
    setScope(workspaceScopeForProject(fresh));
    setGeneralContext(emptyGeneralContext());
    setProfile(DEFAULT_USER_PROFILE);
    setMemories(seedMemories);
    setFeedbackEvents([]);
    await persistMemorySettingsToAPI(userId, DEFAULT_USER_PROFILE, seedMemories);
    saveFeedbackEvents(userId, []);
    setActiveTab('today');
  };

  const handleDecideLater = async (): Promise<IdontKnowStrategyResult> => {
    if (!idontKnowGap) throw new Error('This question is no longer active.');
    const owner = idontKnowProjectId === GENERAL_CONTEXT_ID
      ? generalContext
      : projects.find((candidate) => candidate.id === idontKnowProjectId) ?? project;
    const projectWithSelectedGap: Project = {
      ...owner,
      active_question: idontKnowGap,
    };
    const { updatedProject, didChange } = await processIdontKnowStrategy(projectWithSelectedGap, 'defer', profile);
    if (didChange && owner.id === GENERAL_CONTEXT_ID) {
      setGeneralContext(updatedProject);
      persistGeneralContextToAPI(userId, updatedProject).then((savedToApi) => {
        setStorageMessage(savedToApi ? '' : 'Saved locally. General context API was unavailable.');
      });
    } else if (didChange) {
      updateProject(updatedProject);
    }
    return { message: 'Snoozed for now. We’ll bring this question back when it becomes important again.' };
  };

  const openGraphQuestion = useCallback((
    node: Project['nodes'][number],
    intent?: 'confirm' | 'correct',
    answerSuggestion?: TodayQuestion['answerSuggestion'],
    presentation?: Pick<TodayQuestion, 'presentationSummary'>,
  ) => {
    setAnswerTargetError('');
    const owner = projects.find((candidate) => candidate.nodes.some((item) => item.id === node.id))
      ?? (generalContext.nodes.some((item) => item.id === node.id) ? generalContext : undefined);
    const questionContext: TodayQuestion = {
      id: `question_${node.id}`,
      question: node.text,
      reason: node.why_it_matters?.[0] ?? 'This unresolved item can affect the next decision.',
      provenance: node.source_refs.length ? `Sources: ${node.source_refs.join(', ')}` : `Graph node: ${node.id}`,
      sourceNodeIds: [node.id],
    };
    const fallbackPresentation = localQuestionPresentation(questionContext);
    const decision = owner ? findDecisionForNode(owner, node.id) : null;
    const decisionWorkspace = owner ? buildDecisionWorkspace(owner, node.id) : null;
    const effectiveIntent = graphQuestionIntent(node, intent);
    setAnswerTarget({
      nodeId: node.id,
      question: node.text,
      presentationTitle: node.text,
      presentationSummary: presentation?.presentationSummary ?? fallbackPresentation.summary,
      reason: node.why_it_matters?.[0],
      projectId: owner?.id,
      intent: effectiveIntent,
      decisionNodeId: decision?.id,
      decisionTitle: decision?.text,
      decisionSupport: decisionWorkspace ? {
        options: decisionWorkspace.options.map((option) => ({ id: option.id, label: option.label, text: option.text, evidence: option.evidence.slice(0, 2).map((evidence) => ({ text: evidence.text, sourceNames: evidence.sourceNames })) })),
        currentPicture: decisionWorkspace.currentPicture,
        recommendation: decisionWorkspace.recommendation ? {
          optionId: decisionWorkspace.recommendation.option.id,
          label: decisionWorkspace.recommendation.option.label,
          explanation: decisionWorkspace.recommendation.explanation,
        } : null,
      } : undefined,
      explanation: owner ? buildQuestionWhyExplanation(owner, questionContext) : undefined,
      answerSuggestion,
    });
  }, [generalContext, projects]);

  const openDecisionWorkspace = useCallback((nodeId: string) => {
    const owner = projects.find((candidate) => candidate.nodes.some((node) => node.id === nodeId))
      ?? (generalContext.nodes.some((node) => node.id === nodeId) ? generalContext : undefined);
    if (owner) setDecisionTarget({ projectId: owner.id, nodeId });
  }, [generalContext, projects]);

  const decisionProject = useMemo(() => {
    if (!decisionTarget) return null;
    if (decisionTarget.projectId === GENERAL_CONTEXT_ID) return generalContext;
    return projects.find((candidate) => candidate.id === decisionTarget.projectId) ?? null;
  }, [decisionTarget, generalContext, projects]);

  const handleDecisionDontKnow = useCallback(() => {
    if (!decisionTarget || !decisionProject) return;
    const decision = decisionProject.nodes.find((node) => node.id === decisionTarget.nodeId);
    if (!decision || decision.type !== 'DECISION' || decision.status !== 'OPEN') return;
    const gap = calculateGapPriority(decision, decisionProject, profile);
    setIdontKnowProjectId(decisionProject.id);
    setIdontKnowGap({
      ...gap,
      question: decisionQuestionForDisplay(decisionProject, decision),
    });
    setDecisionTarget(null);
  }, [decisionProject, decisionTarget, profile]);

  const saveDecision = useCallback(async (updated: Project) => {
    let savedToApi: boolean;
    if (updated.id === GENERAL_CONTEXT_ID) {
      setGeneralContext(updated);
      savedToApi = await persistGeneralContextToAPI(userId, updated);
      setStorageMessage(savedToApi ? '' : 'Decision saved locally. General context API was unavailable.');
    } else {
      savedToApi = await updateProject(updated);
    }
    if (savedToApi) await refreshProjectData();
  }, [refreshProjectData, updateProject, userId]);

  const viewDecisionGraph = useCallback((nodeId: string) => {
    const owner = projects.find((candidate) => candidate.nodes.some((node) => node.id === nodeId));
    if (!owner) return;
    handleSelectProject(owner.id);
    setReasoningPathRequest({ projectId: owner.id, nodeId });
    setDecisionTarget(null);
    setActiveTab('scope');
  }, [handleSelectProject, projects]);

  const openAnsweredQuestion = useCallback((item: Project['history'][number], projectId: string) => {
    const requestedProjectId = item.projectId ?? projectId;
    const ownerByHistoryIdentity = projects.find((candidate) => candidate.history.some((historyItem) =>
      historyItem.timestamp === item.timestamp
      && historyItem.question === item.question
      && historyItem.answer === item.answer
    ));
    const ownerByNodeIdentity = item.nodeId
      ? projects.find((candidate) => candidate.nodes.some((node) => node.id === item.nodeId))
      : undefined;
    const owner = requestedProjectId === GENERAL_CONTEXT_ID
      ? generalContext
      : requestedProjectId === '__everything__'
        ? ownerByNodeIdentity ?? ownerByHistoryIdentity
        : projects.find((candidate) => candidate.id === requestedProjectId)
        ?? (project.id === requestedProjectId ? project : undefined);
    const node = owner?.nodes.find((candidate) => candidate.id === item.nodeId)
      ?? (!item.nodeId
        ? owner?.nodes.find((candidate) => candidate.text === item.question || item.question.includes(candidate.text))
        : undefined);
    if (
      !owner
      || typeof item.answer !== 'string'
      || !item.answer.trim()
      || (Boolean(item.nodeId) && !node)
    ) {
      setAnswerTarget(null);
      setAnswerTargetError('The saved response could not be loaded.');
      return;
    }
    setAnswerTargetError('');
    const questionContext = node ? {
      id: `question_${node.id}`,
      question: node.text,
      reason: node.why_it_matters?.[0] ?? 'This resolved item remains part of the current decision context.',
      provenance: node.source_refs.length ? `Sources: ${node.source_refs.join(', ')}` : `Graph node: ${node.id}`,
      sourceNodeIds: [node.id],
    } satisfies TodayQuestion : undefined;
    const decision = owner && node ? findDecisionForNode(owner, node.id) : null;
    const decisionWorkspace = owner && node ? buildDecisionWorkspace(owner, node.id) : null;
    setAnswerTarget({
      nodeId: item.nodeId ?? node?.id,
      question: item.question,
      initialAnswer: item.answer,
      historyTimestamp: item.timestamp,
      projectId: requestedProjectId,
      mode: 'edit',
      decisionNodeId: decision?.id,
      decisionTitle: decision?.text,
      decisionSupport: decisionWorkspace ? {
        options: decisionWorkspace.options.map((option) => ({ id: option.id, label: option.label, text: option.text, evidence: option.evidence.slice(0, 2).map((evidence) => ({ text: evidence.text, sourceNames: evidence.sourceNames })) })),
        currentPicture: decisionWorkspace.currentPicture,
        recommendation: decisionWorkspace.recommendation ? {
          optionId: decisionWorkspace.recommendation.option.id,
          label: decisionWorkspace.recommendation.option.label,
          explanation: decisionWorkspace.recommendation.explanation,
        } : null,
      } : undefined,
      explanation: owner && questionContext ? buildQuestionWhyExplanation(owner, questionContext) : undefined,
      ...(questionContext ? (() => {
        const localPresentation = localQuestionPresentation(questionContext);
        return {
          presentationTitle: questionContext.question,
          presentationSummary: localPresentation.summary,
        };
      })() : {}),
    });
  }, [generalContext, project, projects]);

  const openResolvedGap = useCallback((record: ResolvedGapRecord) => {
    const requestedProjectId = record.projectId;
    const owner = requestedProjectId === GENERAL_CONTEXT_ID
      ? generalContext
      : projects.find((candidate) => candidate.id === requestedProjectId)
        ?? (project.id === requestedProjectId ? project : undefined);
    const node = owner?.nodes.find((candidate) => candidate.id === record.nodeId);

    if (!owner || !node) {
      setAnswerTarget(null);
      setDecisionTarget(null);
      setAnswerTargetError('The recorded resolution is unavailable.');
      if (typeof window !== 'undefined') {
        console.warn('[Resolved gap] recorded resolution unavailable', {
          projectId: requestedProjectId,
          nodeId: record.nodeId,
          kind: record.kind,
        });
      }
      return;
    }

    setAnswerTargetError('');
    if (record.kind === 'decision') {
      setDecisionTarget({
        projectId: owner.id,
        nodeId: node.id,
        initialOutcome: record.resolution,
        historyTimestamp: record.timestamp,
      });
      return;
    }

    if (!record.resolution.trim()) {
      setAnswerTarget(null);
      setDecisionTarget(null);
      setAnswerTargetError('The recorded resolution is unavailable.');
      if (typeof window !== 'undefined') {
        console.warn('[Resolved gap] recorded resolution unavailable', {
          projectId: requestedProjectId,
          nodeId: record.nodeId,
          kind: record.kind,
        });
      }
      return;
    }

    openAnsweredQuestion({
      nodeId: node.id,
      projectId: owner.id,
      question: record.prompt,
      answer: record.resolution,
      timestamp: record.timestamp ?? node.updated_at,
      graph_diff_summary: '',
    }, owner.id);
  }, [generalContext, openAnsweredQuestion, project, projects]);

  const reopenAnsweredQuestion = useCallback(async (question: TodayQuestion) => {
    const owner = projects.find((candidate) => candidate.nodes.some((node) => question.sourceNodeIds.includes(node.id)))
      ?? (generalContext.nodes.some((node) => question.sourceNodeIds.includes(node.id)) ? generalContext : undefined);
    const graphQuestion = question.mode === 'edit'
      ? question.question
      : owner?.nodes.find((node) => question.sourceNodeIds.includes(node.id))?.text ?? question.question;
    const requestedProjectId = owner?.id
      ?? (question.projectId && question.projectId !== '__everything__' ? question.projectId : GENERAL_CONTEXT_ID);
    try {
      const response = await authFetch('/api/questions/answer', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reopen',
          userId,
          projectId: requestedProjectId,
          historyTimestamp: question.historyTimestamp,
          nodeId: question.sourceNodeIds.find((id) => !id.startsWith('gcal_')),
          question: graphQuestion,
          previousAnswer: question.initialAnswer ?? '',
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'The response could not be cancelled.');
      const updated = body.context as Project;
      if (body.ownerType === 'global' || updated.id === GENERAL_CONTEXT_ID) {
        setGeneralContext(updated);
        await persistGeneralContextToAPI(userId, updated);
      } else {
        updateProject(updated);
      }
      setStorageMessage('');
    } catch (error) {
      setStorageMessage(error instanceof Error ? error.message : 'The response could not be cancelled.');
    }
  }, [generalContext, projects, updateProject, userId]);

  const openChatWithPrompt = useCallback(async (prompt: string, target: AskTarget, ownerProjectId: string): Promise<boolean> => {
    setAnswerTarget(null);
    setAskInitialPrompt('');
    const isGeneralContext = ownerProjectId === GENERAL_CONTEXT_ID;
    const handoff: PendingAskHandoff = {
      id: `help_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      scopeType: isGeneralContext ? 'general' : 'project',
      ...(!isGeneralContext ? { projectId: ownerProjectId } : {}),
      prompt,
      target,
    };
    setAskNewChatPrompt(handoff);
    const selection = isGeneralContext
      ? { success: Boolean(scope) }
      : await handleSelectProject(ownerProjectId);
    if (!selection.success) {
      setAskNewChatPrompt(null);
      return false;
    }
    setActiveTab('ask');
    return true;
  }, [handleSelectProject, scope]);

  const openDontKnowHelp = useCallback(() => {
    if (!idontKnowGap) return;
    const owner = idontKnowProjectId === GENERAL_CONTEXT_ID
      ? generalContext
      : projects.find((candidate) => candidate.id === idontKnowProjectId) ?? project;
    const node = owner.nodes.find((candidate) => candidate.id === idontKnowGap.node_id);
    const isDecision = node?.type === 'DECISION';
    const prompt = isDecision
      ? `Help me think through this project decision: “${idontKnowGap.question}” Use the project context and relevant sources, explain the tradeoffs clearly, identify what information is missing, and suggest one practical next step without making the decision for me.`
      : `Help me figure out this unresolved question: “${idontKnowGap.question}” Use the project context and relevant sources, explain the tradeoff clearly, and suggest one practical next step without answering on my behalf.`;
    const target: AskTarget = { type: isDecision ? 'decision' : 'question', id: idontKnowGap.node_id, text: idontKnowGap.question };
    setIdontKnowGap(null);
    setIdontKnowProjectId(null);
    void openChatWithPrompt(prompt, target, idontKnowProjectId ?? GENERAL_CONTEXT_ID);
  }, [generalContext, idontKnowGap, idontKnowProjectId, openChatWithPrompt, project, projects]);

  const submitQuestionAnswer = useCallback(async (answer: string, validation?: ResolutionValidationSubmission) => {
    if (!answerTarget) return;
    const isEditing = answerTarget.mode === 'edit';
    const isCareerConflictQuestion = answerTarget.nodeId === CAREER_CONFLICT_QUESTION_ID;
    const response = await authFetch('/api/questions/answer', {
      method: isEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEditing ? {
        userId,
        projectId: answerTarget.projectId,
        historyTimestamp: answerTarget.historyTimestamp,
        nodeId: answerTarget.nodeId,
        question: answerTarget.question,
        previousAnswer: answerTarget.initialAnswer,
        answer,
        ...(validation?.validationOverride ? { validationOverride: true } : {}),
        ...(validation?.validationFingerprint ? { validationFingerprint: validation.validationFingerprint } : {}),
      } : {
        userId,
        nodeId: answerTarget.nodeId,
        answer,
        ...(isCareerConflictQuestion
          ? {
              feedback: {
                id: `career_demo_feedback_${CAREER_CONFLICT_QUESTION_ID}`,
                rating: 'helpful' as const,
                answer,
              },
            }
          : {}),
        ...(answerTarget.projectId ? { projectId: answerTarget.projectId } : {}),
        ...(validation?.validationOverride ? { validationOverride: true } : {}),
        ...(validation?.validationFingerprint ? { validationFingerprint: validation.validationFingerprint } : {}),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'The answer could not be saved.');
    const updated = body.context as Project;
    if (body.ownerType === 'project') {
      setProjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      setProject((current) => current.id === updated.id ? updated : current);
    } else {
      setGeneralContext(updated);
    }
    if (isCareerConflictQuestion) {
      const disposition = careerRoleDisposition(answer);
      const feedbackEvent = createFeedbackEvent({
        userId,
        targetType: 'question',
        targetId: CAREER_CONFLICT_QUESTION_ID,
        rating: 'useful',
        explanation: answer,
        metadata: {
          demo: 'career-conflict',
          role_acceptable: disposition === 'acceptable',
        },
      });
      setFeedbackEvents((current) => appendFeedbackEvent(userId, current, feedbackEvent));
      const updatedMemories = updateCareerConflictMemories(memories, answer);
      setMemories(updatedMemories);
      persistMemorySettingsToAPI(userId, profile, updatedMemories).then((savedToApi) => {
        setStorageMessage(savedToApi ? '' : 'Memory settings could not be saved; your current view is unchanged.');
      });
    }
  }, [answerTarget, memories, profile, userId]);

  const handleUpdateProfile = async (updated: UserMemoryProfile): Promise<boolean> => {
    const savedToApi = await persistMemorySettingsToAPI(userId, updated, memories);
    setStorageMessage(savedToApi ? '' : 'Memory settings could not be saved; no changes were applied.');
    if (savedToApi) setProfile(updated);
    return savedToApi;
  };

  const handleUpdateMemories = async (updated: DurableMemory[]): Promise<boolean> => {
    const savedToApi = await persistMemorySettingsToAPI(userId, profile, updated);
    setStorageMessage(savedToApi ? '' : 'Memory settings could not be saved; no changes were applied.');
    if (savedToApi) setMemories(updated);
    return savedToApi;
  };

  const handleFeedbackEvent = (event: FeedbackEvent) => {
    setFeedbackEvents((current) => appendFeedbackEvent(userId, current, event));
  };

  const answerNode = useMemo(() => {
    if (!answerTarget?.nodeId) return undefined;
    return [...projects.flatMap((item) => item.nodes), ...generalContext.nodes]
      .find((item) => item.id === answerTarget.nodeId);
  }, [answerTarget?.nodeId, generalContext.nodes, projects]);
  const canUseDontKnow = Boolean(
    answerTarget &&
    answerTarget.mode !== 'edit' &&
    answerNode &&
    answerNode.status === 'OPEN' &&
    (answerNode.type === 'UNKNOWN' || answerNode.type === 'ASSUMPTION'),
  );
  const handleDontKnow = useCallback(() => {
    if (!answerTarget || !answerNode || !canUseDontKnow) return;
    const owner = projects.find((candidate) => candidate.nodes.some((node) => node.id === answerNode.id))
      ?? (generalContext.nodes.some((node) => node.id === answerNode.id) ? generalContext : undefined)
      ?? project;
    setIdontKnowProjectId(owner.id);
    setIdontKnowGap(calculateGapPriority(answerNode, owner, profile));
    setAnswerTarget(null);
  }, [answerNode, answerTarget, canUseDontKnow, generalContext, profile, project, projects]);

  if (!auth.isReady) {
    return <WorkspaceLoadingState />;
  }

  if (!auth.userId) {
    return <LoginScreen error={auth.error} />;
  }

  if (isLoading) {
    return <WorkspaceLoadingState />;
  }

  // Keep the localhost developer menu available after a cleanup leaves the
  // account empty. Non-local users retain the dedicated onboarding surface.
  if (!scope || !projects.some((item) => item.status !== 'archived')) {
    if (isLoadingSoftwareReleaseDemo) {
      return <DemoLoadingState label="RelayDesk software release demo" />;
    }

    return (
      <>
        <NewUserOnboarding
          isLoadingDemo={isLoadingQuickDemo || isLoadingSoftwareReleaseDemo}
          error={storageMessage}
          isPublicDemo={isPublicDemo}
          onCreateProject={() => setIsNewProjectOpen(true)}
          onLoadDemo={() => void handleCreateQuickDemo()}
          onLoadSoftwareDemo={auth.accessTier === 'owner' || isLocalhostDeveloper ? () => void handleCreateSoftwareReleaseDemo() : undefined}
        />
        {isNewProjectOpen && !isPublicDemo && (
          <NewProjectModal
            onCreateProject={async (input) => {
              await handleCreateProject(input);
            }}
            onClose={() => setIsNewProjectOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header
        projects={projects}
        scope={scope}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onResetDemo={handleResetDemo}
        onCreateQuickDemo={handleCreateQuickDemo}
        isLoadingQuickDemo={isLoadingQuickDemo}
        onCreateHarborHistoryDemo={isLocalhostDeveloper ? handleCreateHarborHistoryDemo : undefined}
        isLoadingHarborHistoryDemo={isLoadingHarborHistoryDemo}
        onCreateRiversideHistoryDemo={isLocalhostDeveloper ? handleCreateRiversideHistoryDemo : undefined}
        isLoadingRiversideHistoryDemo={isLoadingRiversideHistoryDemo}
        onCreateSoftwareReleaseDemo={auth.accessTier === 'owner' || isLocalhostDeveloper ? () => void handleCreateSoftwareReleaseDemo() : undefined}
        isLoadingSoftwareReleaseDemo={isLoadingSoftwareReleaseDemo}
        onCleanupLocalData={isLocalhostDeveloper ? handleOpenCleanupLocalData : undefined}
        isCleaningUpLocalData={isCleaningUpLocalData}
        onSelectProject={handleSelectProject}
        onOpenNewProject={() => setIsNewProjectOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isSettingsOpen={isSettingsOpen}
        accountLabel={auth.user?.displayName}
        demoMode={demoMode}
        accessTier={auth.accessTier}
      />

      <main className="pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom))] md:pb-16">
        {loadingDemoLabel ? (
          <DemoLoadingState label={loadingDemoLabel} />
        ) : <>
        {storageMessage && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
            <div className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-xs text-amber-200">
              {storageMessage}
            </div>
          </div>
        )}
        {answerTargetError && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
            <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
              {answerTargetError}
            </div>
          </div>
        )}
        {activeTab === 'today' && (
          <Today
            userId={userId}
            project={scopedProject}
            projectRefreshVersion={projectRefreshVersion}
            scope={scope}
            profile={profile}
            memories={memories}
            feedbackEvents={feedbackEvents}
            onUpdateMemories={handleUpdateMemories}
            onFeedbackEvent={handleFeedbackEvent}
            onUpdateProfile={handleUpdateProfile}
            onAnswerQuestion={(question) => {
              if (question.mode === 'edit' && question.historyTimestamp) {
                const owningProjectId = projects.find((candidate) => candidate.nodes.some((node) => question.sourceNodeIds.includes(node.id)))?.id
                  ?? question.projectId
                  ?? project.id;
                openAnsweredQuestion({
                  nodeId: question.sourceNodeIds.find((id) => !id.startsWith('gcal_')),
                  projectId: question.projectId,
                  question: question.question,
                  answer: question.initialAnswer ?? '',
                  timestamp: question.historyTimestamp,
                  graph_diff_summary: '',
                }, owningProjectId);
                return;
              }
              const nodeId = question.sourceNodeIds.find((id) => !id.startsWith('gcal_'));
              const node = nodeId
                ? [...projects.flatMap((item) => item.nodes), ...generalContext.nodes].find((item) => item.id === nodeId)
                : undefined;
              if (node) {
                openGraphQuestion(node, undefined, question.answerSuggestion, {
                  presentationSummary: question.presentationSummary,
                });
              }
              else setActiveTab('ask');
            }}
            onViewResolvedGaps={openResolvedGaps}
            onReviewDecision={openDecisionWorkspace}
            readOnly={isPublicDemo}
            onNavigateToSource={(sourceId) => {
              openContext({ sourceId, tab: 'recent' });
            }}
            onViewReasoningPath={(nodeId) => {
              const owner = projects.find((candidate) => candidate.nodes.some((node) => node.id === nodeId));
              if (!owner) return;
              handleSelectProject(owner.id);
              setReasoningPathRequest({ projectId: owner.id, nodeId });
              setActiveTab('scope');
            }}
          />
        )}
        {activeTab === 'ask' && (
          <AskGapswise
            key={`${scope.projectId}-${projectFocusKey}`}
            userId={userId}
            scope={scope}
            scopeLabel={projectTitlePresentation(project.title).title}
            profile={profile}
            initialPrompt={askInitialPrompt}
            autoSendInitialPrompt
            onInitialPromptSent={() => setAskInitialPrompt('')}
            newChatPrompt={askNewChatPrompt}
            onNewChatPromptOpened={() => setAskNewChatPrompt(null)}
            onProjectContextChanged={isPublicDemo ? undefined : refreshProjectData}
            onProjectUpdated={isPublicDemo ? undefined : refreshProjectData}
            accessTier={auth.accessTier}
            publicDemoMessagesRemaining={auth.publicDemoMessagesRemaining}
          />
        )}
        {activeTab === 'scope' && (
          <ScopeDestination
            userId={userId}
            project={project}
            generalContext={generalContext}
            projects={projects}
            scope={scope}
            projectFocusKey={projectFocusKey}
            projectRefreshVersion={projectRefreshVersion}
            profile={profile}
            memories={memories}
            contextEntry={contextEntry ?? undefined}
            onSelectProject={handleSelectProject}
            onOpenNewProject={() => setIsNewProjectOpen(true)}
            onUpdateProject={updateProject}
            onUpdateGeneralContext={async (updated) => {
              const savedToApi = await persistGeneralContextToAPI(userId, updated);
              setStorageMessage(savedToApi ? '' : 'General context could not be saved to persistent storage.');
              if (savedToApi) setGeneralContext(updated);
              return savedToApi;
            }}
            onAnswerQuestion={openGraphQuestion}
            onReviewDecision={openDecisionWorkspace}
            onEditAnsweredQuestion={openAnsweredQuestion}
            onOpenResolvedGap={openResolvedGap}
            onNavigateToSource={(sourceId) => {
              openContext({ sourceId, tab: 'recent' });
            }}
            onViewToday={() => setActiveTab('today')}
            onProjectBranched={handleProjectBranched}
            onNoActiveWorkspace={handleNoActiveWorkspace}
            readOnly={isPublicDemo}
            gapsNavigationRequest={gapsNavigationRequest}
            onGapsNavigationHandled={() => setGapsNavigationRequest(null)}
            reasoningPathNodeId={reasoningPathRequest?.projectId === project.id ? reasoningPathRequest.nodeId : null}
          />
        )}
        </>}
      </main>

      {isSettingsOpen && (
        <SettingsDrawer
          onClose={() => setIsSettingsOpen(false)}
            userId={userId}
            accountLabel={auth.user?.displayName}
            scope={scope}
            project={project}
            generalContext={generalContext}
            profile={profile}
            memories={memories}
            onUpdateProject={updateProject}
            onUpdateGeneralContext={async (updated) => {
              const savedToApi = await persistGeneralContextToAPI(userId, updated);
              setStorageMessage(savedToApi ? '' : 'General context could not be saved to persistent storage.');
              if (savedToApi) setGeneralContext(updated);
              return savedToApi;
            }}
            onUpdateProfile={handleUpdateProfile}
            onUpdateMemories={handleUpdateMemories}
            onSignOut={() => { void auth.signOut(); }}
        />
      )}

      {idontKnowGap && (
        <IdontKnowModal
          gap={idontKnowGap}
          onHelp={openDontKnowHelp}
          onDecideLater={handleDecideLater}
          onClose={() => {
            setIdontKnowGap(null);
            setIdontKnowProjectId(null);
          }}
        />
      )}
      {answerTarget && (
        <AnswerQuestionModal
          target={answerTarget}
          userId={userId}
          onSubmit={submitQuestionAnswer}
          onDontKnow={canUseDontKnow ? handleDontKnow : undefined}
          onNavigateToSource={(sourceId) => {
            setAnswerTarget(null);
            openContext({ sourceId, tab: 'recent' });
          }}
          onViewDecisionMap={(nodeId) => {
            setAnswerTarget(null);
            viewDecisionGraph(nodeId);
          }}
          onClose={() => {
            setAnswerTarget(null);
            setAnswerTargetError('');
          }}
        />
      )}
      {decisionTarget && decisionProject && (
        <DecisionWorkspace
          project={decisionProject}
          userId={userId}
          targetNodeId={decisionTarget.nodeId}
          initialOutcome={decisionTarget.initialOutcome}
          historyTimestamp={decisionTarget.historyTimestamp}
          onClose={() => setDecisionTarget(null)}
          onConfirm={saveDecision}
          onStartChat={(prompt, target) => {
            void openChatWithPrompt(prompt, target, decisionProject.id).then((opened) => {
              if (opened) setDecisionTarget(null);
            });
          }}
          onNavigateToSource={(sourceId) => {
            openContext({ sourceId, tab: 'recent' });
            setDecisionTarget(null);
          }}
          onViewGraph={viewDecisionGraph}
          onDontKnow={handleDecisionDontKnow}
        />
      )}
      {isLocalhostDeveloper && <TracePanel userId={userId} />}
      {isNewProjectOpen && (
        <NewProjectModal
          onCreateProject={async (input) => {
            await handleCreateProject(input);
          }}
          onClose={() => setIsNewProjectOpen(false)}
        />
      )}
      {isCleanupLocalDataOpen && (
        <CleanupLocalUserDataModal
          preview={cleanupPreview}
          previewError={cleanupError}
          isLoadingPreview={isLoadingCleanupPreview}
          isRunning={isCleaningUpLocalData}
          error={cleanupError}
          onConfirm={() => { void handleCleanupLocalData(); }}
          onClose={() => {
            if (!isCleaningUpLocalData) setIsCleanupLocalDataOpen(false);
          }}
        />
      )}
    </div>
  );
}
