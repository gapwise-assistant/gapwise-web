'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Focus,
  PanelRightClose,
  PanelRightOpen,
  Route,
  Sparkles,
  X,
} from 'lucide-react';
import { ClarityNode, NodeType, Project } from '@/types/clarity';
import { buildDecisionExplanation } from '@/lib/graph/constellation';
import type { GraphViewport } from '@/components/ConstellationGraph';
import { authFetch } from '@/lib/auth/client';
import type { FocusAssessment } from '@/lib/focus/focusAssessment';
import { buildDecisionMapDebugTrace, type DecisionMapRendererDiagnostics } from '@/lib/graph/decisionMapDebug';
import { buildDecisionMapProjection, type DecisionMapView } from '@/lib/graph/decisionMapProjection';
import { buildDecisionMapActivityFingerprint, decisionMapWarningCodes } from '@/lib/graph/decisionMapActivity';
import { useDismissibleModal } from '@/lib/ui/useDismissibleModal';
import { DecisionMapActivity } from '@/components/DecisionMapActivity';
import { DecisionNodeFocus } from '@/components/DecisionNodeFocus';
import { buildDecisionNodeFocus } from '@/lib/graph/decisionFocus';

const LazyConstellationGraph = dynamic(() => import('@/components/ConstellationGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-xl border border-cyan-950/80 bg-[#040b17] text-sm text-slate-400 sm:h-[600px]">
      Loading Decision Map...
    </div>
  ),
});

interface ClarityGraphCanvasProps {
  userId: string;
  project: Project;
  onSelectNode: (node: ClarityNode) => void;
  onReviewDecision?: (node: ClarityNode) => void;
  onResolveQuestion?: (node: ClarityNode) => void;
  onSelectSource?: (sourceId: string) => void;
  focusNodeId?: string | null;
}

type StoryMode =
  | { type: 'overview' }
  | { type: 'node_focus'; nodeId: string };

const nodeTypeColors: Record<NodeType, { bg: string; border: string; text: string }> = {
  GOAL: { bg: 'bg-emerald-950/80', border: 'border-emerald-500/80', text: 'text-emerald-300' },
  DECISION: { bg: 'bg-indigo-950/80', border: 'border-indigo-500/80', text: 'text-indigo-300' },
  UNKNOWN: { bg: 'bg-rose-950/90', border: 'border-rose-500/90', text: 'text-rose-300' },
  ASSUMPTION: { bg: 'bg-amber-950/80', border: 'border-amber-500/80', text: 'text-amber-300' },
  KNOWN: { bg: 'bg-slate-900', border: 'border-slate-700', text: 'text-slate-300' },
  CONSTRAINT: { bg: 'bg-blue-950/80', border: 'border-blue-700/80', text: 'text-blue-300' },
  EVIDENCE: { bg: 'bg-teal-950/80', border: 'border-teal-700/80', text: 'text-teal-300' },
  EXPERIMENT: { bg: 'bg-purple-950/80', border: 'border-purple-700/80', text: 'text-purple-300' },
  RISK: { bg: 'bg-orange-950/80', border: 'border-orange-700/80', text: 'text-orange-300' },
  NEXT_ACTION: { bg: 'bg-cyan-950/80', border: 'border-cyan-700/80', text: 'text-cyan-300' },
  PREFERENCE: { bg: 'bg-fuchsia-950/80', border: 'border-fuchsia-700/80', text: 'text-fuchsia-300' },
};

