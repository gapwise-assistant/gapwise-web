'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { Maximize2, Minimize2, Minus, MoreHorizontal, Pencil, Plus, Scan } from 'lucide-react';
import * as THREE from 'three';
import { ClarityEdge, ClarityNode, Project } from '@/types/clarity';
import {
  buildDecisionExplanation,
  calculateConstellationLayout,
  calculateDecisionStoryLayout,
  calculateDecisionStoryMetrics,
  calculateDecisionMapMetrics,
  calculateDecisionMapLayout,
  ConstellationPoint,
  DECISION_MAP_LANES,
  DECISION_MAP_LANE_LABELS,
  decisionMapLaneForType,
  decisionMapNodeDimensions,
  getNeighborhood,
} from '@/lib/graph/constellation';
import type { DecisionMapRendererDiagnostics } from '@/lib/graph/decisionMapDebug';
import type { DecisionMapProjection } from '@/lib/graph/decisionMapProjection';
import ProjectStoryGraph from '@/components/ProjectStoryGraph';

type Dimension = '2d' | '3d';

export interface GraphViewport {
  zoom: number;
  pan: { x: number; y: number };
}

interface ConstellationGraphProps {
  project: Project;
  projection: DecisionMapProjection;
  expandedClusterIds: Set<string>;
  onToggleCluster: (nodeId: string) => void;
  selectedNodeId: string | null;
  focusMode: boolean;
  pathMode: boolean;
  focusNodeId?: string | null;
  dimension: Dimension;
  expanded?: boolean;
  viewport?: GraphViewport;
  onViewportChange?: (viewport: GraphViewport) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
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

const EDGE_COLORS: Record<ClarityEdge['type'], string> = {
  supports: '#34d399',
  contradicts: '#fb7185',
  supersedes: '#fbbf24',
  resolves: '#22d3ee',
  satisfies: '#a78bfa',
  depends_on: '#c084fc',
  blocks: '#fb923c',
  affects: '#60a5fa',
  informs: '#94a3b8',
  derived_from: '#64748b',
};

function shorten(text: string, maxLength = 48): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function tuple(point: ConstellationPoint): [number, number, number] {
  return [point.x, point.y, point.z];
}

function edgeIsHighlighted(
  edge: ClarityEdge,
  emphasizedNodes: Set<string> | null,
  highlightedEdges: Set<string>,
): boolean {
  return highlightedEdges.has(edge.id) || Boolean(
    emphasizedNodes?.has(edge.source) && emphasizedNodes.has(edge.target),
  );
}

interface Node3DProps {
  node: ClarityNode;
  position: [number, number, number];
  editMode: boolean;
  muted: boolean;
  highlighted: boolean;
  labelVisible: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  onDrag: (point: THREE.Vector3) => void;
  onDragStateChange: (dragging: boolean) => void;
}

function Node3D({
  node,
  position,
  editMode,
  muted,
  highlighted,
  labelVisible,
  onSelect,
  onHover,
  onDrag,
  onDragStateChange,
}: Node3DProps) {
  const group = useRef<THREE.Group>(null);
  const dragPlane = useRef(new THREE.Plane());
  const dragged = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const color = NODE_COLORS[node.type];
  const radius = node.type === 'GOAL' ? 0.31 : node.type === 'UNKNOWN' ? 0.26 : 0.2;

  useFrame((_, delta) => {
    if (!group.current || isDragging) return;
    const targetScale = muted ? 0.72 : highlighted ? 1.18 : 1;
    const nextScale = THREE.MathUtils.damp(group.current.scale.x, targetScale, 8, delta);
    group.current.scale.setScalar(nextScale);
  });

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    dragged.current = false;
    if (!editMode) return;
    setIsDragging(true);
    onDragStateChange(true);
    const normal = event.camera.getWorldDirection(new THREE.Vector3());
    dragPlane.current.setFromNormalAndCoplanarPoint(normal, group.current?.position ?? new THREE.Vector3());
    const target = event.target as unknown as { setPointerCapture?: (pointerId: number) => void };
    target.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    const next = new THREE.Vector3();
    if (event.ray.intersectPlane(dragPlane.current, next)) {
      dragged.current = true;
      onDrag(next);
    }
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    setIsDragging(false);
    onDragStateChange(false);
    const target = event.target as unknown as { releasePointerCapture?: (pointerId: number) => void };
    target.releasePointerCapture?.(event.pointerId);
  };

