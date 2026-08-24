'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import type { ClarityNode, Project } from '@/types/clarity';
import {
  buildDecisionStoryEdges,
  decisionStoryPath,
  decisionStoryRiskAnnotations,
} from '@/lib/graph/decisionStory';
import {
  calculateDecisionStoryLayout,
  calculateDecisionStoryMetrics,
  decisionMapNodeDimensions,
  type ConstellationPoint,
} from '@/lib/graph/constellation';
import type { DecisionMapProjection } from '@/lib/graph/decisionMapProjection';
import type { DecisionMapRendererDiagnostics } from '@/lib/graph/decisionMapDebug';
import type { GraphViewport } from '@/components/ConstellationGraph';

interface ProjectStoryGraphProps {
  project: Project;
  projection: DecisionMapProjection;
  selectedNodeId: string | null;
  focusNodeId?: string | null;
  viewport?: GraphViewport;
  onViewportChange?: (viewport: GraphViewport) => void;
  onSelectNode: (node: ClarityNode) => void;
  onLayoutDiagnostics?: (diagnostics: DecisionMapRendererDiagnostics) => void;
}

const NODE_COLORS: Record<ClarityNode['type'], string> = {
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

const MIN_ZOOM = 0.72;
const MAX_ZOOM = 2.2;

function nodeDimensions(node: ClarityNode): { width: number; height: number } {
  const base = decisionMapNodeDimensions(node, false);
  return { width: Math.max(240, base.width), height: Math.max(92, base.height) };
}

function shorten(text: string, length = 108): string {
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}

function nodeAt(project: Project, id: string): ClarityNode | undefined {
  return project.nodes.find((node) => node.id === id);
}

function StoryNode({
  node,
  point,
  selected,
  currentFocus,
  muted,
  risks,
  onSelect,
}: {
  node: ClarityNode;
  point: ConstellationPoint;
  selected: boolean;
  currentFocus: boolean;
  muted: boolean;
  risks: string[];
  onSelect: () => void;
}) {
  const dimensions = nodeDimensions(node);
  const color = NODE_COLORS[node.type];
  const isGoal = node.type === 'GOAL';
  return (
    <g
      transform={`translate(${point.x - dimensions.width / 2} ${point.y - dimensions.height / 2})`}
      opacity={muted ? 0.2 : 1}
      className="constellation-node-enter"
    >
      <foreignObject width={dimensions.width} height={dimensions.height} className="overflow-visible">
        <button
          type="button"
          onClick={onSelect}
          className={`h-full w-full rounded-xl border p-3 text-left shadow-lg transition ${selected ? 'ring-2 ring-cyan-300/90' : ''}`}
          style={{ borderColor: `${color}${selected || isGoal ? 'ee' : '99'}`, backgroundColor: `${color}22` }}
        >
          <span className="block truncate text-[9px] font-extrabold uppercase tracking-[0.14em]" style={{ color }}>{node.type.replace('_', ' ')}</span>
          {currentFocus && <span className="mt-1 block text-[9px] font-extrabold uppercase tracking-[0.12em] text-cyan-200">★ Current focus</span>}
          <span className="mt-2 block line-clamp-4 text-[11px] font-semibold leading-snug text-slate-100">{node.text}</span>
          {risks.length > 0 && (
            <span className="mt-2 block line-clamp-2 text-[10px] font-semibold leading-snug text-orange-200">⚠ {shorten(risks[0])}{risks.length > 1 ? ` +${risks.length - 1} more risk${risks.length === 2 ? '' : 's'}` : ''}</span>
          )}
        </button>
      </foreignObject>
    </g>
  );
}

function ProjectStoryGraph({
  project,
  projection,
  selectedNodeId,
  focusNodeId,
  viewport,
  onViewportChange,
  onSelectNode,
  onLayoutDiagnostics,
}: ProjectStoryGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const [localZoom, setLocalZoom] = useState(viewport?.zoom ?? 1);
  const [localPan, setLocalPan] = useState(viewport?.pan ?? { x: 0, y: 0 });
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimerRef = useRef<number | null>(null);
  const zoom = viewport?.zoom ?? localZoom;
  const pan = viewport?.pan ?? localPan;

  const storyNodes = useMemo(
    () => project.nodes.filter((node) => projection.visibleNodeIds.includes(node.id) && !['KNOWN', 'EVIDENCE', 'CONSTRAINT', 'PREFERENCE', 'RISK'].includes(node.type)),
    [project.nodes, projection.visibleNodeIds],
  );
  const storyProjection = useMemo(() => ({ visibleNodeIds: storyNodes.map((node) => node.id) }), [storyNodes]);
  const storyEdges = useMemo(() => buildDecisionStoryEdges(project, storyProjection), [project, storyProjection]);
  const layout = useMemo(() => calculateDecisionStoryLayout(project, storyProjection), [project, storyProjection]);
  const metrics = useMemo(() => calculateDecisionStoryMetrics(project, storyProjection), [project, storyProjection]);
  const selectedPath = useMemo(() => decisionStoryPath(project, storyProjection, selectedNodeId), [project, selectedNodeId, storyProjection]);
  const emphasizedNodes = useMemo(() => selectedNodeId ? new Set(selectedPath.nodeIds) : null, [selectedNodeId, selectedPath.nodeIds]);
  const emphasizedEdges = useMemo(() => new Set(selectedPath.edgeIds), [selectedPath.edgeIds]);
  const storyNodeSet = useMemo(() => new Set(storyNodes.map((node) => node.id)), [storyNodes]);

  const updateViewport = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    setLocalZoom(nextZoom);
    setLocalPan(nextPan);
    onViewportChange?.({ zoom: nextZoom, pan: nextPan });
  }, [onViewportChange]);

  const localPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * metrics.width,
      y: ((event.clientY - bounds.top) / bounds.height) * metrics.height,
    };
  }, [metrics.height, metrics.width]);

  const fitToView = useCallback(() => {
    const points = storyNodes.map((node) => ({ node, point: layout[node.id] })).filter((item): item is { node: ClarityNode; point: ConstellationPoint } => Boolean(item.point));
    if (points.length === 0) {
      updateViewport(1, { x: 0, y: 0 });
      return;
    }
    const bounds = points.reduce((current, item) => {
      const dimensions = nodeDimensions(item.node);
      return {
        minX: Math.min(current.minX, item.point.x - dimensions.width / 2),
        maxX: Math.max(current.maxX, item.point.x + dimensions.width / 2),
        minY: Math.min(current.minY, item.point.y - dimensions.height / 2),
        maxY: Math.max(current.maxY, item.point.y + dimensions.height / 2),
      };
    }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const padding = 72;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(
      (metrics.width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX),
      (metrics.height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY),
    )));
    updateViewport(nextZoom, {
      x: metrics.width / 2 - ((bounds.minX + bounds.maxX) / 2) * nextZoom,
      y: metrics.height / 2 - ((bounds.minY + bounds.maxY) / 2) * nextZoom,
    });
  }, [layout, metrics.height, metrics.width, storyNodes, updateViewport]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(fitToView);
    return () => window.cancelAnimationFrame(frame);
  }, [fitToView, projection.visibleNodeIds.join('|')]);

  useEffect(() => () => {
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
  }, []);

  useEffect(() => {
    const bounds = svgRef.current?.getBoundingClientRect();
    onLayoutDiagnostics?.({
      positions: layout,
      view: 'story',
      visibleNodeIds: storyNodes.map((node) => node.id),
      visibleEdgeIds: storyEdges.map((edge) => edge.id),
      zoom,
      pan,
      viewport: { width: bounds?.width ?? 0, height: bounds?.height ?? 0 },
      mapWidth: metrics.width,
      mapHeight: metrics.height,
    });
  }, [layout, metrics.height, metrics.width, onLayoutDiagnostics, pan, storyEdges, storyNodes, zoom]);

  const zoomBy = (amount: number) => {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + amount));
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
    setIsZooming(true);
    zoomTimerRef.current = window.setTimeout(() => setIsZooming(false), 180);
    updateViewport(nextZoom, pan);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = localPoint(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    updateViewport(zoom, { x: pan.x + dx, y: pan.y + dy });
    drag.startX = point.x;
    drag.startY = point.y;
  };

  const routesByTarget = new Map<string, typeof storyEdges>();
  storyEdges.forEach((edge) => routesByTarget.set(edge.target, [...(routesByTarget.get(edge.target) ?? []), edge]));

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${metrics.width} ${metrics.height}`}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label="Project story decision flow"
        onWheel={(event) => {
          event.preventDefault();
          const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * Math.exp(-event.deltaY * 0.0012)));
          updateViewport(nextZoom, pan);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const point = localPoint(event);
          dragRef.current = { startX: point.x, startY: point.y, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <defs>
          <pattern id="decision-story-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#38bdf8" opacity="0.16" />
          </pattern>
          <marker id="decision-story-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#64748b" />
          </marker>
        </defs>
        <rect width={metrics.width} height={metrics.height} fill="#040b17" />
        <rect width={metrics.width} height={metrics.height} fill="url(#decision-story-grid)" opacity="0.8" pointerEvents="none" />
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`} style={{ transition: isZooming ? 'transform 140ms ease-out' : undefined }}>
          <text x="38" y="34" className="fill-slate-500 text-[10px] font-extrabold uppercase tracking-[0.16em]">PROJECT STORY · DECISION FLOW</text>
          {[...routesByTarget.entries()].map(([targetId, edges]) => {
            const target = nodeAt(project, targetId);
            const targetPoint = layout[targetId];
            if (!target || !targetPoint) return null;
            const targetDimensions = nodeDimensions(target);
            const sourcePorts = edges.map((edge) => {
              const source = nodeAt(project, edge.source);
              const point = layout[edge.source];
              return source && point ? { edge, point, dimensions: nodeDimensions(source) } : null;
            }).filter((item): item is { edge: typeof edges[number]; point: ConstellationPoint; dimensions: { width: number; height: number } } => Boolean(item));
            if (sourcePorts.length === 0) return null;
            const railY = Math.min(targetPoint.y - targetDimensions.height / 2 - 24, Math.max(...sourcePorts.map((item) => item.point.y + item.dimensions.height / 2)) + 56);
            const minX = Math.min(targetPoint.x, ...sourcePorts.map((item) => item.point.x));
            const maxX = Math.max(targetPoint.x, ...sourcePorts.map((item) => item.point.x));
            const muted = emphasizedNodes ? !sourcePorts.some((item) => emphasizedNodes.has(item.edge.source)) && !emphasizedNodes.has(targetId) : false;
            return (
              <g key={targetId} opacity={muted ? 0.12 : 0.72} fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {sourcePorts.map(({ edge, point, dimensions }) => <path key={`${edge.id}-up`} d={`M ${point.x} ${point.y + dimensions.height / 2} V ${railY}`} opacity={emphasizedEdges.size > 0 && !emphasizedEdges.has(edge.id) ? 0.2 : 1} />)}
                <path d={`M ${minX} ${railY} H ${maxX}`} />
                <path d={`M ${targetPoint.x} ${railY} V ${targetPoint.y - targetDimensions.height / 2}`} markerEnd="url(#decision-story-arrow)" />
              </g>
            );
          })}
          {storyNodes.map((node) => {
            const point = layout[node.id];
            if (!point) return null;
            const risks = node.type === 'DECISION' ? decisionStoryRiskAnnotations(project, node.id, storyNodeSet) : [];
            return <StoryNode key={node.id} node={node} point={point} selected={selectedNodeId === node.id} currentFocus={focusNodeId === node.id} muted={Boolean(emphasizedNodes && !emphasizedNodes.has(node.id))} risks={risks} onSelect={() => onSelectNode(node)} />;
          })}
        </g>
      </svg>
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-700/90 bg-slate-950/90 p-1 text-slate-200 shadow-lg backdrop-blur">
        <button type="button" onClick={() => zoomBy(-0.1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-cyan-300" aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
        <button type="button" onClick={() => updateViewport(1, pan)} className="min-w-14 rounded-md px-2 text-center text-[11px] font-bold tabular-nums text-slate-300 hover:bg-slate-800 hover:text-cyan-300" aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => zoomBy(0.1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-cyan-300" aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={fitToView} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-slate-300 hover:bg-slate-800 hover:text-cyan-300" aria-label="Fit project story to view"><Scan className="h-4 w-4" /><span>Fit</span></button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 text-[10px] text-slate-500">
        <span>Drag background to pan · Use + / − to zoom</span>
        <span className="text-cyan-400/80">{storyNodes.length} story nodes · {storyEdges.length} flow relationships</span>
      </div>
    </div>
  );
}

export default ProjectStoryGraph;
