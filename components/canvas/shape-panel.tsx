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
  /**
   * Keyboard path for the same action as the drag: adds the shape at the centre
   * of the current viewport. Drag-and-drop alone is unreachable without a
   * pointer.
   */
  onAddShape: (shape: NodeShape) => void;
}

/**
 * Floating shape palette at the bottom of the canvas (12-shape-panel). Each
 * button is an HTML5 drag source carrying the shape and its default size.
 */
export function ShapePanel({ onAddShape }: ShapePanelProps) {
  const ghostRefs = useRef<Partial<Record<NodeShape, HTMLDivElement | null>>>(
    {}
  );

  return (
    <>
      <div
        role="toolbar"
        aria-label="Add a shape"
        aria-orientation="horizontal"
        className="flex items-center gap-1 rounded-full border border-surface-border bg-elevated/90 p-1.5 shadow-lg backdrop-blur"
      >
        {NODE_SHAPES.map((shape) => {
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
              className="flex h-9 w-9 cursor-grab items-center justify-center rounded-full text-copy-muted transition-colors hover:bg-subtle hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:cursor-grabbing"
            >
              <Icon className="h-5 w-5" aria-hidden />
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
