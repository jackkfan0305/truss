"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  useReactFlow,
  useStore,
  type EdgeProps,
  type ReactFlowState,
} from "@xyflow/react";

import { useIsFreshArrival } from "@/components/canvas/canvas-motion-context";
import {
  buildEdgeRoute,
  orthogonalPath,
  type EdgeRoute,
} from "@/lib/canvas-geometry";
import {
  CANVAS_EDGE_STYLE,
  CORNER_RADIUS,
  type CanvasEdge,
  type CanvasEdgeData,
  type CanvasNode,
} from "@/types/canvas";

/**
 * Renderer for the `canvasEdge` type (16-edge-behavior).
 *
 * Edges are visually secondary to nodes, so they sit dimmed until they are the
 * thing being looked at. Labels write through `updateEdgeData`, which is the
 * same controlled path node labels already use — so an edit reaches Liveblocks
 * Storage via `onEdgesChange` with no new plumbing.
 */

/** Dimmed at rest, full strength when hovered, selected or being labelled. */
const REST_OPACITY = 0.55;

const LABEL_PLACEHOLDER = "Label";

/** The faint prompt on an active, unlabelled edge. */
const LABEL_HINT = "+ label";

/** Keeps the empty input wide enough to aim at before anything is typed. */
const MIN_LABEL_CHARS = 5;

const LABEL_BASE_CLASS =
  "nodrag nopan nokey rounded-xl border px-2 py-0.5 text-xs leading-tight";

/** Left and right handles sit on a vertical face, so their fan spreads on y. */
function isSideFace(position: Position): boolean {
  return position === Position.Left || position === Position.Right;
}

/**
 * This edge's lane, and its place among any parallel edges sharing both its
 * endpoints: `lane:parallelIndex:parallelCount`.
 *
 * Packed into a string on purpose. A selector returning an object hands back a
 * fresh reference on every store change, and the default `Object.is` compare
 * would then re-render every edge on every frame of a node drag. A string
 * compares by value.
 *
 * The lane comes from `data.lane`, stamped by `applyLayout`, so dragging never
 * reshuffles a bundle. A hand-drawn edge that never went through layout has no
 * lane; those fall back to an id sort among the laneless members of their own
 * bundle — arbitrary but fixed, which is all the fallback has to be.
 */
function readLaneSlots(store: ReactFlowState, edgeId: string): string {
  const edge = store.edgeLookup.get(edgeId);

  if (!edge) {
    return "0:0:1";
  }

  const bundle = store.edges.filter(
    (candidate) =>
      candidate.source === edge.source &&
      candidate.sourceHandle === edge.sourceHandle
  );

  const laneOf = (candidate: (typeof bundle)[number]) =>
    (candidate.data as CanvasEdgeData | undefined)?.lane;

  const lane =
    laneOf(edge) ??
    bundle
      .filter((candidate) => laneOf(candidate) === undefined)
      .map((candidate) => candidate.id)
      .sort()
      .indexOf(edgeId);

  // One `Handle` per side serves both directions (`canvas-node.tsx` renders
  // them all as `type="source"`, and the canvas runs `ConnectionMode.Loose`),
  // so a parallel group is keyed on all four of these.
  const parallel = bundle
    .filter(
      (candidate) =>
        candidate.target === edge.target &&
        candidate.targetHandle === edge.targetHandle
    )
    .map((candidate) => candidate.id)
    .sort();

  return `${Math.max(0, lane)}:${Math.max(0, parallel.indexOf(edgeId))}:${
    parallel.length || 1
  }`;
}

