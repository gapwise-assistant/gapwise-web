'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from '@/components/Header';
import { NewProjectModal } from '@/components/NewProjectModal';
import { Today } from '@/components/Today';
import { AskGapswise } from '@/components/AskGapswise';
import { ContextInbox } from '@/components/ContextInbox';
import { ScopeDestination } from '@/components/YouDestination';
import { SettingsDestination } from '@/components/SettingsDestination';
import { IdontKnowModal } from '@/components/IdontKnowModal';
import { AnswerQuestionModal, AnswerQuestionTarget } from '@/components/AnswerQuestionModal';
import { TracePanel } from '@/components/dev/TracePanel';
import { Project, UserMemoryProfile, CandidateGap } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { AskSource } from '@/lib/ask/adkClient';
import { FeedbackEvent } from '@/types/feedback';
import { DEMO_USER_ID, GOLDEN_DEMO_PROJECT, DEFAULT_USER_PROFILE } from '@/lib/store';
import { processIdontKnowStrategy } from '@/lib/gemini';
import { loadMemoriesFromBrowser, memoriesFromProfile, saveMemoriesToBrowser } from '@/lib/memory/store';
import { appendFeedbackEvent, loadFeedbackEvents, saveFeedbackEvents } from '@/lib/personalization/feedbackStore';
import type { CreateProjectInput } from '@/lib/projects/createProject';
import { AppScope, EVERYTHING_SCOPE } from '@/types/scope';
import { emptyGeneralContext, GENERAL_CONTEXT_ID, projectForScope, resolveScope } from '@/lib/scope/projectScope';
import { authFetch } from '@/lib/auth/client';
import { useAuth } from '@/components/AuthProvider';
import { LoginScreen } from '@/components/LoginScreen';
import { NewUserOnboarding } from '@/components/NewUserOnboarding';
import { DecisionWorkspace } from '@/components/DecisionWorkspace';
import { AppDestination } from '@/lib/navigation';

type AppTab = AppDestination;

async function loadProjectsFromAPI(userId: string): Promise<{ projects: Project[]; activeProjectId: string | null; scope: AppScope }> {
  const res = await authFetch(`/api/projects?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error('Projects API is not available');
  const data = await res.json();
  return {
    projects: data.projects as Project[],
    activeProjectId: typeof data.activeProjectId === 'string' ? data.activeProjectId : null,
    scope: data.scope as AppScope ?? EVERYTHING_SCOPE,
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
    // Fallback: persist to localStorage only
    const existing = localStorage.getItem(`gapwise_state_${userId}`);
    let state: any = existing ? JSON.parse(existing) : {};
    state.contexts = [{ id: project.id, userId, title: project.title, goal: project.goal,
      clarity_score: project.clarity_score, createdAt: project.created_at, updatedAt: new Date().toISOString(), status: project.status === 'archived' ? 'ARCHIVED' : 'ACTIVE' }];
    state.nodes = project.nodes.map(n => ({ ...n, userId, createdBy: n.created_by, importance: n.impact, sourceIds: n.source_refs, createdAt: n.created_at, updatedAt: n.updated_at }));
    state.edges = project.edges.map(e => ({ ...e, userId, status: 'ACTIVE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    state.sources = project.sources.map(s => ({ ...s, userId, status: 'ACTIVE', createdAt: s.extracted_at, updatedAt: s.extracted_at }));
    state.conversations = project.history.map(h => ({ question: h.question, answer: h.answer, graph_diff_summary: h.graph_diff_summary, userId, createdAt: h.timestamp, updatedAt: h.timestamp, status: 'COMPLETED', id: `conv_${Math.random()}` }));
    localStorage.setItem(`gapwise_state_${userId}`, JSON.stringify(state));
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
    throw new Error(body.error ?? 'Project creation failed.');
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

async function persistScopeToAPI(userId: string, scope: AppScope): Promise<boolean> {
  try {
    const res = await authFetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, scope }),
    });
    if (!res.ok) throw new Error('Scope write failed');
    return true;
  } catch {
    localStorage.setItem(`gapwise_scope_${userId}`, JSON.stringify(scope));
    return false;
  }
}

async function loadMemoriesFromAPI(userId: string, profile: UserMemoryProfile): Promise<DurableMemory[]> {
  try {
    const res = await authFetch(`/api/memory?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error('Durable memory API is not available');
    const data = await res.json();
    return data.memories as DurableMemory[];
  } catch {
    return loadMemoriesFromBrowser(userId, profile);
  }
}

