"use client";

import {
  Handle,
  NodeResizer,
  Position,
  useKeyPress,
  type NodeProps,
} from "@xyflow/react";

import { AwsIcon } from "@/components/canvas/aws-icon";
import { CanvasLabel } from "@/components/canvas/canvas-label";
import { useIsAgentEditing } from "@/components/canvas/agent-presence";
import { useIsFreshArrival } from "@/components/canvas/canvas-motion-context";
import { NodeColorToolbar } from "@/components/canvas/node-color-toolbar";
import { NodeShapeFrame } from "@/components/canvas/node-shape";
import { cn } from "@/lib/utils";
import {
  NODE_COLORS,
  NODE_DEFAULT_SIZES,
  NODE_MIN_SIZE,
  type CanvasNode,
} from "@/types/canvas";

/**
 * One handle per side (16-edge-behavior). All four are declared `source`: the
 * canvas runs in `ConnectionMode.Loose`, where a handle accepts a connection
 * from either end regardless of its type, so a second `target` handle per side
 * would only double the hit targets stacked on the same four points.
 *
 * Hidden at rest and faded in on node hover by a rule in `globals.css` — they
 * stay pointer-interactive throughout, which is what lets a connection drag
 * land on a handle the moment the cursor reaches the node.
 */
const HANDLE_POSITIONS = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
] as const;

/** Resize frame: full-strength corner/edge handles, faint guide lines. */
const RESIZE_HANDLE_STYLE = {
  width: 7,
  height: 7,
  borderRadius: 2,
  borderColor: "var(--bg-base)",
};
const RESIZE_LINE_STYLE = { opacity: 0.35 };
const RESIZE_CONTROL_CLASS = "nokey";

/**
 * Rendered only while the node is selected, rather than passing `isVisible` to
 * a permanently mounted `NodeResizer`: `useKeyPress` binds a document listener
 * and re-renders its owner on every Shift, and one of those per node on the
 * canvas is a cost paid for the single node that can actually be resized.
 *
 * The pointer target for these controls is widened past their 1px/7px drawn
 * size by a `::after` rule in `globals.css`.
 */
function NodeResizeFrame({ accent }: { accent: string }) {
  // Shift locks the aspect ratio, as in any design tool. React Flow re-reads
  // this while a drag is in flight, so it can be pressed mid-resize.
  const keepAspectRatio = useKeyPress("Shift");

  return (
    <NodeResizer
      color={accent}
      keepAspectRatio={keepAspectRatio}
      minWidth={NODE_MIN_SIZE.width}
      minHeight={NODE_MIN_SIZE.height}
      // `nokey` is React Flow's own opt-out from the pane's selection box.
      // Without it, Shift+pointerdown on a control is captured by the pane
      // before the resizer ever sees it, and dragging draws a selection
      // rectangle across the canvas instead of resizing the node.
      handleClassName={RESIZE_CONTROL_CLASS}
      lineClassName={RESIZE_CONTROL_CLASS}
      handleStyle={RESIZE_HANDLE_STYLE}
      lineStyle={RESIZE_LINE_STYLE}
    />
  );
}

/**
 * Renderer for the `canvasNode` type (13-node-shape, 14-node-editing).
 *
 * The shape itself lives in `NodeShapeFrame`; this adds the resize frame and
 * inline label editing. Both write through React Flow's controlled flow, so
 * every change lands in the stored snapshot via `onNodesChange`.
 */
export function CanvasNodeRenderer(props: NodeProps<CanvasNode>) {
  return props.data.kind === "aws-service" && props.data.catalogId ? (
    <AwsServiceRenderer {...props} />
  ) : (
    <GenericNodeRenderer {...props} />
  );
}

const HANDLES = HANDLE_POSITIONS.map((position) => (
  <Handle key={position} id={position} type="source" position={position} />
));

/** Official icon above its editable name. No colour toolbar: icon colours are fixed. */
function AwsServiceRenderer({ id, data, selected }: NodeProps<CanvasNode>) {
  const isFreshArrival = useIsFreshArrival();
  const isAgentEditing = useIsAgentEditing("node", id);

  return (
    <>
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-2 rounded-md border bg-elevated p-2 text-center text-sm",
          selected ? "border-brand" : "border-surface-border",
          isFreshArrival && "canvas-node-arrive",
          isAgentEditing && "canvas-agent-editing",
        )}
      >
        <AwsIcon catalogId={data.catalogId!} className="h-10 w-10" />
        <CanvasLabel id={id} label={data.label} ariaLabel="Node label" className="w-full" />
      </div>
      {HANDLES}
      {selected ? <NodeResizeFrame accent="var(--brand)" /> : null}
    </>
  );
}

/**
 * Renderer for generic `canvasNode` nodes (13-node-shape, 14-node-editing).
 * The shape lives in `NodeShapeFrame`; this adds the resize frame and label.
 */
function GenericNodeRenderer({ id, data, width, height, selected }: NodeProps<CanvasNode>) {
  // React Flow leaves width/height undefined until it has measured the node,
  // and the SVG shapes need a viewBox on the very first paint.
  const fallback = NODE_DEFAULT_SIZES[data.shape];
  const isFreshArrival = useIsFreshArrival();
  const isAgentEditing = useIsAgentEditing("node", id);

  return (
    <>
      <NodeShapeFrame
        shape={data.shape}
        color={data.color}
        width={width ?? fallback.width}
        height={height ?? fallback.height}
        selected={selected}
        // Only nodes that arrive while the canvas is already on screen.
        className={cn(isFreshArrival && "canvas-node-arrive", isAgentEditing && "canvas-agent-editing")}
      >
        <CanvasLabel
          id={id}
          label={data.label}
          ariaLabel="Node label"
          className="flex h-full w-full items-center justify-center"
        />
      </NodeShapeFrame>
      {/*
       * Paint order: shape, handles, resize frame. Handles come after the shape
       * or its `absolute inset-0` fill covers their inner half; the resize frame
       * comes last so a selected node resizes from its side midpoints.
       */}
      {HANDLES}
      {selected ? (
        <>
          <NodeResizeFrame accent={NODE_COLORS[data.color].text} />
          <NodeColorToolbar nodeId={id} color={data.color} />
        </>
      ) : null}
    </>
  );
}
