"use client";

import type { NodeProps } from "@xyflow/react";

import { NODE_COLORS, type CanvasNode } from "@/types/canvas";

/**
 * Basic renderer for the `canvasNode` type (12-shape-panel).
 *
 * Every shape draws as a bordered rectangle for now — the spec defers
 * shape-specific visuals (and the four connection handles) to a later unit.
 * React Flow sizes the wrapper from the node's `width`/`height`, so this fills
 * it rather than setting its own dimensions.
 */
export function CanvasNodeRenderer({ data, selected }: NodeProps<CanvasNode>) {
  const { fill, text } = NODE_COLORS[data.color];

  return (
    <div
      className="flex h-full w-full items-center justify-center rounded-xl border px-3 py-2 text-center text-sm"
      style={{
        backgroundColor: fill,
        color: text,
        borderColor: text,
        // Selection reads as a halo in the node's own accent, so it stays
        // legible against all 8 palette pairs without a second colour token.
        boxShadow: selected ? `0 0 0 2px ${fill}, 0 0 0 4px ${text}` : undefined,
      }}
    >
      {data.label ? (
        <span className="line-clamp-3 break-words">{data.label}</span>
      ) : (
        // A dropped node starts with an empty label; without this it renders as
        // a blank box with no hint that it is editable.
        <span className="opacity-50">Untitled</span>
      )}
    </div>
  );
}