async function persistMemoriesToAPI(userId: string, memories: DurableMemory[]): Promise<boolean> {
  try {
    const res = await authFetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, memories }),
    });
    if (!res.ok) throw new Error('Durable memory API write failed');
    return true;
  } catch {
    saveMemoriesToBrowser(userId, memories);
    return false;
  }
}

function loadProfileFromLocalStorage(userId: string): UserMemoryProfile {
  if (typeof window === 'undefined') return DEFAULT_USER_PROFILE;
  const stored = localStorage.getItem(`gapwise_profile_${userId}`);
  if (!stored) return DEFAULT_USER_PROFILE;
  try {
    return { ...DEFAULT_USER_PROFILE, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

function persistProfileToLocalStorage(userId: string, profile: UserMemoryProfile): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`gapwise_profile_${userId}`, JSON.stringify(profile));
}

export default function Home() {
  const auth = useAuth();
  const userId = auth.userId ?? DEMO_USER_ID;
  const [project, setProject] = useState<Project>(() => emptyGeneralContext());
  const [projects, setProjects] = useState<Project[]>([]);
  const [scope, setScope] = useState<AppScope>(EVERYTHING_SCOPE);
  const [generalContext, setGeneralContext] = useState<Project>(() => emptyGeneralContext());
  const [profile, setProfile] = useState<UserMemoryProfile>(DEFAULT_USER_PROFILE);
  const [memories, setMemories] = useState<DurableMemory[]>([]);
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEvent[]>([]);
  const [activeTab, setActiveTab] = useState<AppTab>('today');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isLoadingDemo, setIsLoadingDemo] = useState(false);
  const [demoLoadError, setDemoLoadError] = useState('');
  const [projectFocusKey, setProjectFocusKey] = useState(0);
  const [idontKnowGap, setIdontKnowGap] = useState<CandidateGap | null>(null);
  const [answerTarget, setAnswerTarget] = useState<AnswerQuestionTarget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [storageMessage, setStorageMessage] = useState('');
  const [contextEntry, setContextEntry] = useState<{ sourceId?: string; tab: 'recent' | 'documents' | 'add' } | null>(null);
  const [reasoningPathRequest, setReasoningPathRequest] = useState<{ projectId: string; nodeId: string } | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{ projectId: string; nodeId: string } | null>(null);
  const demoMode = auth.demoMode;

  // Load project from persistent storage on mount and user switch
  useEffect(() => {
    if (!auth.isReady || !auth.userId) return;
    setIsLoading(true);
    setStorageMessage('');
    const loadedProfile = loadProfileFromLocalStorage(userId);
    setProfile(loadedProfile);
    setFeedbackEvents(loadFeedbackEvents(userId));
    loadMemoriesFromAPI(userId, loadedProfile).then(setMemories);
    Promise.all([loadProjectsFromAPI(userId), loadGeneralContextFromAPI(userId)]).then(([loaded, loadedGeneralContext]) => {
      const nextProjects = loaded.projects;
      const nextScope = resolveScope(loaded.scope, nextProjects);
      const selectedProject =
        (nextScope.type === 'project' ? nextProjects.find((item) => item.id === nextScope.projectId) : undefined) ??
        nextProjects.find((item) => item.id === loaded.activeProjectId) ??
        nextProjects.find((item) => item.status !== 'archived') ??
        nextProjects[0] ??
        loadedGeneralContext;
      setProjects(nextProjects);
      setProject(selectedProject);
      setScope(nextScope);
      setGeneralContext(loadedGeneralContext);
      setIsLoading(false);
    }).catch(() => {
      setProjects([]);
      setProject(emptyGeneralContext());
      setScope(EVERYTHING_SCOPE);
      setGeneralContext(emptyGeneralContext());
      setStorageMessage('Projects could not be loaded from persistent storage.');
      setIsLoading(false);
    });
  }, [auth.isReady, auth.userId]);

  const scopedProject = useMemo(
    () => projectForScope(scope, projects, generalContext),
    [scope, projects, generalContext]
  );

  // Auto-persist whenever project changes
  const updateProject = useCallback((updated: Project) => {
    setProject((current) => (current.id === updated.id ? updated : current));
    setProjects((current) => {
      const existingIndex = current.findIndex((item) => item.id === updated.id);
      if (existingIndex < 0) return [updated, ...current];
      return current.map((item) => (item.id === updated.id ? updated : item));
    });
    persistProjectToAPI(userId, updated).then((savedToApi) => {
      setStorageMessage(savedToApi ? '' : 'Saved locally. Persistent storage API was unavailable.');
    });
  }, [userId]);

  const handleSelectProject = useCallback((projectId: string) => {
    const selected = projects.find((item) => item.id === projectId);
    if (selected) {
      setProject(selected);
      const nextScope: AppScope = { type: 'project', projectId: selected.id };
      setScope(nextScope);
      persistScopeToAPI(userId, nextScope).then((savedToApi) => {
        setStorageMessage(savedToApi ? '' : 'Scope saved locally. Persistent storage API was unavailable.');
      });
    }
  }, [projects, userId]);

  const handleSelectEverything = useCallback(() => {
    setScope(EVERYTHING_SCOPE);
    persistScopeToAPI(userId, EVERYTHING_SCOPE).then((savedToApi) => {
      setStorageMessage(savedToApi ? '' : 'Scope saved locally. Persistent storage API was unavailable.');
    });
  }, [userId]);

  const handleCreateProject = useCallback(async (input: CreateProjectInput) => {
    const result = await createProjectViaAPI(userId, input);
    setProjects(result.projects);
    setProject(result.project);
    setScope({ type: 'project', projectId: result.project.id });
    if (typeof window !== 'undefined') {
      localStorage.setItem(`gapwise_active_project_${userId}`, result.project.id);
      localStorage.setItem(`gapwise_scope_${userId}`, JSON.stringify({ type: 'project', projectId: result.project.id }));
    }
    setIsNewProjectOpen(false);
    setActiveTab('scope');
    setProjectFocusKey((current) => current + 1);
    setStorageMessage('');
    return result.project;
  }, [userId]);

  const handleLoadDemo = useCallback(async () => {
    setIsLoadingDemo(true);
    setDemoLoadError('');
    try {
      const result = await loadGoldenDemoViaAPI(userId);
      setProjects(result.projects);
      setProject(result.project);
      setScope(result.scope);
      setProjectFocusKey((current) => current + 1);
      setActiveTab('today');
    } catch (caught) {
      setDemoLoadError(caught instanceof Error ? caught.message : 'The demo could not be loaded.');
    } finally {
      setIsLoadingDemo(false);
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
    // Always clear localStorage too
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`gapwise_state_${userId}`);
      localStorage.setItem(`gapwise_active_project_${userId}`, GOLDEN_DEMO_PROJECT.id);
      localStorage.setItem(`gapwise_scope_${userId}`, JSON.stringify(EVERYTHING_SCOPE));
    }
    const fresh = JSON.parse(JSON.stringify(GOLDEN_DEMO_PROJECT));
    const seedMemories = memoriesFromProfile(DEFAULT_USER_PROFILE);
    setProject(fresh);
    setProjects([fresh]);
    setScope(EVERYTHING_SCOPE);
    setGeneralContext(emptyGeneralContext());
    setProfile(DEFAULT_USER_PROFILE);
    setMemories(seedMemories);
    setFeedbackEvents([]);
    persistProfileToLocalStorage(userId, DEFAULT_USER_PROFILE);
    await persistMemoriesToAPI(userId, seedMemories);
    saveFeedbackEvents(userId, []);
    setActiveTab('today');
  };

  const handleSelectStrategy = async (strategy: 'rag' | 'experiment' | 'assumption' | 'defer') => {
    if (!idontKnowGap) return;
    const { updatedProject } = await processIdontKnowStrategy(project, strategy, profile);
    updateProject(updatedProject);
    setIdontKnowGap(null);
  };

  const openGraphQuestion = useCallback((node: Project['nodes'][number]) => {
    const owner = projects.find((candidate) => candidate.nodes.some((item) => item.id === node.id));
    setAnswerTarget({
      nodeId: node.id,
      question: node.text,
      reason: node.why_it_matters?.[0],
      projectId: owner?.id,
    });
  }, [projects]);

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

  const saveDecision = useCallback((updated: Project) => {
    if (updated.id === GENERAL_CONTEXT_ID) {
      setGeneralContext(updated);
      persistGeneralContextToAPI(userId, updated).then((savedToApi) => {
        setStorageMessage(savedToApi ? '' : 'Decision saved locally. General context API was unavailable.');
      });
      return;
    }
    updateProject(updated);
  }, [updateProject, userId]);

  const viewDecisionGraph = useCallback((nodeId: string) => {
    const owner = projects.find((candidate) => candidate.nodes.some((node) => node.id === nodeId));
    if (!owner) return;
    handleSelectProject(owner.id);
    setReasoningPathRequest({ projectId: owner.id, nodeId });
    setDecisionTarget(null);
    setActiveTab('scope');
  }, [handleSelectProject, projects]);

  const openAnsweredQuestion = useCallback((item: Project['history'][number], projectId: string) => {
    setAnswerTarget({
      question: item.question,
      initialAnswer: item.answer,
      historyTimestamp: item.timestamp,
      projectId,
      mode: 'edit',
    });
  }, []);

  const submitQuestionAnswer = useCallback(async (answer: string) => {
    if (!answerTarget) return;
    const isEditing = answerTarget.mode === 'edit';
    const response = await authFetch('/api/questions/answer', {
      method: isEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEditing ? {
        userId,
        projectId: answerTarget.projectId,
        historyTimestamp: answerTarget.historyTimestamp,
        question: answerTarget.question,
        previousAnswer: answerTarget.initialAnswer,
        answer,
      } : {
        userId,
        nodeId: answerTarget.nodeId,
        answer,
        ...(answerTarget.projectId ? { projectId: answerTarget.projectId } : {}),
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
  }, [answerTarget, userId]);

  const handleUpdateProfile = (updated: UserMemoryProfile) => {
    setProfile(updated);
    persistProfileToLocalStorage(userId, updated);
  };

  const handleUpdateMemories = (updated: DurableMemory[]) => {
    setMemories(updated);
    persistMemoriesToAPI(userId, updated).then((savedToApi) => {
      setStorageMessage(savedToApi ? '' : 'Saved memory locally. Persistent memory API was unavailable.');
    });
  };

  const handleFeedbackEvent = (event: FeedbackEvent) => {
    setFeedbackEvents((current) => appendFeedbackEvent(userId, current, event));
  };

  if (!auth.isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Loading Gapswise...
      </div>
    );
  }

  if (!auth.userId) {
    return <LoginScreen error={auth.error} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center animate-pulse">
            <span className="text-white font-bold text-lg">G</span>
          </div>
          <p className="text-slate-400 text-sm">Loading persistent project state...</p>
        </div>
      </div>
    );
  }

  if (!demoMode && projects.length === 0) {
    return (
      <>
        <NewUserOnboarding
          accountLabel={auth.user?.displayName}
          isLoadingDemo={isLoadingDemo}
          error={demoLoadError}
          onCreateProject={() => {
            setDemoLoadError('');
            setIsNewProjectOpen(true);
          }}
          onLoadDemo={() => void handleLoadDemo()}
          onSignOut={() => { void auth.signOut(); }}
        />
        {isNewProjectOpen && (
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
        onSelectProject={handleSelectProject}
        onSelectEverything={handleSelectEverything}
        onOpenNewProject={() => setIsNewProjectOpen(true)}
        onOpenSettings={() => setActiveTab('settings')}
        accountLabel={auth.user?.displayName}
        demoMode={demoMode}
      />

      <main className="pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom))] md:pb-16">
        {storageMessage && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
            <div className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-xs text-amber-200">
              {storageMessage}
            </div>
          </div>
        )}
        {activeTab === 'today' && (
          <Today
            userId={userId}
            project={scopedProject}
            scope={scope}
            profile={profile}
            memories={memories}
            feedbackEvents={feedbackEvents}
            onUpdateMemories={handleUpdateMemories}
            onFeedbackEvent={handleFeedbackEvent}
            onUpdateProfile={handleUpdateProfile}
            onAnswerQuestion={(question) => {
              const nodeId = question.sourceNodeIds.find((id) => !id.startsWith('gcal_'));
              const node = nodeId
                ? [...projects.flatMap((item) => item.nodes), ...generalContext.nodes].find((item) => item.id === nodeId)
                : undefined;
              if (node) openGraphQuestion(node);
              else setActiveTab('ask');
            }}
            onReviewDecision={openDecisionWorkspace}
            onNavigateToSource={(sourceId) => {
              setContextEntry({ sourceId, tab: 'recent' });
              setActiveTab('context');
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
            userId={userId}
            scope={scope}
            scopeLabel={scope.type === 'project' ? project.title : 'Everything'}
            onViewSource={(source: AskSource) => {
              if (source.kind === 'source') {
                setContextEntry({ sourceId: source.id, tab: 'recent' });
                setActiveTab('context');
                return;
              }
              if (source.kind === 'calendar') {
                setActiveTab('settings');
                return;
              }
              setActiveTab('scope');
            }}
          />
        )}
        {activeTab === 'context' && (
          <ContextInbox
            project={project}
            projects={projects}
            scope={scope}
            generalContext={generalContext}
            profile={profile}
            userId={userId}
            focusedSourceId={contextEntry?.sourceId}
            entryTab={contextEntry?.tab}
            onUpdateProject={updateProject}
            onUpdateGeneralContext={(updated) => {
              setGeneralContext(updated);
              persistGeneralContextToAPI(userId, updated).then((savedToApi) => {
                setStorageMessage(savedToApi ? '' : 'General context could not be saved to persistent storage.');
              });
            }}
          />
        )}
        {activeTab === 'scope' && (
          <ScopeDestination
            userId={userId}
            project={project}
            worldProject={scopedProject}
            projects={projects}
            scope={scope}
            projectFocusKey={projectFocusKey}
            memories={memories}
            onSelectProject={handleSelectProject}
            onOpenNewProject={() => setIsNewProjectOpen(true)}
            onUpdateProject={updateProject}
            onAnswerQuestion={openGraphQuestion}
            onReviewDecision={openDecisionWorkspace}
            onEditAnsweredQuestion={openAnsweredQuestion}
            onNavigateToContext={() => setActiveTab('context')}
            onNavigateToSource={(sourceId) => {
              setContextEntry({ sourceId, tab: 'recent' });
              setActiveTab('context');
            }}
            reasoningPathNodeId={reasoningPathRequest?.projectId === project.id ? reasoningPathRequest.nodeId : null}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsDestination
            userId={userId}
            accountLabel={auth.user?.displayName}
            scope={scope}
            project={project}
            generalContext={generalContext}
            profile={profile}
            memories={memories}
            onUpdateProject={updateProject}
            onUpdateGeneralContext={(updated) => {
              setGeneralContext(updated);
              persistGeneralContextToAPI(userId, updated).then((savedToApi) => {
                setStorageMessage(savedToApi ? '' : 'General context could not be saved to persistent storage.');
              });
            }}
            onUpdateProfile={handleUpdateProfile}
            onUpdateMemories={handleUpdateMemories}
            onSignOut={() => { void auth.signOut(); }}
          />
        )}
      </main>

      {idontKnowGap && (
        <IdontKnowModal
          gap={idontKnowGap}
          onSelectStrategy={handleSelectStrategy}
          onClose={() => setIdontKnowGap(null)}
        />
      )}
      {answerTarget && (
        <AnswerQuestionModal
          target={answerTarget}
          onSubmit={submitQuestionAnswer}
          onDontKnow={project.id === answerTarget.projectId && project.active_question?.node_id === answerTarget.nodeId ? () => {
            const node = [...projects.flatMap((item) => item.nodes), ...generalContext.nodes]
              .find((item) => item.id === answerTarget.nodeId);
            if (node) {
              setIdontKnowGap({
                node_id: node.id,
                question: node.text,
                uncertainty: 1 - node.confidence,
                downstream_impact: node.impact,
                dependency_count: 0,
                urgency: node.priority ?? node.impact,
                answerability: 0.75,
                user_relevance: node.impact,
                interruption_cost: 0.35,
                priority: node.priority ?? node.impact,
                reasons: node.why_it_matters ?? ['This is still unresolved in your context.'],
                blocked_decision_ids: [],
              });
            }
            setAnswerTarget(null);
          } : undefined}
          onClose={() => setAnswerTarget(null)}
        />
      )}
      {decisionTarget && decisionProject && (
        <DecisionWorkspace
          project={decisionProject}
          targetNodeId={decisionTarget.nodeId}
          onClose={() => setDecisionTarget(null)}
          onConfirm={saveDecision}
          onNavigateToSource={(sourceId) => {
            setContextEntry({ sourceId, tab: 'recent' });
            setDecisionTarget(null);
            setActiveTab('context');
          }}
          onViewGraph={viewDecisionGraph}
        />
      )}
      <TracePanel userId={userId} />
      {isNewProjectOpen && (
        <NewProjectModal
          onCreateProject={async (input) => {
            await handleCreateProject(input);
          }}
          onClose={() => setIsNewProjectOpen(false)}
        />
      )}
    </div>
  );
}
