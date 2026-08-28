'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, CircleDot, FileText, Filter, Goal, Layers, Network, ShieldAlert, Sliders } from 'lucide-react';
import { MyWorldGraph, Project, WorldDomainType, WorldNode, WorldNodeType } from '@/types/clarity';
import { buildMyWorldGraph } from '@/lib/world/graph';

interface MyWorldViewProps {
  userId: string;
  project: Project;
  onNavigateToProjectGraph: () => void;
  onNavigateToInbox: () => void;
}

const nodeStyles: Record<WorldNodeType, { icon: React.ReactNode; classes: string }> = {
  DOMAIN: { icon: <Boxes className="w-4 h-4" />, classes: 'border-emerald-700 bg-emerald-950/60 text-emerald-200' },
  PROJECT: { icon: <Layers className="w-4 h-4" />, classes: 'border-cyan-700 bg-cyan-950/60 text-cyan-200' },
  GOAL: { icon: <Goal className="w-4 h-4" />, classes: 'border-blue-700 bg-blue-950/60 text-blue-200' },
  SOURCE: { icon: <FileText className="w-4 h-4" />, classes: 'border-slate-700 bg-slate-900 text-slate-200' },
  GAP: { icon: <CircleDot className="w-4 h-4" />, classes: 'border-rose-700 bg-rose-950/60 text-rose-200' },
  PREFERENCE: { icon: <Sliders className="w-4 h-4" />, classes: 'border-fuchsia-700 bg-fuchsia-950/60 text-fuchsia-200' },
  RISK: { icon: <ShieldAlert className="w-4 h-4" />, classes: 'border-amber-700 bg-amber-950/60 text-amber-200' },
};

function priorityLabel(priority: number): string {
  if (priority >= 0.75) return 'High';
  if (priority >= 0.45) return 'Medium';
  return 'Low';
}

export const MyWorldView: React.FC<MyWorldViewProps> = ({
  userId,
  project,
  onNavigateToProjectGraph,
  onNavigateToInbox,
}) => {
  const worldGraph: MyWorldGraph = useMemo(() => buildMyWorldGraph(userId, [project]), [project, userId]);
  const [domainFilter, setDomainFilter] = useState<WorldDomainType | 'all'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(`project_${project.id}`);

  const filteredNodes = worldGraph.nodes.filter((node) => domainFilter === 'all' || node.domain === domainFilter);
  const selectedNode = worldGraph.nodes.find((node) => node.id === selectedNodeId) ?? filteredNodes[0];
  const highPriorityNodes = worldGraph.nodes.filter((node) => node.priority >= 0.7 && node.type !== 'DOMAIN');
  const openGapCount = worldGraph.nodes.filter((node) => node.type === 'GAP' && node.status === 'active').length;
  const watchCount = worldGraph.nodes.filter((node) => node.status === 'watch').length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-950 border border-emerald-800 rounded-xl text-emerald-400">
              <Network className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-100">My World</h1>
              <p className="text-xs text-slate-400">
                Cross-context map of domains, workspaces, sources, risks, preferences, and unresolved gaps.
              </p>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-3 gap-2 sm:min-w-[300px]">
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-center">
              <span className="block text-[10px] uppercase font-bold text-slate-500">Domains</span>
              <span className="text-lg font-bold text-emerald-300">{worldGraph.domains.length}</span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-center">
              <span className="block text-[10px] uppercase font-bold text-slate-500">Open Gaps</span>
              <span className="text-lg font-bold text-rose-300">{openGapCount}</span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-center">
              <span className="block text-[10px] uppercase font-bold text-slate-500">Watch</span>
              <span className="text-lg font-bold text-amber-300">{watchCount}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          <button
            onClick={() => setDomainFilter('all')}
            className={`min-h-10 rounded-lg border px-3 py-1.5 text-xs font-semibold sm:min-h-0 ${
              domainFilter === 'all' ? 'border-cyan-700 bg-cyan-950 text-cyan-200' : 'border-slate-800 bg-slate-950 text-slate-400'
            }`}
          >
            All
          </button>
          {worldGraph.domains.map((domain) => (
            <button
              key={domain.domain}
              onClick={() => setDomainFilter(domain.domain)}
              className={`min-h-10 rounded-lg border px-3 py-1.5 text-xs font-semibold sm:min-h-0 ${
                domainFilter === domain.domain
                  ? 'border-emerald-700 bg-emerald-950 text-emerald-200'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              {domain.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 min-w-0">
        <div className="lg:col-span-3 bg-slate-950 border border-slate-800 rounded-2xl p-4 sm:p-5 min-h-[560px] shadow-2xl relative overflow-hidden min-w-0">
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: 'linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredNodes.map((node) => {
              const style = nodeStyles[node.type];
              const isSelected = selectedNode?.id === node.id;
              return (
                <button
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`text-left rounded-xl border p-4 min-h-[132px] transition-all ${style.classes} ${
                    isSelected ? 'ring-2 ring-cyan-400 scale-[1.01]' : 'hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[10px] uppercase font-extrabold tracking-wider">
                      {style.icon}
                      {node.type}
                    </span>
                    <span className="text-[10px] rounded-full border border-current px-2 py-0.5">
                      {priorityLabel(node.priority)}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-bold leading-snug text-slate-100 line-clamp-2">
                    {node.label}
                  </h3>
                  <p className="mt-2 text-xs text-slate-400 line-clamp-2">{node.summary}</p>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
                    <span>{node.domain}</span>
                    <span>{node.source_refs.length} sources</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <h2 className="text-sm font-bold text-slate-200">Selected Context</h2>
            {selectedNode ? (
              <div className="space-y-3">
                <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${nodeStyles[selectedNode.type].classes}`}>
                  {nodeStyles[selectedNode.type].icon}
                  {selectedNode.type}
                </span>
                <h3 className="text-sm font-bold text-slate-100 leading-snug">{selectedNode.label}</h3>
                <p className="text-xs text-slate-400">{selectedNode.summary}</p>
                <div className="space-y-2 border-t border-slate-800 pt-3 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Domain</span>
                    <span className="text-slate-200">{selectedNode.domain}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Priority</span>
                    <span className="text-cyan-300">{Math.round(selectedNode.priority * 100)}%</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Status</span>
                    <span className="text-slate-200">{selectedNode.status}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Select a node to inspect its context.</p>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Attention Hotspots
            </h2>
            {highPriorityNodes.slice(0, 4).map((node) => (
              <button
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                className="w-full text-left rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs hover:border-cyan-800"
              >
                <span className="block font-semibold text-slate-200 line-clamp-2">{node.label}</span>
                <span className="mt-1 block text-slate-500">{Math.round(node.priority * 100)}% priority</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onNavigateToProjectGraph}
              className="rounded-xl border border-cyan-800 bg-cyan-950/60 px-3 py-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-950"
            >
              Workspace Graph
            </button>
            <button
              onClick={onNavigateToInbox}
              className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              Context Inbox
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
