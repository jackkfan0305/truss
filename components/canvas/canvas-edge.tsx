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
  edgeTurnX,
  fanOffset,
  fanSlotIndex,
} from "@/lib/canvas-geometry";
import {
  CANVAS_EDGE_STYLE,
  type CanvasEdge,
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
 * The slot this edge takes at each of its two handles, and how long each of
 * those faces is: `sourceIndex:sourceCount:sourceFace:targetIndex:...`.
 *
 * Packed into a string on purpose. A selector returning an object hands back a
 * fresh reference on every store change, and the default `Object.is` compare
 * would then re-render every edge on every frame of a node drag. A string
 * compares by value, so an edge re-renders only when its own slot actually
 * moves — which it should, since dragging a node past its neighbours really
 * does reorder the fan.
 */
function readFanSlots(store: ReactFlowState, edgeId: string): string {
  const edge = store.edgeLookup.get(edgeId);

  if (!edge) {
    return "0:1:0:0:1:0";
  }

  const ends = (
    [
      [edge.source, edge.sourceHandle],
      [edge.target, edge.targetHandle],
    ] as const
  ).map(([nodeId, handleId]) => {
    const node = store.nodeLookup.get(nodeId);

    if (!node) {
      return "0:1:0";
    }

    // One `Handle` per side serves both directions (`canvas-node.tsx` renders
    // them all as `type="source"`, and the canvas runs `ConnectionMode.Loose`),
    // so an arrival and a departure genuinely land on the same point and belong
    // in the same fan.
    const memberIds = store.edges
      .filter(
        (candidate) =>
          (candidate.source === nodeId &&
            candidate.sourceHandle === handleId) ||
          (candidate.target === nodeId && candidate.targetHandle === handleId)
      )
      .map((candidate) => candidate.id);

    // React Flow leaves `measured` empty until it has seen the node on screen.
    // `fanOffset` reads a zero-length face as "no room to spread" and leaves
    // the edges on the handle until the measurement lands.
    const faceLength =
      (handleId === "left" || handleId === "right"
        ? node.measured.height
        : node.measured.width) ?? 0;

    return `${fanSlotIndex(memberIds, edgeId)}:${memberIds.length}:${faceLength}`;
  });

  return ends.join(":");
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

  // A handle is one coordinate, so without this every edge sharing one starts
  // or ends at the identical pixel — five arrowheads on a single point. Each
  // edge takes a slot along the face instead.
  const fanSlots = useStore(
    useCallback((store: ReactFlowState) => readFanSlots(store, id), [id])
  );

  const [source, target] = useMemo(() => {
    const [si, sc, sFace, ti, tc, tFace] = fanSlots.split(":").map(Number);
    const sourceShift = fanOffset(si, sc, sFace);
    const targetShift = fanOffset(ti, tc, tFace);

    return [
      isSideFace(sourcePosition)
        ? { x: sourceX, y: sourceY + sourceShift }
        : { x: sourceX + sourceShift, y: sourceY },
      isSideFace(targetPosition)
        ? { x: targetX, y: targetY + targetShift }
        : { x: targetX + targetShift, y: targetY },
    ];
  }, [fanSlots, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition]);

  // The corridor turn is a claim about the empty band between two ranks, so it
  // only holds for an edge that actually leaves one face and enters the other
  // across that band. An end on a top or bottom handle is somewhere else
  // entirely — `sourceX` there is the node's own centre line, not the edge of
  // its rank — so those routes keep React Flow's default turn.
  const isSideToSide =
    isSideFace(sourcePosition) && isSideFace(targetPosition);

  // `labelX`/`labelY` are the path's own turning point, computed by the same
  // call that produced the path — deriving it from the endpoints instead would
  // put the label off the line wherever the route bends. Fanning the endpoints
  // moves that turning point with them, which is what pulls two labels sharing
  // a corridor apart.
  const [path, turnLabelX, turnLabelY] = getSmoothStepPath({
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition,
    targetX: target.x,
    targetY: target.y,
    targetPosition,
    centerX: isSideToSide ? edgeTurnX(source.x, target.x) : undefined,
  });

  // The label rides the corner where the edge leaves its source, not the middle
  // of the route.
  //
  // A midpoint averages two rows, so two edges between unrelated pairs land on
  // the same y whenever their rows happen to straddle it — measured on a real
  // diagram, that is exactly how "OAuth + refresh" ended up under "verified
  // transitions". Anchoring to the source instead makes a label inherit the
  // separation the layout has already paid for: `RANK_ROW_GAP` between rows,
  // and `FAN_STEP` — one pill height — between two edges off the same handle.
  //
  // Both coordinates stay on the drawn line. `turnLabelX` is the corridor turn,
  // and the route runs horizontally at `source.y` until it reaches that turn,
  // so their intersection is the corner itself. Only a side-to-side edge has
  // that corner; anything through a top or bottom handle keeps the path's own
  // label point.
  const labelX = turnLabelX;
  const labelY = isSideToSide ? source.y : turnLabelY;

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
