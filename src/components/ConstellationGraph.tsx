'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { Scan } from 'lucide-react';
import * as THREE from 'three';
import { ClarityEdge, ClarityNode, Project } from '@/types/clarity';
import {
  buildDecisionPath,
  calculateConstellationLayout,
  calculateDecisionMapLayout,
  ConstellationPoint,
  DECISION_MAP_LANE_LABELS,
  getNeighborhood,
  isDecisionMapSecondaryNode,
} from '@/lib/graph/constellation';

type Dimension = '2d' | '3d';

interface ConstellationGraphProps {
  project: Project;
  selectedNodeId: string | null;
  focusMode: boolean;
  pathMode: boolean;
  dimension: Dimension;
  expanded?: boolean;
  onSelectNode: (node: ClarityNode) => void;
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
  selectedNodeId: string | null;
  focusMode: boolean;
  pathMode: boolean;
  onSelectNode: (node: ClarityNode) => void;
}

function GraphScene({ project, selectedNodeId, focusMode, pathMode, onSelectNode }: GraphSceneProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggedPositions, setDraggedPositions] = useState<Record<string, ConstellationPoint>>({});
  const [isDragging, setIsDragging] = useState(false);
  const layout = useMemo(() => calculateConstellationLayout(project), [project]);
  const decisionPath = useMemo(
    () => (selectedNodeId && pathMode ? buildDecisionPath(project, selectedNodeId) : { nodeIds: [], edgeIds: [] }),
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
    () => project.nodes.reduce<Record<string, ConstellationPoint>>((result, node) => {
      result[node.id] = draggedPositions[node.id] ?? layout[node.id] ?? { x: 0, y: 0, z: 0 };
      return result;
    }, {}),
    [draggedPositions, layout, project.nodes],
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
      {project.edges.map((edge) => {
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
      {project.nodes.map((node) => {
        const point = positions[node.id];
        const muted = Boolean(emphasizedNodes) && !emphasizedNodes?.has(node.id);
        const highlighted = node.id === selectedNodeId || Boolean(emphasizedNodes?.has(node.id));
        const labelVisible = !muted && (highlighted || node.type === 'GOAL' || node.type === 'UNKNOWN' || !emphasizedNodes);
        return (
          <Node3D
            key={node.id}
            node={node}
            position={tuple(point)}
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

const DECISION_MAP_WIDTH = 1200;
const DECISION_MAP_HEIGHT = 700;
const DECISION_MAP_LANES = [0, 1, 2, 3, 4] as const;
const IMPORTANT_EDGE_TYPES = new Set<ClarityEdge['type']>([
  'blocks',
  'supports',
  'contradicts',
  'resolves',
  'affects',
  'depends_on',
  'supersedes',
]);

function relationshipLabel(type: ClarityEdge['type']): string {
  return type.replaceAll('_', ' ');
}

function nodeDimensions(node: ClarityNode, secondary: boolean): { width: number; height: number } {
  if (secondary) return { width: 100, height: 70 };
  if (node.type === 'GOAL') return { width: 230, height: 90 };
  return { width: 190, height: 78 };
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
  index: number,
): { path: string; labelX: number; labelY: number } {
  const midY = (start.y + end.y) / 2;
  const bend = ((index % 3) - 1) * 28;
  return {
    path: `M ${start.x} ${start.y} C ${start.x + bend} ${midY} ${end.x + bend} ${midY} ${end.x} ${end.y}`,
    labelX: (start.x + end.x) / 2 + bend,
    labelY: midY - 7,
  };
}

function Constellation2D({ project, selectedNodeId, focusMode, pathMode, onSelectNode }: GraphSceneProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<PanState | null>(null);
  const suppressClickRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggedPositions, setDraggedPositions] = useState<Record<string, ConstellationPoint>>({});
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const layout = useMemo(() => calculateDecisionMapLayout(project), [project]);
  const decisionPath = useMemo(
    () => (selectedNodeId && pathMode ? buildDecisionPath(project, selectedNodeId) : { nodeIds: [], edgeIds: [] }),
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
    () => project.nodes.reduce<Record<string, ConstellationPoint>>((result, node) => {
      result[node.id] = draggedPositions[node.id] ?? layout[node.id] ?? { x: 0, y: 0, z: 0 };
      return result;
    }, {}),
    [draggedPositions, layout, project.nodes],
  );

  const pointFor = (node: ClarityNode): { x: number; y: number } => {
    const point = positions[node.id];
    return { x: point.x, y: point.y };
  };

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * DECISION_MAP_WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * DECISION_MAP_HEIGHT,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = panRef.current;
    if (!drag) return;
    const point = localPoint(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.mode === 'canvas') {
      setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
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

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${DECISION_MAP_WIDTH} ${DECISION_MAP_HEIGHT}`}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label="Interactive two-dimensional Gapswise decision map"
        onWheel={(event) => {
          event.preventDefault();
          setZoom((current) => Math.max(0.55, Math.min(1.8, current + (event.deltaY > 0 ? -0.08 : 0.08))));
        }}
        onPointerDown={(event) => {
          const point = localPoint(event);
          panRef.current = { mode: 'canvas', startX: point.x, startY: point.y, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => {
          suppressClickRef.current = panRef.current?.moved ?? false;
          panRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
        <rect width={DECISION_MAP_WIDTH} height={DECISION_MAP_HEIGHT} fill="url(#decision-map-grid)" opacity="0.8" />
        <g aria-hidden="true">
          {DECISION_MAP_LANES.map((lane) => {
            const y = [76, 204, 332, 460, 588][lane];
            return (
              <g key={lane}>
                <rect x="48" y={y - 50} width="960" height="100" rx="18" fill={lane === 4 ? '#064e3b' : '#07111f'} opacity={lane === 4 ? 0.32 : 0.66} stroke={lane === 4 ? '#10b981' : '#16304a'} strokeWidth="1" />
                <text x="68" y={y - 27} className="fill-slate-500 text-[10px] font-extrabold uppercase tracking-[0.16em]">
                  {DECISION_MAP_LANE_LABELS[lane]}
                </text>
              </g>
            );
          })}
          <rect x="1020" y="42" width="170" height="620" rx="18" fill="#07111f" opacity="0.5" stroke="#16304a" strokeWidth="1" />
          <text x="1038" y="72" className="fill-slate-500 text-[10px] font-extrabold uppercase tracking-[0.16em]">Other context</text>
        </g>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {project.edges.map((edge, index) => {
            const source = project.nodes.find((node) => node.id === edge.source);
            const target = project.nodes.find((node) => node.id === edge.target);
            if (!source || !target) return null;
            const sourcePoint = pointFor(source);
            const targetPoint = pointFor(target);
            const sourceDimensions = nodeDimensions(source, isDecisionMapSecondaryNode(source, project));
            const targetDimensions = nodeDimensions(target, isDecisionMapSecondaryNode(target, project));
            const start = edgeBoundaryPoint(sourcePoint, targetPoint, sourceDimensions);
            const end = edgeBoundaryPoint(targetPoint, sourcePoint, targetDimensions);
            const geometry = edgeGeometry(start, end, index);
            const highlighted = edgeIsHighlighted(edge, emphasizedNodes, pathEdgeIds);
            const muted = Boolean(emphasizedNodes) && !highlighted;
            const important = IMPORTANT_EDGE_TYPES.has(edge.type) && (edge.confidence ?? 1) >= 0.6;
            const opacity = muted ? 0.07 : highlighted ? 1 : important ? 0.62 : 0.2;
            const showLabel = important || highlighted || pathMode;
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
                  <text
                    x={geometry.labelX}
                    y={geometry.labelY}
                    textAnchor="middle"
                    className="fill-slate-300 text-[9px] font-bold uppercase tracking-wide"
                    stroke="#040b17"
                    strokeWidth="4"
                    paintOrder="stroke"
                  >
                    {relationshipLabel(edge.type)}
                  </text>
                )}
              </g>
            );
          })}
          {project.nodes.map((node, index) => {
            const point = pointFor(node);
            const secondary = isDecisionMapSecondaryNode(node, project);
            const muted = Boolean(emphasizedNodes) && !emphasizedNodes?.has(node.id);
            const highlighted = node.id === selectedNodeId || Boolean(emphasizedNodes?.has(node.id));
            const dimensions = nodeDimensions(node, secondary);
            const color = NODE_COLORS[node.type];
            const isGoal = node.type === 'GOAL';
            return (
              <g key={node.id} opacity={muted ? 0.14 : secondary ? 0.72 : 1} style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}>
                <foreignObject
                  x={point.x - dimensions.width / 2}
                  y={point.y - dimensions.height / 2}
                  width={dimensions.width}
                  height={dimensions.height}
                  className="constellation-node-enter overflow-visible"
                  onPointerDown={(event) => {
                    event.stopPropagation();
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
                    className={`h-full w-full cursor-grab overflow-hidden rounded-xl border p-2.5 text-left shadow-lg transition active:cursor-grabbing ${highlighted ? 'ring-2 ring-cyan-300/90' : isGoal ? 'ring-2 ring-emerald-400/80' : ''}`}
                    style={{ borderColor: `${color}${highlighted || isGoal ? 'ee' : '99'}`, backgroundColor: secondary ? '#08111ecc' : `${color}22` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[9px] font-extrabold uppercase tracking-[0.14em]" style={{ color }}>{node.type.replace('_', ' ')}</span>
                      {isGoal && <span className="text-[9px] font-bold text-emerald-300">PRIMARY</span>}
                    </div>
                    <p className={`mt-1 break-words text-[11px] font-semibold leading-tight ${secondary ? 'text-slate-400' : 'text-slate-100'} line-clamp-3`}>
                      {node.text}
                    </p>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
      <button
        type="button"
        onClick={() => {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }}
        className="absolute left-3 top-3 inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-700/90 bg-slate-950/90 p-2 text-slate-200 shadow-lg backdrop-blur transition hover:border-cyan-600 hover:text-cyan-300"
        aria-label="Fit decision map to view"
        title="Fit to view"
      >
        <Scan className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function ConstellationGraph({
  project,
  selectedNodeId,
  focusMode,
  pathMode,
  dimension,
  expanded = false,
  onSelectNode,
}: ConstellationGraphProps) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-cyan-950/80 bg-[#040b17] ${expanded ? 'h-full min-h-0' : 'h-[520px] sm:h-[600px]'}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(14,116,144,0.16),transparent_42%)]" />
      {dimension === '3d' ? (
        <Canvas
          camera={{ position: [0, 0, 12], fov: 45 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearColor('#040b17', 1)}
          aria-label="Interactive three-dimensional Gapswise constellation graph"
        >
          <GraphScene
            project={project}
            selectedNodeId={selectedNodeId}
            focusMode={focusMode}
            pathMode={pathMode}
            onSelectNode={onSelectNode}
          />
        </Canvas>
      ) : (
        <Constellation2D
          project={project}
          selectedNodeId={selectedNodeId}
          focusMode={focusMode}
          pathMode={pathMode}
          onSelectNode={onSelectNode}
        />
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
        <span>{dimension === '3d' ? 'Drag to orbit · scroll to zoom · drag a node to reposition' : 'Drag to pan · scroll to zoom · drag a node to reposition'}</span>
        <span className="text-cyan-400/80">{project.nodes.length} nodes · {project.edges.length} relationships</span>
      </div>
    </div>
  );
}
