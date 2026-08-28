'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, History, Sparkles } from 'lucide-react';
import type { Project } from '@/types/clarity';
import { authFetch } from '@/lib/auth/client';
import type { ProjectOverviewAssessment, ProjectTrajectory } from '@/lib/overview/projectOverviewAssessment';

interface ProjectOverviewProps {
  userId: string;
  project: Project;
  refreshKey?: number;
  onViewGaps: () => void;
  onViewHistory: () => void;
  onViewToday?: () => void;
}

const trajectoryLabels: Record<ProjectTrajectory, string> = {
  exploring: 'Exploring',
  taking_shape: 'Taking shape',
  moving_forward: 'Moving forward',
  at_risk: 'At risk',
  blocked: 'Blocked',
  changing_direction: 'Changing direction',
  ready_for_next_stage: 'Ready for next stage',
};

function severityClasses(severity: 'high' | 'medium' | 'watch'): string {
  if (severity === 'high') return 'border-rose-800/80 bg-rose-950/20 text-rose-200';
  if (severity === 'medium') return 'border-amber-800/80 bg-amber-950/20 text-amber-200';
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function overviewProjectStateKey(project: Project): string {
  return JSON.stringify({
    id: project.id,
    title: project.title,
    goal: project.goal,
    deadline: project.deadline ?? null,
    nodes: project.nodes
      .filter((node) => node.status !== 'DEPRECATED')
      .map((node) => ({
        id: node.id,
        type: node.type,
        text: node.text,
        status: node.status,
        decision_outcome: node.decision_outcome ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: project.edges
      .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }))
      .sort((left, right) => `${left.source}:${left.type}:${left.target}`.localeCompare(`${right.source}:${right.type}:${right.target}`)),
    answers: project.history
      .map((entry) => ({ question: entry.question, answer: entry.answer, graph_diff_summary: entry.graph_diff_summary }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading workspace overview">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="h-2.5 w-28 animate-pulse rounded bg-slate-800" />
            <div className="h-6 w-44 animate-pulse rounded bg-slate-800" />
          </div>
          <div className="h-8 w-24 animate-pulse rounded-full bg-slate-800" />
        </div>
        <div className="mt-5 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-slate-800" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-slate-800" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-slate-800" />
        </div>
      </section>
      {[0, 1].map((item) => (
        <section key={item} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="h-4 w-32 animate-pulse rounded bg-slate-800" />
          <div className="mt-4 space-y-3">
            <div className="h-3 w-full animate-pulse rounded bg-slate-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-800" />
          </div>
        </section>
      ))}
    </div>
  );
}

function OverviewLinks({
  onViewGaps,
  onViewHistory,
  onViewToday,
}: Pick<ProjectOverviewProps, 'onViewGaps' | 'onViewHistory' | 'onViewToday'>) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
      <button
        type="button"
        onClick={onViewGaps}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-200 sm:min-h-0"
      >
        View gaps <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onViewHistory}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-200 sm:min-h-0"
      >
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        View history
      </button>
      {onViewToday && (
        <button
          type="button"
          onClick={onViewToday}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-200 sm:min-h-0"
        >
          See what needs attention <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function ProjectOverview({
  userId,
  project,
  refreshKey = 0,
  onViewGaps,
  onViewHistory,
  onViewToday,
}: ProjectOverviewProps) {
  const [assessment, setAssessment] = useState<ProjectOverviewAssessment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasFailed, setHasFailed] = useState(false);
  const [loadedRequestIdentity, setLoadedRequestIdentity] = useState<string | null>(null);
  const [failedRequestIdentity, setFailedRequestIdentity] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const projectStateKey = useMemo(() => overviewProjectStateKey(project), [project]);
  const requestIdentity = `${userId}:${project.id}:${projectStateKey}:${refreshKey}`;

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestSequence.current;
    setIsLoading(true);
    setHasFailed(false);
    setAssessment(null);
    setLoadedRequestIdentity(null);
    setFailedRequestIdentity(null);

    void authFetch('/api/internal/project-overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, projectId: project.id }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Project overview assessment failed.');
        const body = await response.json() as { assessment?: ProjectOverviewAssessment | null };
        if (requestId !== requestSequence.current || controller.signal.aborted) return;
        if (!body.assessment) throw new Error('Project overview assessment unavailable.');
        setAssessment(body.assessment);
        setLoadedRequestIdentity(requestIdentity);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (requestId !== requestSequence.current || controller.signal.aborted) return;
        setAssessment(null);
        setHasFailed(true);
        setFailedRequestIdentity(requestIdentity);
      })
      .finally(() => {
        if (requestId === requestSequence.current && !controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [project.id, projectStateKey, refreshKey, requestIdentity, userId]);

  const hasCurrentAssessment = Boolean(assessment && loadedRequestIdentity === requestIdentity);
  const hasCurrentError = hasFailed && failedRequestIdentity === requestIdentity;

  if (isLoading || (!hasCurrentAssessment && !hasCurrentError)) return <OverviewSkeleton />;

  if (hasCurrentError || !assessment) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">Workspace assessment</p>
        <h2 className="mt-2 text-lg font-extrabold text-slate-100">Overview is being updated.</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          The current overview is unavailable. Try again shortly.
        </p>
        <div className="mt-4">
          <OverviewLinks onViewGaps={onViewGaps} onViewHistory={onViewHistory} onViewToday={onViewToday} />
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">Workspace assessment</p>
            <h2 className="mt-2 text-xl font-extrabold text-slate-100">Where things stand</h2>
          </div>
          <span className="inline-flex w-fit rounded-full border border-cyan-800/80 bg-cyan-950/40 px-3 py-1.5 text-xs font-extrabold text-cyan-200">
            {trajectoryLabels[assessment.trajectory.state]}
          </span>
        </div>
        <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-200">{assessment.summary}</p>
      </section>

      {assessment.meaningfulChanges.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-base font-extrabold text-slate-100">What changed</h2>
          <div className="mt-4 space-y-4">
            {assessment.meaningfulChanges.map((change) => (
              <article key={`${change.title}-${change.historyEventIds.join('-')}`} className="border-l-2 border-cyan-700 pl-4">
                <h3 className="text-sm font-bold text-slate-100">{change.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{change.whatChanged}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{change.consequence}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-base font-extrabold text-slate-100">Impact on the goal</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{assessment.goalImpact.summary}</p>
        {(assessment.goalImpact.positiveFactors.length > 0 || assessment.goalImpact.negativeFactors.length > 0) && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {assessment.goalImpact.positiveFactors.length > 0 && (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-400">Helping</p>
                <ul className="mt-2 space-y-2 text-sm leading-relaxed text-slate-300">
                  {assessment.goalImpact.positiveFactors.map((factor) => <li key={factor.text}>• {factor.text}</li>)}
                </ul>
              </div>
            )}
            {assessment.goalImpact.negativeFactors.length > 0 && (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-amber-300">Making progress harder</p>
                <ul className="mt-2 space-y-2 text-sm leading-relaxed text-slate-300">
                  {assessment.goalImpact.negativeFactors.map((factor) => <li key={factor.text}>• {factor.text}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {assessment.unsettled.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-base font-extrabold text-slate-100">Still unsettled</h2>
          <div className="mt-4 space-y-3">
            {assessment.unsettled.map((item) => (
              <article key={item.title} className="border-l-2 border-amber-700 pl-4">
                <h3 className="text-sm font-bold text-slate-100">{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{item.explanation}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {assessment.criticalIssues.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 text-amber-300" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-slate-100">Needs attention</h2>
          </div>
          <div className="mt-4 space-y-3">
            {assessment.criticalIssues.map((issue) => (
              <article key={`${issue.severity}-${issue.title}`} className={`rounded-lg border p-3 ${severityClasses(issue.severity)}`}>
                <p className="text-sm font-bold">{issue.title}</p>
                <p className="mt-1 text-sm leading-relaxed opacity-85">{issue.explanation}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {assessment.emergingInsights.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-slate-100">What is becoming clear</h2>
          </div>
          <div className="mt-4 space-y-3">
            {assessment.emergingInsights.map((insight) => (
              <article key={insight.text}>
                <p className="text-sm font-bold text-slate-200">{insight.text}</p>
                {insight.explanation && <p className="mt-1 text-sm leading-relaxed text-slate-400">{insight.explanation}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      <OverviewLinks onViewGaps={onViewGaps} onViewHistory={onViewHistory} onViewToday={onViewToday} />
    </div>
  );
}
