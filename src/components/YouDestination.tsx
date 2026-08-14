'use client';

import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { Archive, ChevronRight, Edit3, FileText, HelpCircle, MessageCircle, MoreHorizontal, Plus } from 'lucide-react';
import { ClarityNode, Project, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { groupProjectSummaries } from '@/lib/projects/projectSummaries';
import type { ProjectCardSummary } from '@/lib/projects/projectSummaries';
import { MyWorldView } from '@/components/MyWorldView';
import { ClarityGraphCanvas } from '@/components/ClarityGraphCanvas';
import { MemoryView } from '@/components/MemoryView';
import { currentPriorities, userLevelUnresolvedQuestions } from '@/lib/you/sections';
import { relationshipReasons } from '@/lib/graph/relationshipContext';
import { AppScope } from '@/types/scope';

interface YouDestinationProps {
  userId: string;
  project: Project;
  worldProject: Project;
  projects: Project[];
  scope: AppScope;
  projectFocusKey: number;
  profile: UserMemoryProfile;
  memories: DurableMemory[];
  onSelectProject: (projectId: string) => void;
  onOpenNewProject: () => void;
  onUpdateProject: (updated: Project) => void;
  onUpdateProfile: (updated: UserMemoryProfile) => void;
  onUpdateMemories: (updated: DurableMemory[]) => void;
  onAnswerQuestion: (node: ClarityNode) => void;
  onNavigateToContext: () => void;
  onNavigateToAsk: () => void;
}

type YouSection = 'overview' | 'projects' | 'priorities' | 'unclear' | 'memory' | 'world';
type ProjectSection = 'overview' | 'questions' | 'graph' | 'sources' | 'settings';

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

export const YouDestination: React.FC<YouDestinationProps> = ({
  userId,
  project,
  worldProject,
  projects,
  scope,
  projectFocusKey,
  profile,
  memories,
  onSelectProject,
  onOpenNewProject,
  onUpdateProject,
  onUpdateProfile,
  onUpdateMemories,
  onAnswerQuestion,
  onNavigateToContext,
  onNavigateToAsk,
}) => {
  const [section, setSection] = useState<YouSection>('overview');
  const [projectSection, setProjectSection] = useState<ProjectSection>('overview');
  const [whyNode, setWhyNode] = useState<ClarityNode | null>(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [settingsName, setSettingsName] = useState(project.title);
  const [settingsGoal, setSettingsGoal] = useState(project.goal);
  const [settingsDescription, setSettingsDescription] = useState(project.one_sentence_context ?? '');
  const [settingsDeadline, setSettingsDeadline] = useState(project.deadline ?? '');
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
  const projectGroups = useMemo(() => groupProjectSummaries(projects), [projects]);
  const highestQuestion = useMemo(() => {
    if (project.active_question) {
      return projectQuestions.find((node) => node.id === project.active_question?.node_id) ?? null;
    }
    return projectQuestions[0] ?? null;
  }, [projectQuestions, project.active_question]);
  const recentDecisions = useMemo(
    () =>
      project.nodes
        .filter((node) => node.type === 'DECISION')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 3),
    [project.nodes]
  );

  useEffect(() => {
    setSettingsName(project.title);
    setSettingsGoal(project.goal);
    setSettingsDescription(project.one_sentence_context ?? '');
    setSettingsDeadline(project.deadline ?? '');
  }, [project.id, project.title, project.goal, project.one_sentence_context, project.deadline]);

  useEffect(() => {
    if (projectFocusKey > 0) {
      setSection('projects');
      setProjectSection('overview');
    }
  }, [projectFocusKey]);

  const projectById = (projectId: string) => projects.find((item) => item.id === projectId);

  const openProject = (projectId: string) => {
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
    setOpenProjectMenuId(null);
  };

  const saveProjectSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settingsName.trim() || !settingsGoal.trim()) return;
    onUpdateProject({
      ...project,
      title: settingsName.trim(),
      goal: settingsGoal.trim(),
      one_sentence_context: settingsDescription.trim() || undefined,
      deadline: settingsDeadline || undefined,
      updated_at: new Date().toISOString(),
    });
  };

  const archiveCurrentProject = () => {
    onUpdateProject({
      ...project,
      status: 'archived',
      updated_at: new Date().toISOString(),
    });
  };

  const formatProcessingState = (state?: string) => {
    if (state === 'completed') return 'Processed';
    if (state === 'processing') return 'Processing';
    if (state === 'pending') return 'Uploaded';
    if (state === 'failed') return 'Needs attention';
    return 'Processed';
  };

  const sourceNamesForNode = (node: ClarityNode) => {
    const names = node.source_refs
      .map((sourceId) => project.sources.find((source) => source.id === sourceId)?.filename)
      .filter((name): name is string => Boolean(name));
    return names.length ? names.join(', ') : 'No specific source attached yet.';
  };

  const questionEffectText = (node: ClarityNode) => {
    const reasons = relationshipReasons(project, node.id);
    if (reasons.length) return reasons.join(' · ');
    if (node.type === 'ASSUMPTION') return 'Project direction and decision confidence';
    return 'Next project decision';
  };

  const renderProjectCard = (summary: ProjectCardSummary) => (
    <article
      key={summary.id}
      role="button"
      tabIndex={0}
      onClick={() => openProject(summary.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openProject(summary.id);
        }
      }}
      className={`relative rounded-xl border p-4 text-left transition ${
        scope.type === 'project' && summary.id === project.id
          ? 'border-cyan-500 bg-cyan-950/30'
          : 'border-slate-800 bg-slate-900 hover:border-slate-700'
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
              {summary.status !== 'archived' && (
                <button
                  type="button"
                  onClick={() => archiveProject(summary.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-800 sm:min-h-0"
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>{summary.status === 'archived' ? 'Archived' : scope.type === 'project' && summary.id === project.id ? 'Focused' : 'Active'}</span>
        <span>{summary.openImportantCount} open question{summary.openImportantCount === 1 ? '' : 's'}</span>
        <span>{summary.sourceCount} source{summary.sourceCount === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{summary.updatedLabel}</p>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openProject(summary.id);
          }}
          className="min-h-11 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:text-cyan-300 sm:min-h-0 sm:py-1.5"
        >
          Open
        </button>
      </div>
    </article>
  );

  const sourceCards = project.sources.map((source) => (
    <article key={source.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-100">{source.filename}</h3>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {source.type} · {formatProcessingState(source.processing_status)}
          </p>
        </div>
        <FileText className="h-4 w-4 flex-shrink-0 text-cyan-300" />
      </div>
      <p className="mt-3 line-clamp-3 text-xs text-slate-400">
        {source.extraction_summary || source.content || 'Nothing summarized yet.'}
      </p>
    </article>
  ));

  const renderOverview = () => (
    <div className="space-y-6">
      <section className="rounded-xl border border-cyan-800 bg-slate-900 p-5 shadow-xl shadow-cyan-950/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">Your projects</p>
            <h2 className="mt-2 text-xl font-extrabold text-slate-100">Things you are working on</h2>
            <p className="mt-1 text-xs text-slate-400">{projectGroups.active.length} active project{projectGroups.active.length === 1 ? '' : 's'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenNewProject}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 sm:min-h-0"
            >
              <Plus className="h-3.5 w-3.5" />
              New project
            </button>
            {projects.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSection('projects');
                  setProjectSection('overview');
                }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:text-cyan-300 sm:min-h-0"
              >
                Open project
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            </div>
          </div>
        {projects.length ? (
          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {[...projectGroups.active, ...projectGroups.archived].slice(0, 4).map(renderProjectCard)}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-slate-700 bg-slate-950 p-6 text-center">
            <h3 className="text-sm font-extrabold text-slate-100">No projects yet</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
              Create a project and give Gapswise some context.
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

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-extrabold text-slate-100">Your priorities</h2>
          <p className="mt-1 text-xs text-slate-500">Supported by durable memory</p>
          <div className="mt-4 space-y-3">
            {priorities.length ? priorities.slice(0, 3).map((memory) => (
              <p key={memory.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
                {memory.text}
              </p>
            )) : (
              <p className="text-sm text-slate-500">No cross-project priorities have been saved yet.</p>
            )}
          </div>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-extrabold text-slate-100">Still unclear</h2>
          <p className="mt-1 text-xs text-slate-500">About you or your broader direction</p>
          <div className="mt-4 space-y-3">
            {unclear.length ? unclear.slice(0, 3).map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => setWhyNode(node)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-left text-sm text-slate-300 hover:border-cyan-800"
              >
                {node.text}
              </button>
            )) : (
              <p className="text-sm text-slate-500">No persistent user-level questions right now.</p>
            )}
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-extrabold text-slate-100">What Gapswise remembers</h2>
          <p className="mt-2 text-sm text-slate-400">
            {memories.filter((memory) => !memory.forgotten_at).length} active memories about preferences, priorities, and stable context.
          </p>
          <button
            type="button"
            onClick={() => setSection('memory')}
            className="mt-4 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:text-cyan-300"
          >
            Manage memory
          </button>
        </article>

        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-extrabold text-slate-100">My World</h2>
          <p className="mt-2 text-sm text-slate-400">
            A deeper visualization of how projects, sources, risks, preferences, and open questions connect.
          </p>
          <button
            type="button"
            onClick={() => setSection('world')}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:text-cyan-300"
          >
            View My World
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </article>
      </section>
    </div>
  );

  const renderStillUnclear = () => (
    <section className="space-y-4">
      <h2 className="text-lg font-extrabold text-slate-100">Still unclear</h2>
      {unclear.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {unclear.map((node) => (
            <article key={node.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-100">{node.text}</h3>
              <p className="text-xs text-slate-400">{node.why_it_matters?.[0] ?? 'This remains unresolved in your context.'}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onAnswerQuestion(node)}
                  className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950"
                >
                  Answer
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateProject(dismissNode(project, node.id))}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300"
                >
                  Dismiss / Not relevant
                </button>
                <button
                  type="button"
                  onClick={() => setWhyNode(node)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 flex items-center gap-1.5"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  Why?
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-500">
          No durable unresolved questions right now.
        </div>
      )}
    </section>
  );

  const renderPriorities = () => (
    <section className="space-y-4">
      <h2 className="text-lg font-extrabold text-slate-100">Your priorities</h2>
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
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-500">
          No current priorities have been saved yet.
        </div>
      )}
    </section>
  );

  const renderProjectOverview = () => (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5 lg:col-span-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Project goal</p>
          <h3 className="mt-3 text-lg font-extrabold text-slate-100">{project.goal}</h3>
          {project.one_sentence_context && (
            <p className="mt-3 text-sm text-slate-400">{project.one_sentence_context}</p>
          )}
        </article>
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Clarity</p>
          <p className="mt-3 text-3xl font-extrabold text-cyan-300">{project.clarity_score}</p>
          <p className="mt-1 text-xs text-slate-500">out of 100</p>
        </article>
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Sources</p>
          <p className="mt-3 text-3xl font-extrabold text-slate-100">{project.sources.length}</p>
          <p className="mt-1 text-xs text-slate-500">available to Gapswise</p>
        </article>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-400">Highest-value unresolved question</p>
            {highestQuestion ? (
              <>
                <h3 className="mt-3 text-lg font-extrabold text-slate-100">{highestQuestion.text}</h3>
                <p className="mt-2 text-sm text-slate-400">
                  {highestQuestion.why_it_matters?.[0] ?? 'This is one of the most important unresolved items in the project.'}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No open high-value project questions right now.</p>
            )}
          </div>
          {highestQuestion && (
            <button
              type="button"
              onClick={() => onAnswerQuestion(highestQuestion)}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950"
            >
              Answer
            </button>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-extrabold text-slate-100">Recent decisions</h3>
          <div className="mt-4 space-y-3">
            {recentDecisions.length ? recentDecisions.map((decision) => (
              <p key={decision.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
                {decision.text}
              </p>
            )) : (
              <p className="text-sm text-slate-500">No project decisions recorded yet.</p>
            )}
          </div>
        </article>
        <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-extrabold text-slate-100">Primary actions</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onNavigateToContext}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950"
            >
              <Plus className="h-4 w-4" />
              Add context
            </button>
            <button
              type="button"
              onClick={onNavigateToAsk}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:text-cyan-300"
            >
              <MessageCircle className="h-4 w-4" />
              Ask Gapswise
            </button>
          </div>
        </article>
      </section>
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
                onClick={() => onAnswerQuestion(node)}
                className="mt-4 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950"
              >
                Answer
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-500">
          No open project questions right now.
        </div>
      )}
    </section>
  );

  const renderProjectSettings = () => (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <form onSubmit={saveProjectSettings} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-lg font-extrabold text-slate-100">Settings</h3>
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-slate-300">Project name</span>
            <input
              value={settingsName}
              onChange={(event) => setSettingsName(event.target.value)}
              required
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-300">Goal</span>
            <textarea
              value={settingsGoal}
              onChange={(event) => setSettingsGoal(event.target.value)}
              required
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-300">Description/context</span>
            <textarea
              value={settingsDescription}
              onChange={(event) => setSettingsDescription(event.target.value)}
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-300">Deadline</span>
            <input
              value={settingsDeadline}
              onChange={(event) => setSettingsDeadline(event.target.value)}
              type="date"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
            />
          </label>
        </div>
        <button
          type="submit"
          className="mt-5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950"
        >
          Save changes
        </button>
      </form>
      <aside className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-extrabold text-slate-100">Archive project</h3>
        <p className="mt-2 text-sm text-slate-400">
          Archiving moves this project out of active work. It keeps its graph, questions, and sources.
        </p>
        <button
          type="button"
          onClick={archiveCurrentProject}
          disabled={project.status === 'archived'}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-amber-800 bg-amber-950 px-4 py-2 text-xs font-bold text-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Archive className="h-4 w-4" />
          {project.status === 'archived' ? 'Archived' : 'Archive project'}
        </button>
      </aside>
    </section>
  );

  const renderProjects = () => (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">Your projects</p>
            <h2 className="mt-2 text-xl font-extrabold text-slate-100">{project.title}</h2>
            <p className="mt-2 max-w-2xl text-xs text-slate-400">{project.goal}</p>
          </div>
          <button
            type="button"
            onClick={onOpenNewProject}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400"
          >
            <Plus className="h-4 w-4" />
            New project
          </button>
        </div>
        {projects.length ? (
          <div className="mt-5 space-y-5">
            <section>
              <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">Active projects</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {projectGroups.active.map(renderProjectCard)}
              </div>
            </section>
            {projectGroups.archived.length > 0 && (
              <section>
                <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-500">Archived</h3>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {projectGroups.archived.map(renderProjectCard)}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-slate-700 bg-slate-950 p-6 text-center">
            <h3 className="text-sm font-extrabold text-slate-100">No projects yet</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
              Create a project and give Gapswise some context.
            </p>
            <button
              type="button"
              onClick={onOpenNewProject}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400"
            >
              <Plus className="h-4 w-4" />
              New project
            </button>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ['overview', 'Overview'],
            ['questions', 'Questions'],
            ['graph', 'Graph'],
            ['sources', 'Sources'],
            ['settings', 'Settings'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setProjectSection(id)}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                projectSection === id ? 'bg-cyan-500 text-slate-950' : 'bg-slate-950 text-slate-400 hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {projectSection === 'overview' && renderProjectOverview()}
      {projectSection === 'questions' && renderProjectQuestions()}
      {projectSection === 'graph' && (
        <ClarityGraphCanvas project={project} onSelectNode={() => {}} />
      )}
      {projectSection === 'sources' && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sourceCards}
        </section>
      )}
      {projectSection === 'settings' && renderProjectSettings()}
    </div>
  );

  const renderFocusedProject = () => (
    <div className="mx-auto max-w-7xl space-y-5 px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="border-b border-slate-800 pb-5">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">ABOUT THIS PROJECT</p>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-100">{project.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">{project.goal}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ['overview', 'Overview'],
            ['questions', 'Questions'],
            ['graph', 'Graph'],
            ['sources', 'Sources'],
            ['settings', 'Settings'],
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
      </div>
      {projectSection === 'overview' && renderProjectOverview()}
      {projectSection === 'questions' && renderProjectQuestions()}
      {projectSection === 'graph' && <ClarityGraphCanvas project={project} onSelectNode={() => {}} />}
      {projectSection === 'sources' && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">{sourceCards}</section>
      )}
      {projectSection === 'settings' && renderProjectSettings()}
    </div>
  );

  if (scope.type === 'project') return renderFocusedProject();

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-7xl px-3 pt-5 sm:px-6 sm:pt-6 lg:px-8">
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyan-400">YOU</p>
            <h1 className="mt-2 text-2xl font-extrabold text-slate-100">You</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              What Gapswise understands about you and the things you are working on.
            </p>
          </div>
        </div>

        <div className="touch-scroll mt-4 flex gap-2 overflow-x-auto pb-2">
          {([
            ['projects', 'Your projects'],
            ['priorities', 'Your priorities'],
            ['unclear', 'Still unclear'],
            ['memory', 'What Gapswise remembers'],
            ['world', 'My World'],
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
        {section === 'overview' && (
          renderOverview()
        )}
        {section === 'priorities' && renderPriorities()}
        {section === 'unclear' && renderStillUnclear()}
      </div>

      {section === 'projects' && (
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          {renderProjects()}
        </div>
      )}
      {section === 'memory' && (
        <MemoryView
          profile={profile}
          memories={memories}
          onUpdateProfile={onUpdateProfile}
          onUpdateMemories={onUpdateMemories}
        />
      )}
      {section === 'world' && (
        <MyWorldView
          userId={userId}
          project={worldProject}
          onNavigateToProjectGraph={() => {
            setSection('projects');
            setProjectSection('graph');
          }}
          onNavigateToInbox={onNavigateToContext}
        />
      )}

      {whyNode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-2 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-800 bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-none sm:rounded-xl sm:p-5">
            <h2 className="text-sm font-bold text-slate-100">Why this is still unclear</h2>
            <p className="mt-3 text-sm text-slate-300">{whyNode.text}</p>
            <div className="mt-3 space-y-2">
              {(whyNode.why_it_matters ?? ['This remains unresolved in your existing context.']).map((reason) => (
                <p key={reason} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
                  {reason}
                </p>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setWhyNode(null)}
              className="mt-4 min-h-11 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 sm:min-h-0"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
