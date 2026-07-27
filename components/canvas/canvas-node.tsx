"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import {
  Handle,
  NodeResizer,
  Position,
  useKeyPress,
  useReactFlow,
  useStoreApi,
  type NodeProps,
} from "@xyflow/react";

import { NodeColorToolbar } from "@/components/canvas/node-color-toolbar";
import { NodeShapeFrame } from "@/components/canvas/node-shape";
import {
  NODE_COLORS,
  NODE_DEFAULT_SIZES,
  NODE_MIN_SIZE,
  type CanvasEdge,
  type CanvasNode,
} from "@/types/canvas";

/** Shown at rest and as the textarea placeholder, so the hint never moves. */
const LABEL_PLACEHOLDER = "Untitled";

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
 * every change lands in Liveblocks Storage via `onNodesChange`.
 */
export function CanvasNodeRenderer({
  id,
  data,
  width,
  height,
  selected,
}: NodeProps<CanvasNode>) {
  // React Flow leaves width/height undefined until it has measured the node,
  // and the SVG shapes need a viewBox on the very first paint.
  const fallback = NODE_DEFAULT_SIZES[data.shape];
  const { updateNodeData } = useReactFlow<CanvasNode, CanvasEdge>();
  const store = useStoreApi<CanvasNode, CanvasEdge>();
  const [isEditing, setIsEditing] = useState(false);

  const stopEditing = useCallback(() => setIsEditing(false), []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter commits; Shift+Enter falls through to the textarea's own newline.
      // A node label is a name, so a bare Enter breaking the line is almost
      // never what was meant. The label is already written on every keystroke,
      // so committing is just closing the editor.
      const isCommit = event.key === "Enter" && !event.shiftKey;

      if (!isCommit && event.key !== "Escape") {
        return;
      }

      if (isCommit) {
        // Without this the textarea inserts the newline before it unmounts.
        event.preventDefault();
      }

      // Otherwise React Flow's own node key handler reads it too — Enter is one
      // of its selection keys, so it would toggle the selection straight back on.
      event.stopPropagation();
      setIsEditing(false);

      // Committing leaves the node entirely: deselect it, so the colour toolbar
      // and the resize frame go with it, then hand focus to the canvas. The
      // textarea is about to unmount and the browser would otherwise drop focus
      // on <body>. `resetSelectedElements` is what a click on the pane calls, so
      // the deselection travels the same change path as any other.
      const { domNode, resetSelectedElements } = store.getState();

      resetSelectedElements();
      domNode?.focus({ preventScroll: true });
    },
    [store]
  );

  return (
    <>
      <NodeShapeFrame
        shape={data.shape}
        color={data.color}
        width={width ?? fallback.width}
        height={height ?? fallback.height}
        selected={selected}
      >
        {/*
         * `nopan` covers the whole label area, not just the textarea: React Flow
         * reads it off the event target to veto both panning and the pane's
         * double-click zoom, so without it every double-click would zoom the
         * canvas instead of opening the editor.
         */}
        <div
          className="nopan flex h-full w-full items-center justify-center"
          onDoubleClick={() => setIsEditing(true)}
        >
          {/*
           * The label stays in the layout while editing — only hidden — and the
           * textarea is absolutely positioned over it. That keeps the node from
           * shifting on open and lets the box grow with what is typed, since it
           * is still the label that sizes it.
           */}
          <div className="relative w-full">
            <span
              className={`line-clamp-3 break-words ${isEditing ? "invisible" : ""} ${data.label ? "" : "opacity-50"}`}
            >
              {data.label || LABEL_PLACEHOLDER}
            </span>
            {isEditing ? (
              <textarea
                // Focus on mount: the editor only exists because the user just
                // double-clicked it, so there is nowhere else focus belongs.
                autoFocus
                // `nodrag` so selecting text does not drag the node with it,
                // and `nokey` so Shift+click extends the text selection rather
                // than starting the pane's selection box.
                className="nodrag nopan nokey absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-center outline-none"
                value={data.label}
                placeholder={LABEL_PLACEHOLDER}
                aria-label="Node label"
                onChange={(event) =>
                  updateNodeData(id, { label: event.target.value })
                }
                onBlur={stopEditing}
                onKeyDown={handleKeyDown}
              />
            ) : null}
          </div>
        </div>
      </NodeShapeFrame>
      {/*
       * Order here is paint order, and all three of these are positioned
       * elements at `z-index: auto`, so the later sibling wins:
       *
       *   shape  →  handles  →  resize frame
       *
       * The handles have to come *after* `NodeShapeFrame` or its `absolute
       * inset-0` fill covers their inner half — a handle straddles the node
       * border, so that left only a ~4px outer sliver grabbable.
       *
       * The resize frame comes after the handles so that a selected node
       * resizes from its side midpoints rather than starting a connection
       * there. Connecting is the unselected-node gesture; both are reachable.
       */}
      {HANDLE_POSITIONS.map((position) => (
        <Handle key={position} id={position} type="source" position={position} />
      ))}
      {selected ? (
        <>
          <NodeResizeFrame accent={NODE_COLORS[data.color].text} />
          <NodeColorToolbar nodeId={id} color={data.color} />
        </>
      ) : null}
    </>
  );
}
