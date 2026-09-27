"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";

import { useIsFreshArrival } from "@/components/canvas/canvas-motion-context";
import {
  useEdgeLabelOffset,
  useEdgeRoute,
  useSavedEdgeRoute,
} from "@/components/canvas/canvas-edge-routes";
import type { EdgeSide } from "@/lib/canvas-edge-route";
import { DIAGRAM_LABEL_LINE_HEIGHT, DIAGRAM_LABEL_WIDTH } from "@/lib/diagram-route";
import { positionParallelEdgeLabel } from "@/lib/edge-label-layout";
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

/** `EdgeSide` is a plain union so the routing module stays React Flow-free. */
const SIDE_POSITIONS: Record<EdgeSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

const LABEL_BASE_CLASS =
  "nodrag nopan nokey rounded-xl border px-2 py-0.5 text-xs leading-tight";

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
  // Present for an edge that named no handle, which is every generated one: it
  // replaces React Flow's fixed top-handle endpoints with lane-separated ones.
  const route = useEdgeRoute(id);
  const savedRoute = useSavedEdgeRoute(id);
  const labelOffset = useEdgeLabelOffset(id);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // `labelX`/`labelY` are the path's own midpoint, computed by the same call
  // that produced the path — deriving it from the endpoints instead would put
  // the label off the line wherever the route bends.
  const [fallbackPath, labelX, labelY] = getSmoothStepPath({
    sourceX: route?.source.x ?? sourceX,
    sourceY: route?.source.y ?? sourceY,
    sourcePosition: route ? SIDE_POSITIONS[route.source.side] : sourcePosition,
    targetX: route?.target.x ?? targetX,
    targetY: route?.target.y ?? targetY,
    targetPosition: route ? SIDE_POSITIONS[route.target.side] : targetPosition,
    centerX: route?.centerX,
    centerY: route?.centerY,
  });

  const path = savedRoute
    ? savedRoute.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
    : fallbackPath;
  const label = data?.label ?? "";
  const isActive = isHovered || selected === true || isEditing;
  const positionedLabel = savedRoute?.label
    ? { x: savedRoute.label.x, y: savedRoute.label.y }
    : positionParallelEdgeLabel({
    labelX,
    labelY,
    offset: labelOffset,
  });

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
    [],
  );

  const labelStyle = {
    position: "absolute" as const,
    transform: `translate(-50%, -50%) translate(${positionedLabel.x}px, ${positionedLabel.y}px)`,
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
                style={{ width: savedRoute?.label?.width ?? DIAGRAM_LABEL_WIDTH, minHeight: savedRoute?.label?.height, lineHeight: `${DIAGRAM_LABEL_LINE_HEIGHT}px` }}
                className={`${LABEL_BASE_CLASS} flex box-border max-w-40 items-center justify-center break-words whitespace-normal text-center ${
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
