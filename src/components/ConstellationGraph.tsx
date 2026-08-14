'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ClarityEdge, ClarityNode, Project } from '@/types/clarity';
import {
  buildDecisionPath,
  calculateConstellationLayout,
  ConstellationPoint,
  getNeighborhood,
} from '@/lib/graph/constellation';

type Dimension = '2d' | '3d';

interface ConstellationGraphProps {
  project: Project;
  selectedNodeId: string | null;
  focusMode: boolean;
  pathMode: boolean;
  dimension: Dimension;
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

function Constellation2D({ project, selectedNodeId, focusMode, pathMode, onSelectNode }: GraphSceneProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<PanState | null>(null);
  const suppressClickRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 450, y: 275 });
  const [draggedPositions, setDraggedPositions] = useState<Record<string, ConstellationPoint>>({});
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
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

  const pointFor = (node: ClarityNode): { x: number; y: number } => {
    const point = positions[node.id];
    return { x: point.x * 38, y: point.y * 38 };
  };

  const localPoint = (event: React.PointerEvent<SVGElement>) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 900,
      y: ((event.clientY - bounds.top) / bounds.height) * 550,
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
        [drag.nodeId as string]: { x: (point.x - pan.x) / zoom / 38, y: (point.y - pan.y) / zoom / 38, z: 0 },
      }));
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 900 550"
      className="h-full w-full touch-none select-none"
      role="img"
      aria-label="Interactive two-dimensional Gapswise constellation graph"
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
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <defs>
        <pattern id="constellation-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#38bdf8" opacity="0.2" />
        </pattern>
      </defs>
      <rect width="900" height="550" fill="url(#constellation-grid)" opacity="0.75" />
      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {project.edges.map((edge) => {
          const source = project.nodes.find((node) => node.id === edge.source);
          const target = project.nodes.find((node) => node.id === edge.target);
          if (!source || !target) return null;
          const start = pointFor(source);
          const end = pointFor(target);
          const highlighted = edgeIsHighlighted(edge, emphasizedNodes, pathEdgeIds);
          const muted = Boolean(emphasizedNodes) && !highlighted;
          return (
            <g key={edge.id} opacity={muted ? 0.08 : highlighted ? 1 : 0.35}>
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={EDGE_COLORS[edge.type]}
                strokeWidth={highlighted ? 2.5 : 1.2}
                strokeDasharray={edge.type === 'blocks' || edge.type === 'contradicts' ? '6 5' : undefined}
              />
              {(highlighted || pathMode) && (
                <text
                  x={(start.x + end.x) / 2}
                  y={(start.y + end.y) / 2 - 5}
                  textAnchor="middle"
                  className="fill-slate-400 text-[9px] font-semibold"
                >
                  {edge.type.replace('_', ' ')}
                </text>
              )}
            </g>
          );
        })}
        {project.nodes.map((node, index) => {
          const point = pointFor(node);
          const muted = Boolean(emphasizedNodes) && !emphasizedNodes?.has(node.id);
          const highlighted = node.id === selectedNodeId || Boolean(emphasizedNodes?.has(node.id));
          const radius = node.type === 'GOAL' ? 14 : node.type === 'UNKNOWN' ? 12 : 9;
          return (
            <g
              key={node.id}
              transform={`translate(${point.x} ${point.y})`}
              className="constellation-node-enter cursor-grab active:cursor-grabbing"
              opacity={muted ? 0.17 : 1}
              style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}
              onPointerDown={(event) => {
                event.stopPropagation();
                const local = localPoint(event);
                panRef.current = { mode: 'node', nodeId: node.id, startX: local.x, startY: local.y, moved: false };
              }}
              onPointerOver={() => setHoveredNodeId(node.id)}
              onPointerOut={() => setHoveredNodeId(null)}
              onClick={(event) => {
                event.stopPropagation();
                if (!suppressClickRef.current) onSelectNode(node);
                suppressClickRef.current = false;
              }}
            >
              {(node.type === 'GOAL' || node.type === 'UNKNOWN' || highlighted) && (
                <circle r={radius + 7} fill="none" stroke={NODE_COLORS[node.type]} strokeWidth="1.5" opacity="0.7" />
              )}
              <circle
                r={radius}
                fill={NODE_COLORS[node.type]}
                stroke="#06101e"
                strokeWidth="3"
                className={highlighted ? 'constellation-node-pulse' : undefined}
              />
              {!muted && (
                <text x={radius + 7} y="4" className="fill-slate-100 text-[11px] font-semibold">
                  {shorten(node.text, 42)}
                </text>
              )}
              {!muted && (
                <text x={radius + 7} y="-9" className="fill-slate-500 text-[8px] font-extrabold uppercase tracking-[0.16em]">
                  {node.type}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function ConstellationGraph({
  project,
  selectedNodeId,
  focusMode,
  pathMode,
  dimension,
  onSelectNode,
}: ConstellationGraphProps) {
  return (
    <div className="relative h-[520px] overflow-hidden rounded-xl border border-cyan-950/80 bg-[#040b17] sm:h-[600px]">
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
