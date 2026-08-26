'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, Edit3, MoreHorizontal, Plus, RotateCcw } from 'lucide-react';
import { ClarityNode, Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { groupProjectSummaries } from '@/lib/projects/projectSummaries';
import type { ProjectCardSummary } from '@/lib/projects/projectSummaries';
import { ClarityGraphCanvas } from '@/components/ClarityGraphCanvas';
import { currentPriorities, userLevelUnresolvedQuestions } from '@/lib/you/sections';
import { answeredQuestionHistory } from '@/lib/questions/history';
import type { AnsweredQuestion } from '@/lib/questions/history';
import { ProjectQuestionsList } from '@/components/ProjectQuestionsList';
import { ProjectSettingsPanel } from '@/components/ProjectSettingsPanel';
import { ContextInbox } from '@/components/ContextInbox';
import type { ContextEntry } from '@/components/ContextInbox';
import { ProjectHistory } from '@/components/ProjectHistory';
import { ProjectOverview } from '@/components/ProjectOverview';
import { AppScope } from '@/types/scope';
import { projectForReasoning } from '@/lib/context/sourceState';
import { canonicalOpenQuestions } from '@/lib/questions/canonical';
import { decisionQuestionForDisplay } from '@/lib/decisions/workspace';
import type { GapStatusFilter } from '@/components/ProjectQuestionsList';

interface ScopeDestinationProps {
  userId: string;
  project: Project;
  generalContext: Project;
  projects: Project[];
  scope: AppScope;
  projectFocusKey: number;
  projectRefreshVersion: number;
  profile: UserMemoryProfile;
  memories: DurableMemory[];
  contextEntry?: ContextEntry;
  onSelectProject: (projectId: string) => void;
  onSelectEverything: () => void;
  onOpenNewProject: () => void;
  onUpdateProject: (updated: Project) => void;
  onUpdateGeneralContext: (updated: Project) => void;
  onAnswerQuestion: (node: ClarityNode, intent?: 'confirm' | 'correct') => void;
  onReviewDecision: (nodeId: string) => void;
  onEditAnsweredQuestion: (item: AnsweredQuestion, projectId: string) => void;
  onNavigateToSource: (sourceId: string) => void;
  onViewToday?: () => void;
  onProjectBranched?: (project: Project) => void;
  gapsNavigationRequest?: { status: GapStatusFilter; key: number } | null;
  onGapsNavigationHandled?: () => void;
  reasoningPathNodeId?: string | null;
}

type ScopeSection = 'projects' | 'priorities' | 'unclear' | 'context';
type ProjectSection = 'overview' | 'gaps' | 'context' | 'history' | 'graph';

function dismissNode(project: Project, nodeId: string): Project {
  const updated: Project = JSON.parse(JSON.stringify(project));
  const node = updated.nodes.find((item) => item.id === nodeId);
  if (node) {
    node.status = 'DEPRECATED';
    node.updated_at = new Date().toISOString();
    updated.updated_at = node.updated_at;
  }
  return updated;
}

function formatDeadline(deadline?: string): string | null {
  if (!deadline) return null;
  const date = new Date(`${deadline}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? deadline
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const ScopeDestination: React.FC<ScopeDestinationProps> = ({
  userId,
  project,
  generalContext,
  projects,
  scope,
  projectFocusKey,
  projectRefreshVersion,
  profile,
  memories,
  contextEntry,
  onSelectProject,
  onSelectEverything,
  onOpenNewProject,
  onUpdateProject,
  onUpdateGeneralContext,
  onAnswerQuestion,
  onReviewDecision,
  onEditAnsweredQuestion,
  onNavigateToSource,
  onViewToday,
  onProjectBranched,
  gapsNavigationRequest,
  onGapsNavigationHandled,
  reasoningPathNodeId,
}) => {
  const [section, setSection] = useState<ScopeSection>('projects');
  const [projectSection, setProjectSection] = useState<ProjectSection>('overview');
  const [gapsStatusFilter, setGapsStatusFilter] = useState<GapStatusFilter>('all');
  const [isProjectEditOpen, setIsProjectEditOpen] = useState(false);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const priorities = useMemo(() => currentPriorities(memories), [memories]);
  const unclear = useMemo(() => userLevelUnresolvedQuestions(projects), [projects]);
  const reasoningProject = useMemo(() => projectForReasoning(project), [project]);
  const projectQuestions = useMemo(
    () =>
      canonicalOpenQuestions(reasoningProject)
        .filter((node) => node.type === 'UNKNOWN' || (node.type === 'ASSUMPTION' && (node.priority ?? node.impact) >= 0.5)),
    [reasoningProject]
  );
  const answeredQuestions = useMemo(() => answeredQuestionHistory(project), [project]);
  const openDecisions = useMemo(
    () => reasoningProject.nodes
      .filter((node) => node.type === 'DECISION' && node.status === 'OPEN')
      .sort((left, right) => (right.priority ?? right.impact) - (left.priority ?? left.impact)),
    [reasoningProject],
  );
  const resolvedDecisions = useMemo(
    () => reasoningProject.nodes
      .filter((node) => node.type === 'DECISION' && node.status === 'RESOLVED')
      .map((node) => ({ ...node, text: decisionQuestionForDisplay(project, node) }))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
    [project, reasoningProject],
  );
  const projectGroups = useMemo(() => groupProjectSummaries(projects), [projects]);
  useEffect(() => {
    if (projectFocusKey > 0) {
      setSection('projects');
      setProjectSection('overview');
    }
  }, [projectFocusKey]);

  useEffect(() => {
    if (reasoningPathNodeId) {
      setSection('projects');
      setProjectSection('graph');
    }
  }, [reasoningPathNodeId]);

  useEffect(() => {
    if (!gapsNavigationRequest) return;
    setSection('projects');
    setProjectSection('gaps');
    setGapsStatusFilter(gapsNavigationRequest.status);
    onGapsNavigationHandled?.();
  }, [gapsNavigationRequest, onGapsNavigationHandled]);

  useEffect(() => {
    if (!contextEntry) return;
    if (scope.type === 'project') setProjectSection('context');
    else setSection('context');
  }, [contextEntry, scope.type]);

  const projectById = (projectId: string) => projects.find((item) => item.id === projectId);

  const openProject = (projectId: string) => {
    const target = projectById(projectId);
    if (!target || target.status === 'archived') return;
    onSelectProject(projectId);
    setProjectSection('overview');
    setOpenProjectMenuId(null);
  };

  const renameProject = (projectId: string) => {
    const target = projectById(projectId);
    if (!target) return;
    const nextName = window.prompt('Rename project', target.title)?.trim();
    if (!nextName || nextName === target.title) {
      setOpenProjectMenuId(null);
      return;
    }
    onUpdateProject({
      ...target,
      title: nextName,
      updated_at: new Date().toISOString(),
    });
    setOpenProjectMenuId(null);
  };

  const archiveProject = (projectId: string) => {
    const target = projectById(projectId);
    if (!target) return;
    onUpdateProject({
      ...target,
      status: 'archived',
      updated_at: new Date().toISOString(),
    });
    if (scope.type === 'project' && scope.projectId === projectId) onSelectEverything();
    setOpenProjectMenuId(null);
  };

  const restoreProject = (projectId: string) => {
    const target = projectById(projectId);
    if (!target || target.status !== 'archived') return;
    onUpdateProject({
      ...target,
      status: 'active',
      updated_at: new Date().toISOString(),
    });
    setOpenProjectMenuId(null);
  };

  const questionDisplayText = (node: ClarityNode) => {
    return node.text;
  };

  const renderProjectCard = (summary: ProjectCardSummary) => {
    const isArchived = summary.status === 'archived';

    return (
    <article
      key={summary.id}
      role={isArchived ? undefined : 'button'}
      tabIndex={isArchived ? undefined : 0}
      onClick={isArchived ? undefined : () => openProject(summary.id)}
      onKeyDown={isArchived ? undefined : (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openProject(summary.id);
        }
      }}
      className={`relative rounded-xl border p-4 text-left transition ${
        scope.type === 'project' && summary.id === project.id
          ? 'border-cyan-500 bg-cyan-950/30'
          : isArchived
            ? 'border-slate-800/80 bg-slate-950/70'
            : 'cursor-pointer border-slate-800 bg-slate-900 hover:border-cyan-800 hover:bg-slate-900/90'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-extrabold uppercase tracking-wide text-slate-100">{summary.name}</h3>
          <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-300">{summary.primaryGoal}</p>
        </div>
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpenProjectMenuId(openProjectMenuId === summary.id ? null : summary.id);
            }}
            className="h-11 w-11 rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-400 hover:text-slate-100 sm:h-auto sm:w-auto"
            aria-label={`Project actions for ${summary.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {openProjectMenuId === summary.id && (
            <div
              className="absolute right-0 top-10 z-20 w-36 rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => renameProject(summary.id)}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-800 sm:min-h-0"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Rename
              </button>
              {summary.status !== 'archived' ? (
                <button
                  type="button"
                  onClick={() => archiveProject(summary.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-800 sm:min-h-0"
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => restoreProject(summary.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-emerald-300 hover:bg-slate-800 sm:min-h-0"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>{summary.openImportantCount} open question{summary.openImportantCount === 1 ? '' : 's'}</span>
        <span>{summary.updatedLabel}</span>
        {isArchived && <span className="font-semibold text-amber-300">Archived</span>}
      </div>
      {isArchived && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            restoreProject(summary.id);
          }}
          className="mt-4 min-h-11 rounded-lg border border-emerald-800/80 bg-emerald-950/30 px-3 py-2 text-xs font-bold text-emerald-200 hover:border-emerald-600 sm:min-h-0 sm:py-1.5"
        >
          Restore
        </button>
      )}
    </article>
    );
  };

  const renderStillUnclear = () => (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-slate-100">Still unclear</h2>
        <p className="mt-1 text-sm text-slate-500">Questions about you or your broader direction, across projects.</p>
      </div>
      {unclear.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {unclear.map((node) => {
            const relatedProject = projects.find((candidate) => candidate.nodes.some((candidateNode) => candidateNode.id === node.id));

            return (
              <article key={node.id} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
                <h3 className="text-sm font-bold text-slate-100">{questionDisplayText(node)}</h3>
                {relatedProject && (
                  <p className="text-xs font-semibold text-cyan-300">Related to: {relatedProject.title}</p>
                )}
                <p className="text-xs text-slate-400">{node.why_it_matters?.[0] ?? 'This remains unresolved in your context.'}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onAnswerQuestion(node)}
                    className="min-h-11 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 sm:min-h-0"
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (relatedProject) onUpdateProject(dismissNode(relatedProject, node.id));
                    }}
                    className="min-h-11 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 sm:min-h-0"
                  >
                    Dismiss / Not relevant
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950 p-8 text-center">
          <h3 className="text-sm font-extrabold text-slate-100">Nothing unresolved here</h3>
          <p className="mt-2 text-sm text-slate-500">Gapwise has no persistent user-level questions to work through right now.</p>
        </div>
      )}
    </section>
  );

  const renderPriorities = () => (
    <section className="space-y-4">
      <h2 className="text-lg font-extrabold text-slate-100">Priorities</h2>
      {priorities.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {priorities.map((memory) => (
            <article key={memory.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-sm font-bold text-slate-100">{memory.text}</p>
              <p className="mt-2 text-xs text-slate-500">{memory.why_remembered}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950 p-8 text-center">
          <h3 className="text-sm font-extrabold text-slate-100">No priorities yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            When you confirm a durable preference or priority, it will appear here.
          </p>
        </div>
      )}
    </section>
  );

  const renderProjectOverview = () => (
    <ProjectOverview
      userId={userId}
      project={project}
      refreshKey={projectRefreshVersion}
      onViewGaps={() => setProjectSection('gaps')}
      onViewHistory={() => setProjectSection('history')}
      onViewToday={onViewToday}
    />
  );

  const renderProjectQuestions = () => (
    <ProjectQuestionsList
      openQuestions={projectQuestions}
      answeredQuestions={answeredQuestions}
      openDecisions={openDecisions}
      resolvedDecisions={resolvedDecisions}
      projectId={project.id}
      sourceContents={project.sources.map((source) => source.content)}
      onAnswerQuestion={onAnswerQuestion}
      onEditAnsweredQuestion={onEditAnsweredQuestion}
      onReviewDecision={onReviewDecision}
      initialStatusFilter={gapsStatusFilter}
    />
  );

  const renderProjects = () => (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">Projects</p>
          <h2 className="mt-2 text-xl font-extrabold text-slate-100">Your projects</h2>
          <p className="mt-1 text-sm text-slate-500">Choose a project to open its workspace.</p>
        </div>
        <button
          type="button"
          onClick={onOpenNewProject}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 sm:min-h-0"
        >
          <Plus className="h-4 w-4" />
          New project
        </button>
      </div>

      <section>
        <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">Active projects</h3>
        {projectGroups.active.length ? (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {projectGroups.active.map(renderProjectCard)}
          </div>
        ) : projects.length ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-700 bg-slate-950 p-5 text-sm text-slate-500">
            No active projects. Restore one below or create a new project.
          </p>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-slate-700 bg-slate-950 p-8 text-center">
            <h3 className="text-sm font-extrabold text-slate-100">No projects yet</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
              Create a project and give Gapwise some context.
            </p>
            <button
              type="button"
              onClick={onOpenNewProject}
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 sm:min-h-0"
            >
              <Plus className="h-4 w-4" />
              New project
            </button>
          </div>
        )}
      </section>

      {projectGroups.archived.length > 0 && (
        <section className="border-t border-slate-800 pt-5">
          <button
            type="button"
            onClick={() => setShowArchived((current) => !current)}
            className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-bold text-slate-300 hover:text-slate-100 sm:min-h-0"
            aria-expanded={showArchived}
            aria-controls="archived-projects"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showArchived ? '' : '-rotate-90'}`} />
            Archived projects ({projectGroups.archived.length})
          </button>
          {showArchived && (
            <div id="archived-projects" className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {projectGroups.archived.map(renderProjectCard)}
            </div>
          )}
        </section>
      )}
    </div>
  );

  const renderFocusedProject = () => (
    <div className="mx-auto max-w-7xl space-y-5 px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <header className="border-b border-slate-800 pb-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">WORKSPACE</p>
            <div className="relative mt-2 flex items-center gap-2">
              <h1 className="text-2xl font-extrabold text-slate-100">{project.title}</h1>
              <button
                type="button"
                onClick={() => setOpenProjectMenuId(openProjectMenuId === project.id ? null : project.id)}
                className="min-h-11 min-w-11 rounded-lg p-2 text-slate-500 hover:bg-slate-900 hover:text-slate-100 sm:min-h-0 sm:min-w-0"
                aria-label={`Project actions for ${project.title}`}
                aria-expanded={openProjectMenuId === project.id}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {openProjectMenuId === project.id && (
                <div
                  className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsProjectEditOpen(true);
                      setOpenProjectMenuId(null);
                    }}
                    className="flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-800 sm:min-h-0"
                  >
                    Edit project
                  </button>
                  <button
                    type="button"
                    onClick={() => archiveProject(project.id)}
                    className="flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-xs font-semibold text-amber-200 hover:bg-slate-800 sm:min-h-0"
                  >
                    Archive project
                  </button>
                </div>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">{project.goal}</p>
            {formatDeadline(project.deadline) && (
              <p className="mt-2 text-xs font-semibold text-slate-500">Deadline: {formatDeadline(project.deadline)}</p>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ['overview', 'Overview'],
            ['gaps', 'Gaps'],
            ['context', 'Context'],
            ['history', 'History'],
            ['graph', 'Decision Map'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setProjectSection(id)}
              className={`min-h-11 rounded-lg px-3 py-2 text-xs font-bold sm:min-h-0 ${
                projectSection === id ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {projectSection === 'overview' && renderProjectOverview()}
      {projectSection === 'gaps' && renderProjectQuestions()}
      {projectSection === 'history' && <ProjectHistory userId={userId} project={project} onNavigateToSource={onNavigateToSource} onProjectBranched={onProjectBranched} />}
      {projectSection === 'graph' && <ClarityGraphCanvas userId={userId} project={project} focusNodeId={reasoningPathNodeId} onSelectNode={() => {}} onSelectSource={onNavigateToSource} onReviewDecision={(node) => onReviewDecision(node.id)} onResolveQuestion={onAnswerQuestion} />}
      {projectSection === 'context' && (
        <ContextInbox
          project={project}
          projects={projects}
          scope={scope}
          generalContext={generalContext}
          profile={profile}
          userId={userId}
          focusedSourceId={contextEntry?.sourceId}
          entryTab={contextEntry?.tab}
          onUpdateProject={onUpdateProject}
          onUpdateGeneralContext={onUpdateGeneralContext}
        />
      )}
      {isProjectEditOpen && (
        <ProjectSettingsPanel
          project={project}
          mode="modal"
          onUpdateProject={onUpdateProject}
          onArchived={() => {
            if (scope.type === 'project' && scope.projectId === project.id) onSelectEverything();
          }}
          onClose={() => setIsProjectEditOpen(false)}
        />
      )}
    </div>
  );

  if (scope.type === 'project') return renderFocusedProject();

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-7xl px-3 pt-5 sm:px-6 sm:pt-6 lg:px-8">
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">WORKSPACE</p>
            <h1 className="mt-2 text-2xl font-extrabold text-slate-100">Workspace</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
            What Gapwise understands about you and the things you are working on.
            </p>
          </div>
        </div>

        <div className="touch-scroll mt-4 flex gap-2 overflow-x-auto pb-2">
          {([
            ['projects', 'Projects'],
            ['priorities', 'Priorities'],
            ['unclear', 'Still unclear'],
            ['context', 'Context'],
          ] as const).map(([id, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setSection(id)}
              className={`min-h-11 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold sm:min-h-0 ${
                section === id ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
        {section === 'projects' && renderProjects()}
        {section === 'priorities' && renderPriorities()}
        {section === 'unclear' && renderStillUnclear()}
        {section === 'context' && (
          <ContextInbox
            project={project}
            projects={projects}
            scope={scope}
            generalContext={generalContext}
            profile={profile}
            userId={userId}
            focusedSourceId={contextEntry?.sourceId}
            entryTab={contextEntry?.tab}
            onUpdateProject={onUpdateProject}
            onUpdateGeneralContext={onUpdateGeneralContext}
          />
        )}
      </div>
    </div>
  );
};
