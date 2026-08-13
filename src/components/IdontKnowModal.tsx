'use client';

import React from 'react';
import { Search, FlaskConical, Bookmark, ArrowRight, X } from 'lucide-react';
import { CandidateGap } from '@/types/clarity';

interface IdontKnowModalProps {
  gap: CandidateGap;
  onSelectStrategy: (strategy: 'rag' | 'experiment' | 'assumption' | 'defer') => void;
  onClose: () => void;
}

export const IdontKnowModal: React.FC<IdontKnowModalProps> = ({
  gap,
  onSelectStrategy,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-950/80 border border-indigo-800/60 rounded-xl text-indigo-400">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-lg">Unresolved Gap Strategy</h3>
              <p className="text-xs text-slate-400">How would you like Gapswise to proceed?</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl">
          <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Uncertainty Gap</span>
          <p className="text-sm font-medium text-slate-200 mt-1">{gap.question}</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => onSelectStrategy('rag')}
            className="w-full flex items-start space-x-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/40 transition-all text-left group"
          >
            <div className="p-2 bg-cyan-950/80 rounded-lg text-cyan-400 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors mt-0.5">
              <Search className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-slate-200 group-hover:text-cyan-300">1. Search uploaded context inbox (RAG)</h4>
              <p className="text-xs text-slate-400 mt-0.5">Check if an answer or relevant evidence already exists in uploaded PDFs/notes.</p>
            </div>
          </button>

          <button
            onClick={() => onSelectStrategy('experiment')}
            className="w-full flex items-start space-x-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-purple-500/50 hover:bg-slate-800/40 transition-all text-left group"
          >
            <div className="p-2 bg-purple-950/80 rounded-lg text-purple-400 group-hover:bg-purple-500 group-hover:text-slate-950 transition-colors mt-0.5">
              <FlaskConical className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-slate-200 group-hover:text-purple-300">2. Propose a tiny resolution experiment</h4>
              <p className="text-xs text-slate-400 mt-0.5">Generate a lightweight test (e.g. 3 target user interviews or script test) to gather evidence.</p>
            </div>
          </button>

          <button
            onClick={() => onSelectStrategy('assumption')}
            className="w-full flex items-start space-x-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-800/40 transition-all text-left group"
          >
            <div className="p-2 bg-amber-950/80 rounded-lg text-amber-400 group-hover:bg-amber-500 group-hover:text-slate-950 transition-colors mt-0.5">
              <Bookmark className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-slate-200 group-hover:text-amber-300">3. Create a temporary assumption</h4>
              <p className="text-xs text-slate-400 mt-0.5">Add an explicit ASSUMPTION node (50% confidence) so project execution is unblocked.</p>
            </div>
          </button>

          <button
            onClick={() => onSelectStrategy('defer')}
            className="w-full flex items-start space-x-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-600 hover:bg-slate-800/40 transition-all text-left group"
          >
            <div className="p-2 bg-slate-800 rounded-lg text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-200 transition-colors mt-0.5">
              <ArrowRight className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-slate-200 group-hover:text-slate-100">4. Defer this gap for now</h4>
              <p className="text-xs text-slate-400 mt-0.5">Skip this question and move directly to the next highest priority uncertainty.</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