  return (
    <group
      ref={group}
      position={position}
      scale={[0.02, 0.02, 0.02]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
      onClick={(event) => {
        event.stopPropagation();
        if (!dragged.current) onSelect();
      }}
    >
      {(node.type === 'GOAL' || node.type === 'UNKNOWN' || highlighted) && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius + 0.09, 0.025, 8, 32]} />
          <meshBasicMaterial color={color} transparent opacity={muted ? 0.12 : 0.8} />
        </mesh>
      )}
      <mesh>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={muted ? 0.05 : highlighted ? 0.75 : 0.2}
          transparent
          opacity={muted ? 0.2 : 1}
          roughness={0.34}
          metalness={0.12}
        />
      </mesh>
      {labelVisible && (
        <Html center distanceFactor={8} position={[0, radius + 0.25, 0]}>
          <div className={`pointer-events-none w-36 text-center transition-opacity ${muted ? 'opacity-20' : 'opacity-100'}`}>
            <span
              className="inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em]"
              style={{ color, borderColor: `${color}88`, backgroundColor: '#07111fdd' }}
            >
              {node.type}
            </span>
            <p className="mt-1 text-[10px] font-semibold leading-tight text-slate-100 drop-shadow-lg">
              {shorten(node.text)}
            </p>
          </div>
        </Html>
      )}
    </group>
  );
}

interface GraphSceneProps {
  project: Project;
  projection: DecisionMapProjection;
  expandedClusterIds: Set<string>;
  onToggleCluster: (nodeId: string) => void;
  selectedNodeId: string | null;
  focusMode: boolean;
  pathMode: boolean;
  editMode: boolean;
  onEditModeChange: (enabled: boolean) => void;
  onSelectNode: (node: ClarityNode) => void;
}

interface Constellation2DProps extends GraphSceneProps {
  expanded?: boolean;
  viewport?: GraphViewport;
  onViewportChange?: (viewport: GraphViewport) => void;
  onLayoutDiagnostics?: (diagnostics: DecisionMapRendererDiagnostics) => void;
}

function GraphScene({ project, projection, selectedNodeId, focusMode, pathMode, editMode, onSelectNode }: GraphSceneProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggedPositions, setDraggedPositions] = useState<Record<string, ConstellationPoint>>({});
  const [isDragging, setIsDragging] = useState(false);
  const graph = useMemo(() => ({
    nodes: project.nodes.filter((node) => projection.visibleNodeIds.includes(node.id)),
    edges: project.edges.filter((edge) => projection.visibleEdgeIds.includes(edge.id)),
  }), [project.edges, project.nodes, projection.visibleEdgeIds, projection.visibleNodeIds]);
  const layout = useMemo(() => calculateConstellationLayout(graph), [graph]);
  const decisionPath = useMemo(
    () => (selectedNodeId && pathMode ? buildDecisionExplanation(graph, selectedNodeId) : { nodeIds: [], edgeIds: [] }),
    [graph, pathMode, selectedNodeId],
  );
  const pathNodeIds = useMemo(() => new Set(decisionPath.nodeIds), [decisionPath.nodeIds]);
  const pathEdgeIds = useMemo(() => new Set(decisionPath.edgeIds), [decisionPath.edgeIds]);
  const focusNodeIds = useMemo(
    () => (selectedNodeId && focusMode ? getNeighborhood(graph, selectedNodeId) : null),
    [focusMode, graph, selectedNodeId],
  );
  const hoveredNodeIds = useMemo(
    () => (hoveredNodeId ? getNeighborhood(graph, hoveredNodeId) : null),
    [graph, hoveredNodeId],
  );
  const emphasizedNodes = pathMode && selectedNodeId ? pathNodeIds : focusNodeIds ?? hoveredNodeIds;

  const positions = useMemo(
    () => graph.nodes.reduce<Record<string, ConstellationPoint>>((result, node) => {
      result[node.id] = draggedPositions[node.id] ?? layout[node.id] ?? { x: 0, y: 0, z: 0 };
      return result;
    }, {}),
    [draggedPositions, graph.nodes, layout],
  );

  return (
    <>
      <ambientLight intensity={0.65} />
      <pointLight position={[4, 5, 7]} intensity={18} color="#67e8f9" distance={18} />
      <pointLight position={[-5, -3, 2]} intensity={12} color="#818cf8" distance={16} />
      <OrbitControls
        enabled={!isDragging}
        enablePan
        enableZoom
        enableRotate
        minDistance={5}
        maxDistance={22}
        dampingFactor={0.08}
        enableDamping
      />
      {graph.edges.map((edge) => {
        const source = positions[edge.source];
        const target = positions[edge.target];
        if (!source || !target) return null;
        const highlighted = edgeIsHighlighted(edge, emphasizedNodes, pathEdgeIds);
        const muted = Boolean(emphasizedNodes) && !highlighted;
        return (
          <Line
            key={edge.id}
            points={[tuple(source), tuple(target)]}
            color={highlighted ? EDGE_COLORS[edge.type] : EDGE_COLORS[edge.type]}
            lineWidth={highlighted ? 2.2 : 0.8}
            transparent
            opacity={muted ? 0.08 : highlighted ? 0.95 : 0.3}
            dashed={edge.type === 'blocks' || edge.type === 'contradicts'}
            dashSize={0.16}
            gapSize={0.1}
          />
        );
      })}
      {graph.nodes.map((node) => {
        const point = positions[node.id];
        const muted = Boolean(emphasizedNodes) && !emphasizedNodes?.has(node.id);
        const highlighted = node.id === selectedNodeId || Boolean(emphasizedNodes?.has(node.id));
        const labelVisible = !muted && (highlighted || node.type === 'GOAL' || node.type === 'UNKNOWN' || !emphasizedNodes);
        return (
          <Node3D
            key={node.id}
            node={node}
            position={tuple(point)}
            editMode={editMode}
            muted={muted}
            highlighted={highlighted}
            labelVisible={labelVisible}
            onSelect={() => onSelectNode(node)}
            onHover={(hovered) => setHoveredNodeId(hovered ? node.id : null)}
            onDrag={(next) => setDraggedPositions((current) => ({
              ...current,
              [node.id]: { x: next.x, y: next.y, z: next.z },
            }))}
            onDragStateChange={setIsDragging}
          />
        );
      })}
    </>
  );
}

