'use client';

import React, { useState } from 'react';
import { HelpCircle, CheckCircle2, AlertTriangle, ArrowUpRight, Sparkles, FileText, Send, XCircle, BookOpen } from 'lucide-react';
import { Project, CandidateGap, UserMemoryProfile } from '@/types/clarity';
import { DurableMemory } from '@/types/contextPack';
import { processUserAnswer } from '@/lib/gemini';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { EvidenceDrawer } from '@/components/EvidenceDrawer';
import { projectForReasoning } from '@/lib/context/sourceState';
import { formatDateTime } from '@/lib/datetime/displayDateTime';
import { projectTitlePresentation } from '@/lib/projects/projectTitle';

interface ProjectHomeProps {
  project: Project;
  profile: UserMemoryProfile;
  userId: string;
  memories: DurableMemory[];
  onUpdateProject: (updated: Project) => void;
  onOpenIdontKnow: (gap: CandidateGap) => void;
  onNavigateToGraph: () => void;
  onNavigateToInbox: () => void;
}

export const ProjectHome: React.FC<ProjectHomeProps> = ({
  project,
  profile,
  userId,
  memories,
  onUpdateProject,
  onOpenIdontKnow,
  onNavigateToGraph,
  onNavigateToInbox,
}) => {
  const [answerInput, setAnswerInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);

  const activeQuestion = project.active_question;
  const reasoningProject = projectForReasoning(project);
  const activeContextPack = activeQuestion
    ? buildContextPack({
        userId,
        query: activeQuestion.question,
        project,
        profile,
        durableMemories: memories,
      })
    : null;

  const criticalGapsCount = reasoningProject.nodes.filter(
    (n) => n.type === 'UNKNOWN' && n.status === 'OPEN'
  ).length;

  const weakAssumptionsCount = reasoningProject.nodes.filter(
    (n) => n.type === 'ASSUMPTION' && n.confidence < 0.7 && n.status === 'OPEN'
  ).length;

  const decisionsCount = reasoningProject.nodes.filter(
    (n) => n.type === 'DECISION'
  ).length;

  const handleAnswerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answerInput.trim() || !activeQuestion) return;

    setIsSubmitting(true);
    try {
      const updated = await processUserAnswer(
        project,
        activeQuestion.node_id,
        answerInput.trim(),
        profile
      );
      onUpdateProject(updated);
      setAnswerInput('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNotImportant = () => {
    if (!activeQuestion) return;
    const updated: Project = JSON.parse(JSON.stringify(project));
    const target = updated.nodes.find((n) => n.id === activeQuestion.node_id);
    if (target) {
      target.status = 'DEPRECATED';
    }
    onUpdateProject(updated);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      {/* Top Banner / Project Overview */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight">
                {projectTitlePresentation(project.title).title}
              </h1>
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/80">
                Active Workspace
              </span>
            </div>
            <p className="text-sm text-slate-400">
              <strong className="text-slate-300">Goal:</strong> {project.goal}
            </p>
            {project.one_sentence_context && (
              <p className="text-xs text-slate-500 italic">
                &ldquo;{project.one_sentence_context}&rdquo;
              </p>
            )}
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid min-w-0 grid-cols-3 gap-3 bg-slate-950/80 border border-slate-800 p-3 rounded-xl sm:min-w-[320px]">
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/60 text-center">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-rose-400 block">
                Critical Gaps
              </span>
              <span className="text-xl font-bold text-slate-100">{criticalGapsCount}</span>
            </div>

            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/60 text-center">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-400 block">
                Weak Assumptions
              </span>
              <span className="text-xl font-bold text-slate-100">{weakAssumptionsCount}</span>
            </div>

            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/60 text-center">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400 block">
                Decisions Made
              </span>
              <span className="text-xl font-bold text-slate-100">{decisionsCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* CORE AGENT MOMENT: NEXT QUESTION CARD */}
      <div className="relative">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500 rounded-3xl blur opacity-30 animate-pulse" />
        <div className="relative bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-cyan-950 border border-cyan-700/60 rounded-xl text-cyan-400">
                <Sparkles className="w-5 h-5 animate-spin" style={{ animationDuration: '6s' }} />
              </div>
              <div>
                <span className="text-[10px] uppercase font-extrabold tracking-widest text-cyan-400">
                  Agent Priority Question #1
                </span>
                <h2 className="text-lg font-bold text-slate-200">
                  Highest-Impact Unresolved Uncertainty
                </h2>
              </div>
            </div>

            {activeQuestion && (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">Priority Score:</span>
                <span className="px-2.5 py-1 rounded-full bg-cyan-950 text-cyan-300 text-xs font-bold border border-cyan-800">
                  {Math.round(activeQuestion.priority * 100)} / 100
                </span>
              </div>
            )}
          </div>

          {activeQuestion ? (
            <div className="space-y-6">
              {/* Question Text */}
              <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
                <h3 className="text-xl sm:text-2xl font-semibold text-cyan-100 leading-snug">
                  {activeQuestion.question}
                </h3>
              </div>

              {/* Why this matters */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Why this question matters now:</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsEvidenceOpen(true)}
                    className="flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-cyan-300 sm:min-h-0 sm:py-1.5"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    Evidence
                  </button>
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {activeQuestion.reasons.map((reason, idx) => (
                    <li
                      key={idx}
                      className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-300 flex items-start space-x-2"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1 flex-shrink-0" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Answer Input Form */}
              <form onSubmit={handleAnswerSubmit} className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    placeholder="Enter your decision or clarification answer..."
                    className="min-h-11 flex-1 px-4 py-3 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl text-slate-100 text-sm placeholder-slate-500 outline-none transition-colors sm:min-h-0"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !answerInput.trim()}
                    className="min-h-11 px-6 py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-semibold rounded-xl text-sm transition-all shadow-lg flex items-center justify-center space-x-2 disabled:opacity-50 sm:min-h-0"
                  >
                    <Send className="w-4 h-4" />
                    <span>Answer & Update Map</span>
                  </button>
                </div>

                {/* Secondary Option Buttons */}
                <div className="flex items-center space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onOpenIdontKnow(activeQuestion)}
                    className="px-4 py-2 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 rounded-xl text-xs font-medium border border-slate-700 transition-all flex items-center space-x-1.5"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-purple-400" />
                    <span>I don&apos;t know (Explore strategies)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleNotImportant}
                    className="px-4 py-2 bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-xl text-xs font-medium border border-slate-700 transition-all flex items-center space-x-1.5"
                  >
                    <XCircle className="w-3.5 h-3.5 text-slate-500" />
                    <span>Not important / Dismiss</span>
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="p-8 text-center space-y-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <h3 className="text-lg font-bold text-slate-200">No Critical Gaps Remaining!</h3>
              <p className="text-xs text-slate-400">
                All decision-critical uncertainties have been clarified or supported by evidence.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Grid Section: Recent Changes & Context Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Graph Changes */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-200 text-sm flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-400" />
              <span>Recent Decision & Graph Updates</span>
            </h3>
            <button
              onClick={onNavigateToGraph}
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
            >
              <span>View Graph</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {project.history.length > 0 ? (
            <div className="space-y-3">
              {project.history.slice(-3).reverse().map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl space-y-1 text-xs"
                >
                  <div className="flex justify-between text-slate-400">
                    <span className="font-semibold text-cyan-300">Q: {item.question}</span>
                    <span className="text-[10px] text-slate-500">
                      {formatDateTime(item.timestamp)}
                    </span>
                  </div>
                  <p className="text-slate-200 font-medium">A: {item.answer}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800/60">
              No recent turns yet. Answer the agent question above to update the Clarity Graph.
            </div>
          )}
        </div>

        {/* Context Inbox Summary */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-200 text-sm flex items-center space-x-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              <span>Indexed Context Sources ({project.sources.length})</span>
            </h3>
            <button
              onClick={onNavigateToInbox}
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
            >
              <span>Add Context</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            {project.sources.map((src) => (
              <div
                key={src.id}
                className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs"
              >
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <span className="font-medium text-slate-200">{src.filename}</span>
                </div>
                <span className="text-[10px] text-slate-500 uppercase px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                  {src.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <EvidenceDrawer
        contextPack={activeContextPack}
        isOpen={isEvidenceOpen}
        onClose={() => setIsEvidenceOpen(false)}
      />
    </div>
  );
};
