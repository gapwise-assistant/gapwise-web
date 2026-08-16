'use client';

import React, { useRef } from 'react';
import { BookOpen, Brain, FileText, GitBranch, X } from 'lucide-react';
import { ContextPack } from '@/types/contextPack';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';

interface EvidenceDrawerProps {
  contextPack: ContextPack | null;
  isOpen: boolean;
  onClose: () => void;
}

export const EvidenceDrawer: React.FC<EvidenceDrawerProps> = ({ contextPack, isOpen, onClose }) => {
  const panelRef = useRef<HTMLElement | null>(null);
  useDismissibleModal(onClose, panelRef, isOpen && Boolean(contextPack));

  if (!isOpen || !contextPack) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <aside ref={panelRef} className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-cyan-400" />
              Evidence Pack
            </h2>
            <p className="text-xs text-slate-500">{contextPack.includedContextIds.length} context IDs included</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-slate-100"
            title="Close evidence drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5" />
              Structured Context
            </h3>
            {[...contextPack.activeGoals, ...contextPack.unresolvedGaps, ...contextPack.recentDecisions].map((node) => (
              <div key={node.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <span className="text-[10px] font-bold text-slate-500">{node.type}</span>
                <p className="mt-1 text-xs text-slate-200">{node.text}</p>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              Source Evidence
            </h3>
            {contextPack.relevantEvidence.length > 0 ? (
              contextPack.relevantEvidence.map((evidence) => (
                <div key={evidence.source_id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-slate-300">{evidence.filename}</span>
                    <span className="text-cyan-400">{Math.round(evidence.score * 100)}% match</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{evidence.excerpt}</p>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-500">
                No directly matching source excerpt was included.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-fuchsia-300 flex items-center gap-2">
              <Brain className="w-3.5 h-3.5" />
              Durable Memory
            </h3>
            {contextPack.userPreferences.length > 0 ? (
              contextPack.userPreferences.map((memory) => (
                <div key={memory.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <span className="text-[10px] font-bold text-fuchsia-300">{memory.category}</span>
                  <p className="mt-1 text-xs text-slate-200">{memory.text}</p>
                  <p className="mt-2 text-[10px] text-slate-500">{memory.why_remembered}</p>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-500">
                No durable memory was relevant to this pack.
              </p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
};
