'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Filter, Sparkles, AlertCircle, Info, ChevronRight, CheckCircle2, Focus, Map, Maximize2, Minimize2, Route, X } from 'lucide-react';
import { Project, ClarityNode, NodeType } from '@/types/clarity';
import { relationshipReasons } from '@/lib/graph/relationshipContext';
import { buildDecisionPath } from '@/lib/graph/constellation';

const LazyConstellationGraph = dynamic(() => import('@/components/ConstellationGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-xl border border-cyan-950/80 bg-[#040b17] text-sm text-slate-400 sm:h-[600px]">
      Loading constellation...
    </div>
  ),
});

interface ClarityGraphCanvasProps {
  project: Project;
  onSelectNode: (node: ClarityNode) => void;
  onSelectSource?: (sourceId: string) => void;
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

const constellationNodeColors: Record<NodeType, string> = {
  GOAL: '#34d399',
  KNOWN: '#94a3b8',
  CONSTRAINT: '#60a5fa',
  ASSUMPTION: '#fbbf24',
  DECISION: '#818cf8',
  UNKNOWN: '#fb7185',
  EVIDENCE: '#2dd4bf',
  EXPERIMENT: '#c084fc',
  RISK: '#fb923c',
  NEXT_ACTION: '#22d3ee',
  PREFERENCE: '#e879f9',
};

function readableStatus(status: ClarityNode['status']): string {
  if (status === 'DEFERRED') return 'Questionable';
  if (status === 'DEPRECATED') return 'Stale';
  return status === 'RESOLVED' ? 'Resolved' : 'Open';
}

export const ClarityGraphCanvas: React.FC<ClarityGraphCanvasProps> = ({
  project,
  onSelectNode,
  onSelectSource,
}) => {
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'critical' | 'assumptions'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'readable' | 'constellation'>('constellation');
  const [dimension, setDimension] = useState<'2d' | '3d'>('2d');
  const [focusMode, setFocusMode] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  const filteredNodes = project.nodes.filter((node) => {
    if (filter === 'unresolved') return node.type === 'UNKNOWN' && node.status === 'OPEN';
    if (filter === 'critical') return node.type === 'GOAL' || node.type === 'DECISION' || node.type === 'UNKNOWN';
    if (filter === 'assumptions') return node.type === 'ASSUMPTION';
    return true;
  });

  const selectedNode = project.nodes.find((n) => n.id === selectedNodeId);
  const constellationProject: Project = {
    ...project,
    nodes: filteredNodes,
    edges: project.edges.filter((edge) => filteredNodes.some((node) => node.id === edge.source) && filteredNodes.some((node) => node.id === edge.target)),
  };
  const decisionPath = selectedNodeId ? buildDecisionPath(project, selectedNodeId) : { nodeIds: [], edgeIds: [] };

  const handleConstellationSelect = (node: ClarityNode) => {
    setSelectedNodeId(node.id);
    setFocusMode(true);
    setPathMode(true);
    onSelectNode(node);
  };

  if (viewMode === 'constellation') {
    return (
      <div className="mx-auto max-w-7xl space-y-5 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-cyan-400" />
                <h2 className="text-xl font-bold text-slate-100">{dimension === '2d' ? 'Decision Map' : 'Constellation Graph'}</h2>
                <span className="rounded-full border border-cyan-800 bg-cyan-950/60 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-cyan-300">
                  {dimension === '2d' ? 'Reasoning map' : 'Live map'}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-xs text-slate-400">
                See what is known, what is uncertain, what is blocked, and how it connects to the goal.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setDimension('2d')}
                  className={`min-h-10 rounded-md px-3 py-1.5 text-xs font-bold sm:min-h-0 ${dimension === '2d' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}
                  aria-pressed={dimension === '2d'}
                >
                  2D
                </button>
                <button
                  type="button"
                  onClick={() => setDimension('3d')}
                  className={`min-h-10 rounded-md px-3 py-1.5 text-xs font-bold sm:min-h-0 ${dimension === '3d' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'}`}
                  aria-pressed={dimension === '3d'}
                >
                  3D
                </button>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('readable')}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-200 sm:min-h-0"
              >
                <Map className="h-3.5 w-3.5" />
                Readable view
              </button>
              {selectedNode && (
                <button
                  type="button"
                  onClick={() => setFocusMode((current) => !current)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold sm:min-h-0 ${focusMode ? 'border-cyan-700 bg-cyan-950 text-cyan-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`}
                  aria-pressed={focusMode}
                >
                  <Focus className="h-3.5 w-3.5" />
                  {focusMode ? 'Show all' : 'Focus neighborhood'}
                </button>
              )}
              {selectedNode && (
                <button
                  type="button"
                  onClick={() => setPathMode((current) => !current)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold sm:min-h-0 ${pathMode ? 'border-rose-700 bg-rose-950 text-rose-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`}
                  aria-pressed={pathMode}
                >
                  <Route className="h-3.5 w-3.5" />
                  {pathMode ? 'Exit focus path' : 'Focus path'}
                </button>
              )}
            </div>
          </div>
          <div className="touch-scroll flex max-w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-1">
            <Filter className="ml-2 mr-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
            {([
              ['all', `All (${project.nodes.length})`],
              ['unresolved', 'Unresolved'],
              ['critical', 'Critical path'],
              ['assumptions', 'Assumptions'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`min-h-10 shrink-0 whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium sm:min-h-0 ${filter === id ? 'border border-cyan-800 bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            {!isFullscreen && (
              <div className="relative">
                <LazyConstellationGraph
                  project={constellationProject}
                  selectedNodeId={selectedNodeId}
                  focusMode={focusMode}
                  pathMode={pathMode}
                  dimension={dimension}
                  onSelectNode={handleConstellationSelect}
                />
                <button
                  type="button"
                  onClick={() => setIsFullscreen(true)}
                  className="absolute right-3 top-3 z-20 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-700/90 bg-slate-950/90 p-2 text-slate-200 shadow-lg backdrop-blur transition hover:border-cyan-600 hover:text-cyan-300"
                  aria-label="Open constellation graph full screen"
                  title="Open full screen"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            )}
            {pathMode && selectedNode && (
              <div className="overflow-hidden rounded-xl border border-rose-900/70 bg-rose-950/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-rose-300">Why this matters</p>
                    <p className="mt-1 text-xs text-slate-400">The shortest connected reasoning path from this node toward a project goal.</p>
                  </div>
                  <button type="button" onClick={() => setPathMode(false)} className="rounded-md p-2 text-slate-500 hover:text-slate-200" aria-label="Close decision path">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {decisionPath.nodeIds.length > 1 ? (
                  <div className="touch-scroll mt-3 flex items-center gap-2 overflow-x-auto pb-1">
                    {decisionPath.nodeIds.map((nodeId, index) => {
                      const node = project.nodes.find((item) => item.id === nodeId);
                      const edge = index > 0 ? project.edges.find((item) => item.id === decisionPath.edgeIds[index - 1]) : undefined;
                      if (!node) return null;
                      return (
                        <React.Fragment key={node.id}>
                          {edge && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">{edge.type.replace('_', ' ')} →</span>}
                          <button
                            type="button"
                            onClick={() => handleConstellationSelect(node)}
                            className={`w-44 shrink-0 rounded-lg border px-3 py-2 text-left ${nodeTypeColors[node.type].border} ${nodeTypeColors[node.type].bg}`}
                          >
                            <span className={`text-[9px] font-extrabold uppercase tracking-[0.14em] ${nodeTypeColors[node.type].text}`}>{node.type}</span>
                            <span className="mt-1 block line-clamp-2 text-xs font-semibold text-slate-200">{node.text}</span>
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">No connected goal path is available for this node yet.</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 px-1 text-[10px] text-slate-500">
              {(['GOAL', 'UNKNOWN', 'DECISION', 'ASSUMPTION', 'EVIDENCE', 'RISK', 'NEXT_ACTION'] as NodeType[]).map((type) => (
                <span key={type} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: constellationNodeColors[type] ?? '#94a3b8' }} />
                  {type.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5">
            {selectedNode ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                  <span className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${nodeTypeColors[selectedNode.type].bg} ${nodeTypeColors[selectedNode.type].text} ${nodeTypeColors[selectedNode.type].border}`}>
                    {selectedNode.type}
                  </span>
                  <button type="button" onClick={() => setSelectedNodeId(null)} className="rounded-md p-2 text-slate-500 hover:text-slate-200" aria-label="Close node details">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Statement</p>
                  <h3 className="mt-2 text-sm font-bold leading-relaxed text-slate-100">{selectedNode.text}</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3"><span className="block text-[10px] uppercase text-slate-500">Status</span><span className="mt-1 block font-semibold text-slate-200">{readableStatus(selectedNode.status)}</span></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3"><span className="block text-[10px] uppercase text-slate-500">Confidence</span><span className="mt-1 block font-semibold text-cyan-300">{Math.round(selectedNode.confidence * 100)}%</span></div>
                </div>
                {selectedNode.why_it_matters && selectedNode.why_it_matters.length > 0 && (
                  <div className="space-y-2 border-t border-slate-800 pt-3">
                    <span className="text-xs font-semibold text-slate-400">Why it matters</span>
                    {selectedNode.why_it_matters.map((reason) => <p key={reason} className="text-xs leading-relaxed text-slate-300">{reason}</p>)}
                  </div>
                )}
                <div className="space-y-2 border-t border-slate-800 pt-3">
                  <span className="text-xs font-semibold text-slate-400">Connected relationships</span>
                  {relationshipReasons(project, selectedNode.id).length > 0 ? relationshipReasons(project, selectedNode.id).map((relationship) => <p key={relationship} className="text-xs leading-relaxed text-slate-300">{relationship}</p>) : <p className="text-xs text-slate-500">No relationships recorded yet.</p>}
                </div>
                <div className="space-y-2 border-t border-slate-800 pt-3">
                  <span className="text-xs font-semibold text-slate-400">Supporting sources</span>
                  {selectedNode.source_refs.length > 0 ? selectedNode.source_refs.map((sourceId) => {
                    const source = project.sources.find((item) => item.id === sourceId);
                    return onSelectSource ? (
                      <button key={sourceId} type="button" onClick={() => onSelectSource(sourceId)} className="block w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-left text-xs text-cyan-300 hover:border-cyan-700">
                        {source?.filename ?? 'Source context'}
                        <span className="mt-1 block text-[10px] text-slate-500">Open source details</span>
                      </button>
                    ) : (
                      <p key={sourceId} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">{source?.filename ?? 'Source context'}</p>
                    );
                  }) : <p className="text-xs text-slate-500">No direct source attached.</p>}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                <Focus className="h-8 w-8 text-slate-700" />
                <h3 className="mt-3 text-sm font-bold text-slate-200">Select a node</h3>
                <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-500">Choose a node to inspect its evidence, relationships, and path toward the goal.</p>
              </div>
            )}
          </div>
        </div>

        {isFullscreen && (
          <div
            className="fixed inset-0 z-[80] bg-slate-950/95 p-2 backdrop-blur-sm sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="constellation-fullscreen-title"
          >
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-cyan-900/70 bg-slate-950 shadow-2xl">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-3 py-3 sm:px-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 text-cyan-400" />
                    <h2 id="constellation-fullscreen-title" className="truncate text-sm font-bold text-slate-100 sm:text-base">
                      {dimension === '2d' ? 'Decision Map' : 'Constellation Graph'}
                    </h2>
                  </div>
                  <p className="mt-1 hidden text-xs text-slate-500 sm:block">Explore the project graph and select a node to inspect its path.</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(false)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 transition hover:border-cyan-600 hover:text-cyan-300"
                    aria-label="Exit full screen"
                    title="Exit full screen"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(false)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 transition hover:border-cyan-600 hover:text-cyan-300"
                    aria-label="Close constellation graph"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 p-2 sm:p-4">
                <LazyConstellationGraph
                  project={constellationProject}
                  selectedNodeId={selectedNodeId}
                  focusMode={focusMode}
                  pathMode={pathMode}
                  dimension={dimension}
                  expanded
                  onSelectNode={handleConstellationSelect}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

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

          <button
            type="button"
            onClick={() => setViewMode('constellation')}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-800 bg-cyan-950/50 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-900/60 sm:min-h-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Explore constellation
          </button>

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
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
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

                    {(node.status === 'DEFERRED' || node.status === 'DEPRECATED') && (
                      <span className="rounded-full border border-amber-800 bg-amber-950/80 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                        {readableStatus(node.status)}
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
                <span className="text-xs text-slate-400">Status: {readableStatus(selectedNode.status)}</span>
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

              {relationshipReasons(project, selectedNode.id).length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <span className="text-xs font-semibold text-slate-400">Relationships:</span>
                  <ul className="space-y-1">
                    {relationshipReasons(project, selectedNode.id).map((relationship) => (
                      <li key={relationship} className="text-xs text-slate-300">
                        {relationship}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
