'use client';

import React, { useState } from 'react';
import { Filter, Sparkles, AlertCircle, Info, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Project, ClarityNode, NodeType } from '@/types/clarity';

interface ClarityGraphCanvasProps {
  project: Project;
  onSelectNode: (node: ClarityNode) => void;
}

const nodeTypeColors: Record<NodeType, { bg: string; border: string; text: string; dot: string }> = {
  GOAL: { bg: 'bg-emerald-950/80', border: 'border-emerald-500/80', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  DECISION: { bg: 'bg-indigo-950/80', border: 'border-indigo-500/80', text: 'text-indigo-300', dot: 'bg-indigo-400' },
  UNKNOWN: { bg: 'bg-rose-950/90', border: 'border-rose-500/90', text: 'text-rose-300', dot: 'bg-rose-400' },
  ASSUMPTION: { bg: 'bg-amber-950/80', border: 'border-amber-500/80', text: 'text-amber-300', dot: 'bg-amber-400' },
  KNOWN: { bg: 'bg-slate-900', border: 'border-slate-700', text: 'text-slate-300', dot: 'bg-slate-400' },
  CONSTRAINT: { bg: 'bg-blue-950/80', border: 'border-blue-700/80', text: 'text-blue-300', dot: 'bg-blue-400' },
  EVIDENCE: { bg: 'bg-teal-950/80', border: 'border-teal-700/80', text: 'text-teal-300', dot: 'bg-teal-400' },
  EXPERIMENT: { bg: 'bg-purple-950/80', border: 'border-purple-700/80', text: 'text-purple-300', dot: 'bg-purple-400' },
  RISK: { bg: 'bg-orange-950/80', border: 'border-orange-700/80', text: 'text-orange-300', dot: 'bg-orange-400' },
  NEXT_ACTION: { bg: 'bg-cyan-950/80', border: 'border-cyan-700/80', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  PREFERENCE: { bg: 'bg-fuchsia-950/80', border: 'border-fuchsia-700/80', text: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
};

export const ClarityGraphCanvas: React.FC<ClarityGraphCanvasProps> = ({
  project,
  onSelectNode,
}) => {
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'critical' | 'assumptions'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const filteredNodes = project.nodes.filter((node) => {
    if (filter === 'unresolved') return node.type === 'UNKNOWN' && node.status === 'OPEN';
    if (filter === 'critical') return node.type === 'GOAL' || node.type === 'DECISION' || node.type === 'UNKNOWN';
    if (filter === 'assumptions') return node.type === 'ASSUMPTION';
    return true;
  });

  const selectedNode = project.nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-2xl">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <span>Interactive Clarity Graph</span>
          </h2>
          <p className="text-xs text-slate-400">
            Live map of goals, knowns, constraints, decisions, assumptions, and unknowns.
          </p>
        </div>

        {/* Filter Toggle Buttons */}
        <div className="touch-scroll flex max-w-full items-center space-x-1.5 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-1">
          <Filter className="w-3.5 h-3.5 text-slate-500 ml-2 mr-1" />
          <button
            onClick={() => setFilter('all')}
            className={`min-h-10 whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
              filter === 'all' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Nodes ({project.nodes.length})
          </button>
          <button
            onClick={() => setFilter('unresolved')}
            className={`min-h-10 whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
              filter === 'unresolved' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Unresolved Gaps
          </button>
          <button
            onClick={() => setFilter('critical')}
            className={`min-h-10 whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
              filter === 'critical' ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Critical Path
          </button>
          <button
            onClick={() => setFilter('assumptions')}
            className={`min-h-10 whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
              filter === 'assumptions' ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Assumptions
          </button>
        </div>
      </div>

      {/* Main Canvas & Detail Drawer Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-w-0">
        {/* Visual Graph Canvas Area */}
        <div className="lg:col-span-2 bg-slate-950 border border-slate-800/90 rounded-2xl p-4 sm:p-6 min-h-[480px] sm:min-h-[520px] relative overflow-hidden shadow-2xl flex flex-col justify-between min-w-0">
          {/* Subtle Canvas Grid Pattern */}
          <div
            className="absolute inset-0 opacity-15 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(#38bdf8 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />

          {/* SVG Dependency Edges */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {project.edges.map((edge) => {
              const sourceNode = filteredNodes.find((n) => n.id === edge.source);
              const targetNode = filteredNodes.find((n) => n.id === edge.target);

              if (!sourceNode || !targetNode) return null;

              const x1 = sourceNode.x || 300;
              const y1 = sourceNode.y || 200;
              const x2 = targetNode.x || 300;
              const y2 = targetNode.y || 200;

              return (
                <g key={edge.id}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                    strokeDasharray={edge.type === 'blocks' ? '4 4' : undefined}
                    opacity="0.4"
                  />
                </g>
              );
            })}
          </svg>

          {/* Render Graph Nodes */}
          <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredNodes.map((node) => {
              const style = nodeTypeColors[node.type];
              const isSelected = node.id === selectedNodeId;
              const isTopGap = project.active_question?.node_id === node.id;

              return (
                <div
                  key={node.id}
                  onClick={() => {
                    setSelectedNodeId(node.id);
                    onSelectNode(node);
                  }}
                  className={`p-4 rounded-xl border transition-all cursor-pointer relative shadow-lg ${style.bg} ${
                    isSelected ? 'ring-2 ring-cyan-400 border-cyan-400 scale-[1.02]' : style.border
                  } ${isTopGap ? 'animate-pulse border-rose-400' : ''}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                      <span className={`text-[10px] uppercase font-bold tracking-wider ${style.text}`}>
                        {node.type}
                      </span>
                    </div>

                    {isTopGap && (
                      <span className="px-2 py-0.5 text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-800 rounded-full">
                        TOP GAP #1
                      </span>
                    )}

                    {node.confidence < 0.6 && (
                      <span className="text-[10px] text-amber-400 font-medium">
                        {(node.confidence * 100).toFixed(0)}% conf
                      </span>
                    )}
                  </div>

                  <p className="text-xs font-semibold text-slate-100 leading-snug">{node.text}</p>

                  <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-800/60">
                    <span>Sources: {node.source_refs.length}</span>
                    <span className="capitalize text-cyan-400 flex items-center">
                      Inspect <ChevronRight className="w-3 h-3 ml-0.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Canvas Legend */}
          <div className="relative z-10 mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
            <span className="font-semibold text-slate-300">Legend:</span>
            <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Goal</span>
            <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-indigo-400" /> Decision</span>
            <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-rose-400" /> Unknown (Gap)</span>
            <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Assumption</span>
            <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> Experiment</span>
          </div>
        </div>

        {/* Selected Node Inspection Drawer */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xl">
          {selectedNode ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${nodeTypeColors[selectedNode.type].bg} ${nodeTypeColors[selectedNode.type].text} border ${nodeTypeColors[selectedNode.type].border}`}>
                  {selectedNode.type}
                </span>
                <span className="text-xs text-slate-400">Status: {selectedNode.status}</span>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-100">{selectedNode.text}</h3>
              </div>

              {selectedNode.why_it_matters && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-400">Why this matters:</span>
                  <ul className="space-y-1">
                    {selectedNode.why_it_matters.map((item, i) => (
                      <li key={i} className="text-xs text-slate-300 flex items-start space-x-1.5">
                        <span className="text-cyan-400 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-xs font-semibold text-slate-400">Node Confidence Score:</span>
                <div className="flex items-center space-x-3">
                  <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${selectedNode.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-cyan-300">
                    {Math.round(selectedNode.confidence * 100)}%
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-xs font-semibold text-slate-400">Linked Sources:</span>
                {selectedNode.source_refs.length > 0 ? (
                  <div className="space-y-1">
                    {selectedNode.source_refs.map((refId) => (
                      <div key={refId} className="text-xs text-slate-300 bg-slate-950 p-2 rounded-lg border border-slate-800">
                        Source Ref ID: {refId}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No direct source reference attached.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 space-y-3">
              <Info className="w-8 h-8 text-slate-600 mx-auto" />
              <h4 className="font-semibold text-sm text-slate-200">Select a Node</h4>
              <p className="text-xs text-slate-500">
                Click any graph node on the canvas to inspect its metadata, confidence, and linked source references.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