export function CanvasEdgeRenderer({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  selected,
  markerEnd,
  style,
}: EdgeProps<CanvasEdge>) {
  const { updateEdgeData } = useReactFlow<CanvasNode, CanvasEdge>();
  const isFreshArrival = useIsFreshArrival();
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const laneSlots = useStore(
    useCallback((store: ReactFlowState) => readLaneSlots(store, id), [id])
  );

  // A lane is a claim about the node-free band between two ranks. An edge on a
  // top or bottom handle is not crossing that band — its `sourceX` there is the
  // node's own centre line, not the edge of its rank — so those keep React
  // Flow's own route and label point.
  const isSideToSide = isSideFace(sourcePosition) && isSideFace(targetPosition);

  const route = useMemo((): EdgeRoute => {
    const [lane, parallelIndex, parallelCount] = laneSlots.split(":").map(Number);

    return buildEdgeRoute({
      source: { x: sourceX, y: sourceY },
      target: { x: targetX, y: targetY },
      lane,
      parallelIndex,
      parallelCount,
    });
  }, [laneSlots, sourceX, sourceY, targetX, targetY]);

  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: CORNER_RADIUS,
  });

  const path = isSideToSide ? orthogonalPath(route.points) : smoothPath;
  const labelX = isSideToSide ? route.labelPoint.x : smoothLabelX;
  const labelY = isSideToSide ? route.labelPoint.y : smoothLabelY;

  const label = data?.label ?? "";
  const isActive = isHovered || selected === true || isEditing;

  const show = useCallback(() => setIsHovered(true), []);
  const hide = useCallback(() => setIsHovered(false), []);
  const startEditing = useCallback(() => setIsEditing(true), []);
  const stopEditing = useCallback(() => setIsEditing(false), []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" && event.key !== "Escape") {
        return;
      }

      // Otherwise React Flow's own key handling reads it too — Enter is one of
      // its selection keys, so it would toggle the edge selection back on.
      event.stopPropagation();
      setIsEditing(false);
    },
    []
  );

  const labelStyle = {
    position: "absolute" as const,
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
    // The `EdgeLabelRenderer` container is `pointer-events: none` so it does not
    // swallow clicks on the canvas; each label opts itself back in.
    pointerEvents: "all" as const,
  };

  return (
    <>
      {/*
       * Opacity sits on the group rather than on the stroke: a marker is painted
       * as part of its path's rendering, so this dims the line and the arrowhead
       * together instead of leaving a full-strength arrow on a faded edge.
       */}
      <g
        className="canvas-edge"
        style={{ opacity: isActive ? 1 : REST_OPACITY }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onDoubleClick={startEditing}
      >
        {/*
         * `BaseEdge` draws a second, transparent path at `interactionWidth`
         * (20px) over the visible one, so the hit area widens without the drawn
         * stroke changing.
         */}
        <BaseEdge
          path={path}
          markerEnd={markerEnd}
          // An edge that arrives while the canvas is on screen draws itself
          // along its own path (32-live-canvas-building). `pathLength`
          // normalises the geometry to 1, so one dash length covers any route
          // and the CSS needs no knowledge of how long this particular edge is.
          className={isFreshArrival ? "canvas-edge-draw" : undefined}
          pathLength={isFreshArrival ? 1 : undefined}
          style={{ ...CANVAS_EDGE_STYLE, ...style }}
        />
      </g>
      {label || isActive ? (
        <EdgeLabelRenderer>
          <div
            style={labelStyle}
            onMouseEnter={show}
            onMouseLeave={hide}
            onDoubleClick={startEditing}
          >
            {isEditing ? (
              <input
                // The editor only exists because the label was just
                // double-clicked, so there is nowhere else focus belongs.
                autoFocus
                className={`${LABEL_BASE_CLASS} border-surface-border-subtle bg-elevated text-center text-copy-primary outline-none`}
                // Grows with what is typed. `ch` is the width of a "0", which
                // tracks a proportional face closely enough for a short label.
                style={{
                  width: `${Math.max(label.length, MIN_LABEL_CHARS) + 1}ch`,
                }}
                value={label}
                placeholder={LABEL_PLACEHOLDER}
                aria-label="Edge label"
                onChange={(event) =>
                  updateEdgeData(id, { label: event.target.value })
                }
                onBlur={stopEditing}
                onKeyDown={handleKeyDown}
              />
            ) : (
              <span
                className={`${LABEL_BASE_CLASS} ${
                  label
                    ? "border-surface-border bg-elevated text-copy-secondary"
                    : "border-surface-border/60 bg-surface text-copy-faint"
                }`}
              >
                {label || LABEL_HINT}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