interface PanState {
  mode: 'canvas' | 'node';
  nodeId?: string;
  startX: number;
  startY: number;
  moved: boolean;
}

const MIN_2D_ZOOM = 0.72;
const MAX_2D_ZOOM = 2.2;
const ZOOM_STEP = 0.1;

const IMPORTANT_EDGE_TYPES = new Set<ClarityEdge['type']>([
  'blocks',
  'supports',
  'contradicts',
  'resolves',
  'satisfies',
  'affects',
  'depends_on',
  'supersedes',
]);

function relationshipLabel(type: ClarityEdge['type']): string {
  return type.replaceAll('_', ' ');
}

function edgeBoundaryPoint(
  center: { x: number; y: number },
  toward: { x: number; y: number },
  dimensions: { width: number; height: number },
): { x: number; y: number } {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scale = 1 / Math.max(Math.abs(dx) / (dimensions.width / 2), Math.abs(dy) / (dimensions.height / 2));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function edgeGeometry(
  start: { x: number; y: number },
  end: { x: number; y: number },
  slot: number,
  slotCount: number,
): { path: string; labelX: number; labelY: number } {
  const midY = (start.y + end.y) / 2;
  const offset = (slot - (slotCount - 1) / 2) * 34;
  const bend = offset + (Math.abs(end.x - start.x) < 36 ? 26 : 0);
  const labelOffset = offset * 0.55;
  return {
    path: `M ${start.x} ${start.y} C ${start.x + bend} ${midY} ${end.x + bend} ${midY} ${end.x} ${end.y}`,
    labelX: (start.x + end.x) / 2 + bend,
    labelY: midY - 7 + labelOffset,
  };
}

function Constellation2D({
  project,
  projection,
  expandedClusterIds,
  onToggleCluster,
  selectedNodeId,
  focusMode,
  pathMode,
  editMode,
  onEditModeChange,
  onSelectNode,
  expanded = false,
  viewport,
  onViewportChange,
  onLayoutDiagnostics,
}: Constellation2DProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<PanState | null>(null);
  const suppressClickRef = useRef(false);
  const [localZoom, setLocalZoom] = useState(viewport?.zoom ?? 1);
  const [localPan, setLocalPan] = useState(viewport?.pan ?? { x: 0, y: 0 });
  const [draggedPositions, setDraggedPositions] = useState<Record<string, ConstellationPoint>>({});
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimerRef = useRef<number | null>(null);
  const previousExpandedRef = useRef(false);
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number; pan: { x: number; y: number } } | null>(null);
  const zoom = viewport?.zoom ?? localZoom;
  const pan = viewport?.pan ?? localPan;
  const visibleNodeIds = useMemo(() => new Set(projection.visibleNodeIds), [projection.visibleNodeIds]);
  const visibleEdgeIds = useMemo(() => new Set(projection.visibleEdgeIds), [projection.visibleEdgeIds]);
  const graph = useMemo(() => ({
    nodes: project.nodes.filter((node) => visibleNodeIds.has(node.id)),
    edges: project.edges.filter((edge) => visibleEdgeIds.has(edge.id)),
  }), [project.edges, project.nodes, visibleEdgeIds, visibleNodeIds]);
  const isAllView = projection.view === 'all';
  const layout = useMemo(
    () => isAllView ? calculateDecisionMapLayout(graph) : calculateDecisionStoryLayout(project, projection),
    [graph, isAllView, project, projection],
  );
  const mapMetrics = useMemo(
    () => isAllView ? calculateDecisionMapMetrics(graph) : calculateDecisionStoryMetrics(project, projection),
    [graph, isAllView, project, projection],
  );
  const decisionPath = useMemo(
    () => (selectedNodeId && pathMode ? buildDecisionExplanation(project, selectedNodeId) : { nodeIds: [], edgeIds: [] }),
    [pathMode, project, selectedNodeId],
  );
  const pathNodeIds = useMemo(() => new Set(decisionPath.nodeIds), [decisionPath.nodeIds]);
  const pathEdgeIds = useMemo(() => new Set(decisionPath.edgeIds), [decisionPath.edgeIds]);
  const focusNodeIds = useMemo(
    () => (selectedNodeId && focusMode ? getNeighborhood(project, selectedNodeId) : null),
    [focusMode, project, selectedNodeId],
  );
  const hoveredNodeIds = useMemo(
    () => (hoveredNodeId ? getNeighborhood(project, hoveredNodeId) : null),
    [hoveredNodeId, project],
  );
  const emphasizedNodes = pathMode && selectedNodeId ? pathNodeIds : focusNodeIds ?? hoveredNodeIds;
  const positions = useMemo(
    () => graph.nodes.reduce<Record<string, ConstellationPoint>>((result, node) => {
      result[node.id] = draggedPositions[node.id] ?? layout[node.id] ?? { x: 0, y: 0, z: 0 };
      return result;
    }, {}),
    [draggedPositions, graph.nodes, layout],
  );

  useEffect(() => {
    const bounds = svgRef.current?.getBoundingClientRect();
    onLayoutDiagnostics?.({
      positions,
      view: projection.view,
      visibleNodeIds: projection.visibleNodeIds,
      visibleEdgeIds: projection.visibleEdgeIds,
      zoom,
      pan,
      viewport: { width: bounds?.width ?? 0, height: bounds?.height ?? 0 },
      mapWidth: mapMetrics.width,
      mapHeight: mapMetrics.height,
    });
  }, [mapMetrics.height, mapMetrics.width, onLayoutDiagnostics, pan, positions, projection, zoom]);

  useEffect(() => () => {
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
  }, []);

  const edgeSlots = useMemo(() => {
    const groups = new Map<string, string[]>();
    graph.edges.forEach((edge) => {
      const source = graph.nodes.find((node) => node.id === edge.source);
      const target = graph.nodes.find((node) => node.id === edge.target);
      if (!source || !target) return;
      const sourceLane = decisionMapLaneForType(source.type);
      const targetLane = decisionMapLaneForType(target.type);
      const key = `${Math.min(sourceLane ?? -1, targetLane ?? -1)}-${Math.max(sourceLane ?? -1, targetLane ?? -1)}`;
      groups.set(key, [...(groups.get(key) ?? []), edge.id]);
    });
    return new Map(
      [...groups.entries()].flatMap(([, edgeIds]) => edgeIds.map((edgeId, index) => [edgeId, { index, count: edgeIds.length }] as const)),
    );
  }, [graph.edges, graph.nodes]);

  const pointFor = (node: ClarityNode): { x: number; y: number } => {
    const point = positions[node.id];
    return { x: point.x, y: point.y };
  };

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * mapMetrics.width,
      y: ((event.clientY - bounds.top) / bounds.height) * mapMetrics.height,
    };
  };

  const updateViewport = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    setLocalZoom(nextZoom);
    setLocalPan(nextPan);
    onViewportChange?.({ zoom: nextZoom, pan: nextPan });
  }, [onViewportChange]);

  const markZooming = () => {
    setIsZooming(true);
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = window.setTimeout(() => setIsZooming(false), 180);
  };

  const clampZoom = (value: number) => Math.max(MIN_2D_ZOOM, Math.min(MAX_2D_ZOOM, value));

  const setClampedZoom = (nextZoom: number, focalPoint?: { x: number; y: number }) => {
    const boundedZoom = clampZoom(nextZoom);
    const nextPan = focalPoint
      ? {
          x: focalPoint.x - (focalPoint.x - pan.x) * (boundedZoom / zoom),
          y: focalPoint.y - (focalPoint.y - pan.y) * (boundedZoom / zoom),
        }
      : pan;
    markZooming();
    updateViewport(boundedZoom, nextPan);
  };

  const setPanned = (nextPan: { x: number; y: number }) => updateViewport(zoom, nextPan);

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = panRef.current;
    if (!drag) return;
    const point = localPoint(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.mode === 'canvas') {
      setPanned({ x: pan.x + dx, y: pan.y + dy });
      drag.startX = point.x;
      drag.startY = point.y;
      return;
    }
    if (drag.nodeId) {
      setDraggedPositions((current) => ({
        ...current,
        [drag.nodeId as string]: { x: (point.x - pan.x) / zoom, y: (point.y - pan.y) / zoom, z: 0 },
      }));
    }
  };

  const fitToView = useCallback(() => {
    const visibleNodes = graph.nodes;
    if (visibleNodes.length === 0) {
      updateViewport(1, { x: 0, y: 0 });
      return;
    }

    const bounds = visibleNodes.reduce((current, node) => {
      const point = positions[node.id] ?? { x: 0, y: 0 };
      const dimensions = decisionMapNodeDimensions(node, false);
      return {
        minX: Math.min(current.minX, point.x - dimensions.width / 2),
        maxX: Math.max(current.maxX, point.x + dimensions.width / 2),
        minY: Math.min(current.minY, point.y - dimensions.height / 2),
        maxY: Math.max(current.maxY, point.y + dimensions.height / 2),
      };
    }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    const padding = 72;
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    const availableWidth = Math.max(1, mapMetrics.width - padding * 2);
    const availableHeight = Math.max(1, mapMetrics.height - padding * 2);
    const nextZoom = clampZoom(Math.min(availableWidth / contentWidth, availableHeight / contentHeight));
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    updateViewport(nextZoom, {
      x: mapMetrics.width / 2 - centerX * nextZoom,
      y: mapMetrics.height / 2 - centerY * nextZoom,
    });
  }, [graph.nodes, mapMetrics.height, mapMetrics.width, positions, updateViewport]);

  useEffect(() => {
    const wasExpanded = previousExpandedRef.current;
    previousExpandedRef.current = expanded;
    if (!expanded || wasExpanded || zoom !== 1 || pan.x !== 0 || pan.y !== 0) return;
    const frame = window.requestAnimationFrame(fitToView);
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, fitToView, pan.x, pan.y, zoom]);

  const laneMetrics = isAllView
    ? mapMetrics as ReturnType<typeof calculateDecisionMapMetrics>
    : null;

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${mapMetrics.width} ${mapMetrics.height}`}
        className="h-full w-full touch-pan-y select-none"
        style={{ touchAction: 'pan-y' }}
        role="img"
        aria-label="Interactive two-dimensional Gapwise decision map"
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const point = localPoint(event);
          const factor = Math.exp(-event.deltaY * 0.0012);
          setClampedZoom(zoom * factor, point);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (event.pointerType === 'touch') {
            const point = localPoint(event);
            touchPointsRef.current.set(event.pointerId, point);
            if (touchPointsRef.current.size === 2) {
              const points = [...touchPointsRef.current.values()];
              pinchRef.current = {
                distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
                zoom,
                pan,
              };
              panRef.current = null;
              return;
            }
          }
          const point = localPoint(event);
          panRef.current = { mode: 'canvas', startX: point.x, startY: point.y, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'touch') {
            touchPointsRef.current.set(event.pointerId, localPoint(event));
            const pinch = pinchRef.current;
            if (pinch && touchPointsRef.current.size >= 2) {
              event.preventDefault();
              const points = [...touchPointsRef.current.values()];
              const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
              const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
              const nextZoom = clampZoom(pinch.zoom * (distance / Math.max(1, pinch.distance)));
              updateViewport(nextZoom, {
                x: center.x - (center.x - pinch.pan.x) * (nextZoom / pinch.zoom),
                y: center.y - (center.y - pinch.pan.y) * (nextZoom / pinch.zoom),
              });
              return;
            }
          }
          handlePointerMove(event);
        }}
        onPointerUp={(event) => {
          if (event.pointerType === 'touch') {
            touchPointsRef.current.delete(event.pointerId);
            if (touchPointsRef.current.size < 2) pinchRef.current = null;
          }
          suppressClickRef.current = panRef.current?.moved ?? false;
          panRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          touchPointsRef.current.clear();
          pinchRef.current = null;
          panRef.current = null;
          suppressClickRef.current = false;
        }}
      >
        <defs>
          <pattern id="decision-map-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#38bdf8" opacity="0.16" />
          </pattern>
          {(Object.keys(EDGE_COLORS) as ClarityEdge['type'][]).map((type) => (
            <marker
              key={type}
              id={`decision-arrow-${type}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill={EDGE_COLORS[type]} />
            </marker>
          ))}
        </defs>
        <rect width={mapMetrics.width} height={mapMetrics.height} fill="#040b17" pointerEvents="none" />
        <rect width={mapMetrics.width} height={mapMetrics.height} fill="url(#decision-map-grid)" opacity="0.8" pointerEvents="none" />
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`} style={{ transition: isZooming ? 'transform 140ms ease-out' : undefined }}>
          <g>
            {isAllView ? DECISION_MAP_LANES.map((lane) => {
              const y = laneMetrics!.laneY[lane];
              const previousY = lane === 0 ? 28 : laneMetrics!.laneY[(lane - 1) as 0 | 1 | 2 | 3 | 4];
              const nextY = lane === 4 ? mapMetrics.height - 28 : laneMetrics!.laneY[(lane + 1) as 0 | 1 | 2 | 3 | 4];
              const top = lane === 0 ? 28 : (previousY + y) / 2;
              const bottom = lane === 4 ? mapMetrics.height - 28 : (y + nextY) / 2;
              return (
                <g key={lane}>
                  <rect x="48" y={top + 12} width="1240" height={Math.max(80, bottom - top - 24)} fill={lane === 4 ? '#064e3b' : '#07111f'} opacity={lane === 4 ? 0.18 : 0.2} />
                  <line x1="48" x2="1288" y1={top} y2={top} stroke={lane === 4 ? '#10b981' : '#16304a'} strokeWidth="1" opacity="0.65" />
                  <text x="68" y={top + 28} className="fill-slate-500 text-[10px] font-extrabold uppercase tracking-[0.16em]">
                    {DECISION_MAP_LANE_LABELS[lane]}
                  </text>
                </g>
              );
            }) : (
              <text x="68" y="34" className="fill-slate-500 text-[10px] font-extrabold uppercase tracking-[0.16em]">
                {projection.view === 'focus' ? 'CURRENT FOCUS' : 'PROJECT STORY'}
              </text>
            )}
          </g>
          {graph.edges.map((edge, index) => {
            const source = graph.nodes.find((node) => node.id === edge.source);
            const target = graph.nodes.find((node) => node.id === edge.target);
            if (!source || !target) return null;
            const sourcePoint = pointFor(source);
            const targetPoint = pointFor(target);
            const sourceDimensions = decisionMapNodeDimensions(source, false);
            const targetDimensions = decisionMapNodeDimensions(target, false);
            const start = edgeBoundaryPoint(sourcePoint, targetPoint, sourceDimensions);
            const end = edgeBoundaryPoint(targetPoint, sourcePoint, targetDimensions);
            const slot = edgeSlots.get(edge.id) ?? { index: index % 3, count: 3 };
            const geometry = edgeGeometry(start, end, slot.index, slot.count);
            const highlighted = edgeIsHighlighted(edge, emphasizedNodes, pathEdgeIds);
            const muted = Boolean(emphasizedNodes) && !highlighted;
            const important = IMPORTANT_EDGE_TYPES.has(edge.type) && (edge.confidence ?? 1) >= 0.6;
            const opacity = muted ? 0.07 : highlighted ? 1 : important ? 0.62 : 0.2;
            const showLabel = important || highlighted;
            return (
              <g key={edge.id} opacity={opacity}>
                <path
                  d={geometry.path}
                  fill="none"
                  stroke={EDGE_COLORS[edge.type]}
                  strokeWidth={highlighted ? 3 : important ? 2 : 1}
                  strokeDasharray={edge.type === 'blocks' || edge.type === 'contradicts' ? '7 5' : undefined}
                  markerEnd={`url(#decision-arrow-${edge.type})`}
                />
                {showLabel && (
                  <g>
                    <rect
                      x={geometry.labelX - Math.max(24, relationshipLabel(edge.type).length * 3.2 + 8)}
                      y={geometry.labelY - 12}
                      width={Math.max(48, relationshipLabel(edge.type).length * 6.4 + 16)}
                      height="18"
                      rx="5"
                      fill="#040b17"
                      opacity="0.9"
                    />
                    <text
                      x={geometry.labelX}
                      y={geometry.labelY}
                      textAnchor="middle"
                      className="fill-slate-300 text-[9px] font-bold uppercase tracking-wide"
                    >
                      {relationshipLabel(edge.type)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          {graph.nodes.map((node, index) => {
            const point = pointFor(node);
            const muted = Boolean(emphasizedNodes) && !emphasizedNodes?.has(node.id);
            const highlighted = node.id === selectedNodeId || Boolean(emphasizedNodes?.has(node.id));
            const dimensions = decisionMapNodeDimensions(node, false);
            const color = NODE_COLORS[node.type];
            const isGoal = node.type === 'GOAL';
            const cluster = projection.clusters.find((item) => item.parentNodeId === node.id);
            const clusterExpanded = expandedClusterIds.has(node.id);
            return (
              <g key={node.id} opacity={muted ? 0.14 : 1} style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}>
                <foreignObject
                  x={point.x - dimensions.width / 2}
                  y={point.y - dimensions.height / 2}
                  width={dimensions.width}
                  height={dimensions.height}
                  className="constellation-node-enter overflow-visible"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (!editMode) {
                      suppressClickRef.current = false;
                      return;
                    }
                    const local = localPoint(event);
                    panRef.current = { mode: 'node', nodeId: node.id, startX: local.x, startY: local.y, moved: false };
                    svgRef.current?.setPointerCapture(event.pointerId);
                  }}
                  onPointerOver={(event) => {
                    event.stopPropagation();
                    setHoveredNodeId(node.id);
                  }}
                  onPointerOut={() => setHoveredNodeId(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!suppressClickRef.current) onSelectNode(node);
                    suppressClickRef.current = false;
                  }}
                >
                  <div
                    className={`h-full w-full ${editMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} rounded-xl border p-3 text-left shadow-lg transition ${highlighted ? 'ring-2 ring-cyan-300/90' : isGoal ? 'ring-2 ring-emerald-400/80' : ''}`}
                    style={{ borderColor: `${color}${highlighted || isGoal ? 'ee' : '99'}`, backgroundColor: `${color}22` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[9px] font-extrabold uppercase tracking-[0.14em]" style={{ color }}>{node.type.replace('_', ' ')}</span>
                      {isGoal && <span className="text-[9px] font-bold text-emerald-300">PRIMARY</span>}
                    </div>
                    <p className="mt-2 break-words text-[11px] font-semibold leading-snug text-slate-100 line-clamp-6">
                      {node.text}
                    </p>
                    {cluster && (
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleCluster(node.id);
                        }}
                        className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-600/80 bg-slate-950/60 px-1.5 py-1 text-[9px] font-bold text-slate-300 hover:border-cyan-700 hover:text-cyan-200"
                        aria-expanded={clusterExpanded}
                      >
                        {cluster.childNodeIds.length} inputs {clusterExpanded ? '−' : '+'}
                      </button>
                    )}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-700/90 bg-slate-950/90 p-1 text-slate-200 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => setClampedZoom(zoom - ZOOM_STEP)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-cyan-300"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => updateViewport(1, pan)}
          className="min-w-14 rounded-md px-2 text-center text-[11px] font-bold tabular-nums text-slate-300 transition hover:bg-slate-800 hover:text-cyan-300"
          aria-label="Reset zoom to 100 percent"
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setClampedZoom(zoom + ZOOM_STEP)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-cyan-300"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={fitToView}
          className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-slate-300 transition hover:bg-slate-800 hover:text-cyan-300"
          aria-label="Fit decision map to view"
          title="Fit to view"
        >
          <Scan className="h-4 w-4" />
          <span>Fit</span>
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMoreMenu((current) => !current)}
            onPointerDown={(event) => event.stopPropagation()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-cyan-300"
            aria-label="More Decision Map actions"
            aria-expanded={showMoreMenu}
            title="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {showMoreMenu && (
            <div className="absolute right-0 top-10 z-30 min-w-40 rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  onEditModeChange(!editMode);
                  setShowMoreMenu(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-bold ${editMode ? 'bg-cyan-900/70 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-300'}`}
                aria-pressed={editMode}
              >
                <Pencil className="h-3.5 w-3.5" />
                {editMode ? 'Stop arranging' : 'Arrange nodes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConstellationGraph({
  project,
  projection,
  expandedClusterIds,
  onToggleCluster,
  selectedNodeId,
  focusMode,
  pathMode,
  focusNodeId,
  dimension,
  expanded = false,
  viewport,
  onViewportChange,
  isFullscreen = false,
  onToggleFullscreen,
  onSelectNode,
  onLayoutDiagnostics,
}: ConstellationGraphProps) {
  const [editMode, setEditMode] = useState(false);

  return (
    <div className={`relative min-w-0 overflow-hidden rounded-xl border border-cyan-950/80 bg-[#040b17] ${expanded ? 'h-full min-h-0' : 'h-[560px] min-h-[520px] sm:h-[600px]'}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(14,116,144,0.16),transparent_42%)]" />
      {onToggleFullscreen && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onToggleFullscreen}
          className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/90 bg-slate-950/90 text-slate-300 shadow-lg backdrop-blur transition hover:border-cyan-700 hover:text-cyan-200"
          aria-label={isFullscreen ? 'Exit full screen' : 'Open full screen'}
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      )}
      {projection.view === 'story' ? (
        <ProjectStoryGraph
          project={project}
          projection={projection}
          selectedNodeId={selectedNodeId}
          focusNodeId={focusNodeId}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onLayoutDiagnostics={onLayoutDiagnostics}
          onSelectNode={onSelectNode}
        />
      ) : dimension === '3d' ? (
        <Canvas
          camera={{ position: [0, 0, 12], fov: 45 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor('#040b17', 1)}
          aria-label="Interactive three-dimensional Gapwise constellation graph"
        >
          <GraphScene
            project={project}
            projection={projection}
            expandedClusterIds={expandedClusterIds}
            onToggleCluster={onToggleCluster}
            selectedNodeId={selectedNodeId}
            focusMode={focusMode}
            pathMode={pathMode}
            editMode={editMode}
            onEditModeChange={setEditMode}
            onSelectNode={onSelectNode}
          />
        </Canvas>
      ) : (
        <Constellation2D
          project={project}
          projection={projection}
          expandedClusterIds={expandedClusterIds}
          onToggleCluster={onToggleCluster}
          selectedNodeId={selectedNodeId}
          focusMode={focusMode}
          pathMode={pathMode}
          editMode={editMode}
          onEditModeChange={setEditMode}
          expanded={expanded}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onLayoutDiagnostics={onLayoutDiagnostics}
          onSelectNode={onSelectNode}
        />
      )}
      {dimension === '3d' && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-700/90 bg-slate-950/90 p-1 text-slate-200 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => setEditMode((current) => !current)}
            className={`inline-flex h-9 items-center gap-1 rounded-md px-2 text-[11px] font-bold transition ${editMode ? 'bg-cyan-900/70 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-300'}`}
            aria-label={editMode ? 'Disable arrange mode' : 'Enable arrange mode'}
            aria-pressed={editMode}
            title={editMode ? 'Disable arrange mode' : 'Arrange nodes'}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>{editMode ? 'Arranging' : 'Arrange'}</span>
          </button>
        </div>
      )}
      {projection.view !== 'story' && <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
        <span>
          {dimension === '3d'
            ? `Drag to orbit · scroll to zoom${editMode ? ' · arrange mode on' : ''}`
            : `Drag background to pan · Use + / − to zoom${editMode ? ' · arrange mode on' : ''}`}
        </span>
        <span className="text-cyan-400/80">{projection.visibleNodeIds.length} shown · {projection.visibleEdgeIds.length} relationships</span>
      </div>}
    </div>
  );
}