const legendTypes: NodeType[] = ['GOAL', 'UNKNOWN', 'DECISION', 'ASSUMPTION', 'EVIDENCE', 'RISK', 'NEXT_ACTION'];
const legendColors: Record<NodeType, string> = {
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
  userId,
  project,
  onSelectNode,
  onReviewDecision,
  onResolveQuestion,
  onSelectSource,
  focusNodeId,
}) => {
  const [view, setView] = useState<DecisionMapView>('story');
  const [expandedClusterIds, setExpandedClusterIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [storyMode, setStoryMode] = useState<StoryMode>({ type: 'overview' });
  const [focusMode, setFocusMode] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [viewport, setViewport] = useState<GraphViewport>({ zoom: 1, pan: { x: 0, y: 0 } });
  const [focusAssessment, setFocusAssessment] = useState<FocusAssessment | null>(null);
  const [rendererDiagnostics, setRendererDiagnostics] = useState<DecisionMapRendererDiagnostics | null>(null);
  const [traceRefreshKey, setTraceRefreshKey] = useState(0);
  const fullscreenPanelRef = useRef<HTMLDivElement | null>(null);
  const lastRendererSnapshotKeyRef = useRef<string | null>(null);

  useDismissibleModal(() => setIsFullscreen(false), fullscreenPanelRef, isFullscreen);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  useEffect(() => {
    const controller = new AbortController();
    setFocusAssessment(null);
    authFetch(`/api/internal/focus-assessment?userId=${encodeURIComponent(userId)}&projectId=${encodeURIComponent(project.id)}`, {
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { focusAssessment?: FocusAssessment | null } | null) => {
        if (body) setFocusAssessment(body.focusAssessment ?? null);
      })
      .catch(() => {
        // Focus is optional instrumentation. The map never generates focus from this read-only lookup.
      });
    return () => controller.abort();
  }, [project.id, project.updated_at, userId]);

  const projection = useMemo(() => buildDecisionMapProjection(
    project,
    focusAssessment,
    view,
    expandedClusterIds,
  ), [expandedClusterIds, focusAssessment, project, view]);
  const selectedNode = project.nodes.find((node) => node.id === selectedNodeId);
  const nodeFocus = useMemo(
    () => storyMode.type === 'node_focus' ? buildDecisionNodeFocus(project, storyMode.nodeId, focusAssessment) : null,
    [focusAssessment, project, storyMode],
  );
  const decisionPath = selectedNodeId ? buildDecisionExplanation(project, selectedNodeId) : { nodeIds: [], edgeIds: [] };

  const toggleCluster = useCallback((nodeId: string) => {
    setExpandedClusterIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleLayoutDiagnostics = useCallback((diagnostics: DecisionMapRendererDiagnostics) => {
    setRendererDiagnostics(diagnostics);
  }, []);

  // Renderer state is useful developer detail, but it is not a semantic map
  // event. Update the latest event in place rather than appending a record.
  useEffect(() => {
    if (!rendererDiagnostics || !userId) return;
    const positions = Object.entries(rendererDiagnostics.positions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, point]) => [id, point.x, point.y]);
    const activityWarnings = decisionMapWarningCodes(buildDecisionMapDebugTrace(project, {
      filter: 'story',
      selectedNodeId: null,
      focusMode: false,
      pathMode: false,
      focusAssessment,
      projection: buildDecisionMapProjection(project, focusAssessment, 'story', new Set()),
    }));
    const activityFingerprint = buildDecisionMapActivityFingerprint(project, focusAssessment, activityWarnings);
    const traceKey = JSON.stringify({
      activityFingerprint,
      projectId: project.id,
      view,
      expandedClusterIds: [...expandedClusterIds].sort(),
      selectedNodeId,
      focusMode,
      pathMode,
      focusActionNodeId: focusAssessment?.actionNodeId ?? null,
      visibleNodeIds: rendererDiagnostics.visibleNodeIds,
      positions,
      zoom: Number(rendererDiagnostics.zoom.toFixed(3)),
      pan: [Number(rendererDiagnostics.pan.x.toFixed(1)), Number(rendererDiagnostics.pan.y.toFixed(1))],
    });
    if (lastRendererSnapshotKeyRef.current === traceKey) return;
    const timer = window.setTimeout(() => {
      const decisionMapDebug = buildDecisionMapDebugTrace(project, {
        filter: view,
        selectedNodeId,
        focusMode,
        pathMode,
        focusAssessment,
        projection,
        renderer: rendererDiagnostics,
      });
      void authFetch('/api/dev/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          persistActivity: false,
          activityFingerprint,
          decisionMapDebug,
        }),
      }).then(async (response) => {
        if (!response.ok) return;
        const body = await response.json().catch(() => null) as { updated?: boolean } | null;
        if (body?.updated) lastRendererSnapshotKeyRef.current = traceKey;
      }).catch(() => {
        // Decision Map instrumentation is intentionally best-effort.
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [expandedClusterIds, focusAssessment, focusMode, pathMode, project, projection, rendererDiagnostics, selectedNodeId, traceRefreshKey, userId, view]);

  // Persist one event for a meaningful project/focus change. This effect does
  // not depend on selection, view, layout, viewport, or renderer diagnostics.
  useEffect(() => {
    if (!userId) return;
    const timer = window.setTimeout(() => {
      const semanticProjection = buildDecisionMapProjection(project, focusAssessment, 'story', new Set());
      const semanticDebug = buildDecisionMapDebugTrace(project, {
        filter: 'story',
        selectedNodeId: null,
        focusMode: false,
        pathMode: false,
        focusAssessment,
        projection: semanticProjection,
      });
      const warnings = decisionMapWarningCodes(semanticDebug);
      const activityFingerprint = buildDecisionMapActivityFingerprint(project, focusAssessment, warnings);
      void authFetch('/api/dev/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          persistActivity: true,
          activityFingerprint,
          activityTrigger: project.sources.at(-1)?.filename,
          decisionMapDebug: semanticDebug,
        }),
      }).then((response) => {
        if (!response.ok) return;
        setTraceRefreshKey((current) => current + 1);
      }).catch(() => {
        // Decision Map instrumentation is intentionally best-effort.
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [project, userId, focusAssessment?.actionNodeId]);

  useEffect(() => {
    if (!focusNodeId || !project.nodes.some((node) => node.id === focusNodeId)) return;
    setSelectedNodeId(focusNodeId);
    if (view === 'story') {
      setStoryMode({ type: 'node_focus', nodeId: focusNodeId });
    } else {
      setFocusMode(true);
      setPathMode(true);
    }
  }, [focusNodeId, project, view]);

  const selectNode = (node: ClarityNode) => {
    setSelectedNodeId(node.id);
    if (view === 'story') {
      setStoryMode({ type: 'node_focus', nodeId: node.id });
    } else {
      setFocusMode(true);
      setPathMode(true);
    }
    onSelectNode(node);
  };

  const inspectNode = (node: ClarityNode) => {
    setSelectedNodeId(node.id);
    if (view === 'story') setStoryMode({ type: 'node_focus', nodeId: node.id });
    onSelectNode(node);
  };

  const changeView = (nextView: DecisionMapView) => {
    setView(nextView);
    setStoryMode({ type: 'overview' });
    if (nextView === 'story') setSelectedNodeId(null);
  };

  const renderInspector = () => {
    const informingEdges = selectedNode
      ? project.edges
        .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
        .map((edge) => ({ edge, other: project.nodes.find((node) => node.id === (edge.source === selectedNode.id ? edge.target : edge.source)) }))
        .filter(({ other }) => other && ['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'PREFERENCE', 'RISK'].includes(other.type))
      : [];
    return (
    <aside className="min-w-0 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl sm:p-5" aria-label="Decision Map node details">
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
            <span className="text-xs font-semibold text-slate-400">What informs this</span>
            {informingEdges.length > 0
              ? informingEdges.map(({ edge, other }) => <p key={edge.id} className="text-xs leading-relaxed text-slate-300"><span className="text-slate-500">{edge.type.replace('_', ' ')} · </span>{other?.text}</p>)
              : <p className="text-xs text-slate-500">No supporting context is connected yet.</p>}
          </div>
          {selectedNode.type === 'DECISION' && onReviewDecision && (
            <button type="button" onClick={() => onReviewDecision(selectedNode)} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-indigo-700/80 bg-indigo-950/40 px-3 py-2 text-xs font-bold text-indigo-200 hover:border-indigo-500">
              Open decision workspace
            </button>
          )}
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
        <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
          <Focus className="h-8 w-8 text-slate-700" />
          <h3 className="mt-3 text-sm font-bold text-slate-200">Select a node</h3>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-500">Choose a node to inspect its evidence, relationships, and path toward the goal.</p>
        </div>
      )}
    </aside>
    );
  };

  const renderPath = () => (
    pathMode && selectedNode ? (
      <div className="overflow-hidden rounded-xl border border-rose-900/70 bg-rose-950/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-rose-300">Why this matters</p>
            <p className="mt-1 text-xs text-slate-400">How this affects the decisions and outcomes that matter next.</p>
          </div>
          <button type="button" onClick={() => setPathMode(false)} className="rounded-md p-2 text-slate-500 hover:text-slate-200" aria-label="Close decision path"><X className="h-4 w-4" /></button>
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
                  <button type="button" onClick={() => selectNode(node)} className={`w-44 shrink-0 rounded-lg border px-3 py-2 text-left ${nodeTypeColors[node.type].border} ${nodeTypeColors[node.type].bg}`}>
                    <span className={`text-[9px] font-extrabold uppercase tracking-[0.14em] ${nodeTypeColors[node.type].text}`}>{node.type}</span>
                    <span className="mt-1 block line-clamp-2 text-xs font-semibold text-slate-200">{node.text}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        ) : <p className="mt-3 text-xs text-slate-400">No connected goal path is available for this node yet.</p>}
      </div>
    ) : null
  );

  return (
    <div
      className={isFullscreen
        ? 'fixed inset-0 z-[80] flex min-h-0 flex-col bg-slate-950/95 p-2 backdrop-blur-sm sm:p-4'
        : 'mx-auto max-w-7xl space-y-5 px-3 py-5 sm:px-6 sm:py-8 lg:px-8'}
      role={isFullscreen ? 'dialog' : undefined}
      aria-modal={isFullscreen || undefined}
      aria-labelledby={isFullscreen ? 'decision-map-title' : undefined}
    >
      <div ref={isFullscreen ? fullscreenPanelRef : undefined} className={isFullscreen ? 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cyan-900/70 bg-slate-950 shadow-2xl' : 'space-y-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl sm:p-5'}>
        <header className="flex shrink-0 flex-col gap-4 border-b border-slate-800 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              <h2 id="decision-map-title" className="text-xl font-bold text-slate-100">Decision Map</h2>
              <span className="rounded-full border border-cyan-800 bg-cyan-950/60 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-cyan-300">Reasoning map</span>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-slate-400">See what is known, uncertain, blocked, and how it connects to your goal.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedNode && view !== 'story' && (
              <button type="button" onClick={() => setFocusMode((current) => !current)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold sm:min-h-0 ${focusMode ? 'border-cyan-700 bg-cyan-950 text-cyan-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`} aria-pressed={focusMode}>
                <Focus className="h-3.5 w-3.5" />{focusMode ? 'Show all' : 'Focus neighborhood'}
              </button>
            )}
            {selectedNode && view !== 'story' && (
              <button type="button" onClick={() => setPathMode((current) => !current)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold sm:min-h-0 ${pathMode ? 'border-rose-700 bg-rose-950 text-rose-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`} aria-pressed={pathMode}>
                <Route className="h-3.5 w-3.5" />{pathMode ? 'Exit focus path' : 'Focus path'}
              </button>
            )}
            {isFullscreen && (
              <button type="button" onClick={() => setIsInspectorCollapsed((current) => !current)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-200 sm:min-h-0" aria-pressed={isInspectorCollapsed}>
                {isInspectorCollapsed ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />}
                {isInspectorCollapsed ? 'Show details' : 'Hide details'}
              </button>
            )}
          </div>
        </header>

        <DecisionMapActivity userId={userId} project={project} traceRefreshKey={traceRefreshKey} />

        <div className="touch-scroll flex max-w-full shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-800 bg-slate-950 p-2">
          {([
            ['story', 'Project story'],
            ['all', `All (${project.nodes.length})`],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => changeView(id)} className={`min-h-10 shrink-0 whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium sm:min-h-0 ${view === id ? 'border border-cyan-800 bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-100'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className={isFullscreen ? 'grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden' : 'grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]'}>
          <div className={isFullscreen ? 'flex min-h-[55dvh] min-w-0 flex-col gap-3 p-2 sm:p-4 lg:min-h-0' : 'min-w-0 space-y-3'}>
            <div className={isFullscreen ? 'relative min-h-0 flex-1' : 'relative'}>
              {view === 'story' && nodeFocus ? (
                <DecisionNodeFocus
                  focus={nodeFocus}
                  focusAssessment={focusAssessment}
                  onBack={() => {
                    setStoryMode({ type: 'overview' });
                    setSelectedNodeId(null);
                  }}
                  onInspectNode={inspectNode}
                  onReviewDecision={onReviewDecision}
                  onResolveQuestion={onResolveQuestion}
                />
              ) : (
                <LazyConstellationGraph
                  project={project}
                  projection={projection}
                  expandedClusterIds={expandedClusterIds}
                  onToggleCluster={toggleCluster}
                  selectedNodeId={selectedNodeId}
                  focusMode={focusMode}
                  pathMode={pathMode}
                  focusNodeId={focusAssessment?.actionNodeId ?? null}
                  dimension="2d"
                  expanded={isFullscreen}
                  viewport={viewport}
                  onViewportChange={setViewport}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={() => setIsFullscreen((current) => !current)}
                  onLayoutDiagnostics={handleLayoutDiagnostics}
                  onSelectNode={selectNode}
                />
              )}
            </div>
            {view !== 'story' && renderPath()}
            <div className="flex flex-wrap items-center gap-3 px-1 text-[10px] text-slate-500">
              {legendTypes.map((type) => <span key={type} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: legendColors[type] }} />{type.replace('_', ' ')}</span>)}
            </div>
          </div>
          {(!isFullscreen || !isInspectorCollapsed) && renderInspector()}
        </div>
      </div>
    </div>
  );
};
