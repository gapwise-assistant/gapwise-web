'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, Edit3, MoreHorizontal, Plus, RotateCcw } from 'lucide-react';
import { ClarityNode, Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { groupProjectSummaries } from '@/lib/projects/projectSummaries';
import type { ProjectCardSummary } from '@/lib/projects/projectSummaries';
import { ClarityGraphCanvas } from '@/components/ClarityGraphCanvas';
import { currentPriorities, userLevelUnresolvedQuestions } from '@/lib/you/sections';
import { relationshipReasons } from '@/lib/graph/relationshipContext';
import { humanizeSourceTitle } from '@/lib/context/sourceTitle';
import { answeredQuestionHistory } from '@/lib/questions/history';
import type { AnsweredQuestion } from '@/lib/questions/history';
import { ProjectSettingsPanel } from '@/components/ProjectSettingsPanel';
import { ContextInbox } from '@/components/ContextInbox';
import type { ContextEntry } from '@/components/ContextInbox';
import { AppScope } from '@/types/scope';
import { buildCurrentPicture, buildNeedsAttention } from '@/lib/projects/projectOverview';

interface ScopeDestinationProps {
  userId: string;
  project: Project;
  generalContext: Project;
  projects: Project[];
  scope: AppScope;
  projectFocusKey: number;
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
  reasoningPathNodeId?: string | null;
}

type ScopeSection = 'projects' | 'priorities' | 'unclear' | 'context';
type ProjectSection = 'overview' | 'questions' | 'graph' | 'context';

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
  reasoningPathNodeId,
}) => {
  const [section, setSection] = useState<ScopeSection>('projects');
  const [projectSection, setProjectSection] = useState<ProjectSection>('overview');
  const [isProjectEditOpen, setIsProjectEditOpen] = useState(false);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const priorities = useMemo(() => currentPriorities(memories), [memories]);
  const unclear = useMemo(() => userLevelUnresolvedQuestions(projects), [projects]);
  const projectQuestions = useMemo(
    () =>
      project.nodes
        .filter(
          (node) =>
            node.status === 'OPEN' &&
            (node.type === 'UNKNOWN' || (node.type === 'ASSUMPTION' && (node.priority ?? node.impact) >= 0.5))
        )
        .sort((a, b) => (b.priority ?? b.impact) - (a.priority ?? a.impact)),
    [project.nodes]
  );
  const answeredQuestions = useMemo(() => answeredQuestionHistory(project), [project]);
  const projectGroups = useMemo(() => groupProjectSummaries(projects), [projects]);
  const currentPicture = useMemo(() => buildCurrentPicture(project), [project]);
  const needsAttention = useMemo(() => buildNeedsAttention(project), [project]);
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

  const sourceNamesForNode = (node: ClarityNode) => {
    const names = node.source_refs
      .map((sourceId) => project.sources.find((source) => source.id === sourceId)?.filename)
      .map((name) => name ? humanizeSourceTitle(name) : undefined)
      .filter((name): name is string => Boolean(name));
    return names.length ? names.join(', ') : 'No named source attached yet.';
  };

  const questionEffectText = (node: ClarityNode) => {
    const connected = project.edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) => {
        const outgoing = edge.source === node.id;
        const other = project.nodes.find((candidate) => candidate.id === (outgoing ? edge.target : edge.source));
        if (!other || !['GOAL', 'DECISION', 'NEXT_ACTION', 'CONSTRAINT'].includes(other.type)) return null;
        const relationship = edge.type === 'blocks'
          ? outgoing ? 'Blocks' : 'Blocked by'
          : edge.type === 'affects'
            ? outgoing ? 'Affects' : 'Affected by'
            : edge.type === 'depends_on'
              ? outgoing ? 'Depends on' : 'Needed by'
              : edge.type === 'resolves'
                ? outgoing ? 'Resolves' : 'Resolved by'
                : 'Connected to';
        return `${relationship}: ${other.text}`;
      })
      .filter((value): value is string => Boolean(value));
    if (connected.length) return connected[0];
    const reasons = relationshipReasons(project, node.id);
    if (reasons.length) return reasons[0];
    if (node.type === 'ASSUMPTION') return 'Project direction and decision confidence';
    return 'Project direction';
  };

  const answeredDateLabel = (timestamp: string) => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? 'Previously answered' : `Answered ${date.toLocaleDateString()}`;
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
                <h3 className="text-sm font-bold text-slate-100">{node.text}</h3>
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
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">Current picture</p>
        <h2 className="mt-2 text-lg font-extrabold text-slate-100">Where things stand</h2>
        {currentPicture.length ? (
          <ul className="mt-4 space-y-3">
            {currentPicture.map((item) => (
              <li key={item.id} className="flex gap-3 text-sm leading-relaxed text-slate-300">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" aria-hidden="true" />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Gapwise has not built a picture of this project yet. Add context to get started.</p>
        )}
      </section>

      {needsAttention && (
        <section className="rounded-xl border border-amber-800/80 bg-amber-950/20 p-5">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-amber-300">Needs attention</p>
          <h2 className="mt-2 text-base font-extrabold text-slate-100">{needsAttention.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{needsAttention.detail}</p>
          <button
            type="button"
            onClick={() => {
              const question = project.nodes.find((node) => node.id === needsAttention.nodeId);
              if (question) onAnswerQuestion(question);
            }}
            className="mt-4 min-h-11 rounded-lg border border-amber-700/80 bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-200 hover:border-amber-500 hover:text-amber-100 sm:min-h-0"
          >
            Resolve question
          </button>
        </section>
      )}

    </div>
  );

  const renderProjectQuestions = () => (
    <section className="space-y-4">
      <h3 className="text-lg font-extrabold text-slate-100">Open questions</h3>
      {projectQuestions.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {projectQuestions.map((node) => (
            <article key={node.id} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">
                {node.type === 'ASSUMPTION' ? 'Important assumption' : 'Open question'}
              </p>
              <h4 className="mt-3 text-base font-extrabold text-slate-100">{node.text}</h4>
              <div className="mt-4 space-y-3 text-sm">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Why it matters</p>
                  <p className="mt-1 text-slate-300">{node.why_it_matters?.[0] ?? 'This may affect the project direction.'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">What it affects</p>
                  <p className="mt-1 text-slate-300">{questionEffectText(node)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Evidence checked</p>
                  <p className="mt-1 text-slate-300">{sourceNamesForNode(node)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onAnswerQuestion(node, node.type === 'ASSUMPTION' ? 'confirm' : undefined)}
                className="mt-4 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950"
              >
                Resolve
              </button>
              {node.type === 'ASSUMPTION' && (
                <button
                  type="button"
                  onClick={() => onAnswerQuestion(node, 'correct')}
                  className="mt-4 ml-2 rounded-lg border border-amber-700/80 bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-200"
                >
                  Correct
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-500">
          No open project questions right now.
        </div>
      )}
      <section className="space-y-4 border-t border-slate-800 pt-6">
        <div>
          <h3 className="text-lg font-extrabold text-slate-100">Previously answered</h3>
          <p className="mt-1 text-sm text-slate-500">
            Questions you answered and the understanding Gapwise recorded afterward.
          </p>
        </div>
        {answeredQuestions.length ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {answeredQuestions.map((item) => (
              <article key={`${item.timestamp}-${item.question}`} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">Answered</p>
                  <p className="text-xs text-slate-500">{answeredDateLabel(item.timestamp)}</p>
                </div>
                <h4 className="mt-3 text-base font-extrabold text-slate-100">{item.question}</h4>
                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Your answer</p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-300">{item.answer}</p>
                  </div>
                  {item.graph_diff_summary && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">What changed</p>
                      <p className="mt-1 text-slate-400">{item.graph_diff_summary}</p>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onEditAnsweredQuestion(item, project.id)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:text-cyan-300"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit answer
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-500">
            No answered questions yet.
          </div>
        )}
      </section>
    </section>
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
            ['questions', 'Questions'],
            ['graph', 'Decision Map'],
            ['context', 'Context'],
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
      {projectSection === 'questions' && renderProjectQuestions()}
      {projectSection === 'graph' && <ClarityGraphCanvas userId={userId} project={project} focusNodeId={reasoningPathNodeId} onSelectNode={() => {}} onSelectSource={onNavigateToSource} onReviewDecision={(node) => onReviewDecision(node.id)} />}
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
