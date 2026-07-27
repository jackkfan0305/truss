"use client";

import type { CSSProperties } from "react";
import { NodeToolbar, Position, useReactFlow } from "@xyflow/react";

import {
  NODE_COLORS,
  type CanvasEdge,
  type CanvasNode,
  type NodeColor,
} from "@/types/canvas";

/**
 * The floating colour toolbar for a selected node (15-node-color-toolbar).
 *
 * `NodeToolbar` is React Flow's own: it portals out of the node, tracks the
 * node's position through pan and zoom without scaling with it, and already
 * hides itself unless exactly one node is selected.
 */

const COLOR_KEYS = Object.keys(NODE_COLORS) as NodeColor[];

/** Clear of the node's own selected outline and its top resize handle. */
const TOOLBAR_OFFSET = 14;

interface NodeColorToolbarProps {
  nodeId: string;
  color: NodeColor;
}

export function NodeColorToolbar({ nodeId, color }: NodeColorToolbarProps) {
  const { updateNodeData } = useReactFlow<CanvasNode, CanvasEdge>();

  return (
    <NodeToolbar
      nodeId={nodeId}
      position={Position.Top}
      offset={TOOLBAR_OFFSET}
      // React Flow reads these class names off the event target: without them a
      // pointer drag on the toolbar pans the canvas, and a Shift+click on a
      // swatch is captured by the pane as the start of a selection box.
      className="nodrag nopan nokey flex items-center gap-1.5 rounded-xl border border-surface-border bg-elevated/90 px-2 py-1.5 shadow-lg backdrop-blur-md"
      role="toolbar"
      aria-label="Node color"
    >
      {COLOR_KEYS.map((key) => {
        const pair = NODE_COLORS[key];

        return (
          <button
            key={key}
            type="button"
            // Styling lives in globals.css: the hover glow is the pair's own
            // text colour, so it cannot be a Tailwind class.
            className="node-color-swatch"
            style={
              {
                backgroundColor: pair.fill,
                "--swatch-accent": pair.text,
              } as CSSProperties
            }
            aria-label={key}
            aria-pressed={key === color}
            // Writes through React Flow's controlled flow, so the change lands
            // in Liveblocks Storage via `onNodesChange` — no server call.
            onClick={() => updateNodeData(nodeId, { color: key })}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: pair.text }}
            />
          </button>
        );
      })}
    </NodeToolbar>
  );
}
