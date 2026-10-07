"use client";

import { useRef, type DragEvent } from "react";
import {
  Circle,
  Cylinder,
  Diamond,
  Hexagon,
  Pill,
  Square,
  type LucideIcon,
} from "lucide-react";

import { DOCK_GRID_CLASS, DOCK_TILE_CLASS, tileDelay } from "@/lib/dock-ui";
import { NodeShapeFrame } from "@/components/canvas/node-shape";
import { SHAPE_DRAG_MIME, buildShapeDragPayload } from "@/lib/canvas-drag";
import {
  DEFAULT_NODE_COLOR,
  NODE_DEFAULT_SIZES,
  NODE_SHAPES,
  type NodeShape,
} from "@/types/canvas";

const SHAPE_ICONS: Record<NodeShape, LucideIcon> = {
  rectangle: Square,
  diamond: Diamond,
  circle: Circle,
  pill: Pill,
  cylinder: Cylinder,
  hexagon: Hexagon,
};

/** The role each shape carries on the canvas, per `context/ui-context.md`. */
const SHAPE_LABELS: Record<NodeShape, string> = {
  rectangle: "Rectangle — general purpose",
  diamond: "Diamond — decision",
  circle: "Circle — event",
  pill: "Pill — service",
  cylinder: "Cylinder — database",
  hexagon: "Hexagon — external system",
};

/** Module scope: it reads only its arguments, so it never needs rebuilding. */
function handleDragStart(
  event: DragEvent<HTMLButtonElement>,
  shape: NodeShape,
  ghost: HTMLElement | null
) {
  event.dataTransfer.setData(
    SHAPE_DRAG_MIME,
    JSON.stringify(buildShapeDragPayload(shape))
  );
  event.dataTransfer.effectAllowed = "copy";

  if (ghost) {
    const { width, height } = NODE_DEFAULT_SIZES[shape];

    // The browser snapshots the ghost here and follows the cursor with it until
    // the drop or cancel — no drag-position state to keep or tear down. Held at
    // its centre because the drop handler centres the node on the cursor too.
    event.dataTransfer.setDragImage(ghost, width / 2, height / 2);
  }
}

interface ShapePanelProps {
  query: string;
  /**
   * Keyboard path for the same action as the drag: adds the shape at the centre
   * of the current viewport. Drag-and-drop alone is unreachable without a
   * pointer.
   */
  onAddShape: (shape: NodeShape) => void;
}

/**
 * The Basic section of the bottom dock (12-shape-panel). Each
 * button is an HTML5 drag source carrying the shape and its default size.
 */
export function ShapePanel({ query, onAddShape }: ShapePanelProps) {
  const ghostRefs = useRef<Partial<Record<NodeShape, HTMLDivElement | null>>>(
    {}
  );

  return (
    <>
      <div
        role="group"
        aria-label="Add a shape"
        className={DOCK_GRID_CLASS}
      >
        {NODE_SHAPES.filter((shape) => shape.includes(query.trim().toLowerCase())).map((shape, index) => {
          const Icon = SHAPE_ICONS[shape];

          return (
            <button
              key={shape}
              type="button"
              draggable
              title={SHAPE_LABELS[shape]}
              aria-label={SHAPE_LABELS[shape]}
              onDragStart={(event) =>
                handleDragStart(event, shape, ghostRefs.current[shape] ?? null)
              }
              onClick={() => onAddShape(shape)}
              className={`${DOCK_TILE_CLASS} capitalize`}
              style={tileDelay(index)}
            >
              <Icon className="h-8 w-8 p-1" strokeWidth={1.5} aria-hidden />
              {shape}
            </button>
          );
        })}
      </div>

      {/*
        Drag previews. `setDragImage` snapshots a live element, so each one has
        to be rendered and laid out before the drag starts — parked off-screen
        rather than hidden, because a `display:none` element snapshots blank.
      */}
      <div aria-hidden className="pointer-events-none fixed -left-[9999px] top-0">
        {NODE_SHAPES.map((shape) => {
          const { width, height } = NODE_DEFAULT_SIZES[shape];

          return (
            <div
              key={shape}
              ref={(element) => {
                ghostRefs.current[shape] = element;
              }}
              style={{ width, height, opacity: 0.75 }}
            >
              <NodeShapeFrame
                shape={shape}
                color={DEFAULT_NODE_COLOR}
                width={width}
                height={height}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
