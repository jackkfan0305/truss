"use client";

import { useContext } from "react";
import { Handle, NodeResizer, Position, useStore, type NodeProps, type ReactFlowState } from "@xyflow/react";

import { AwsIcon } from "@/components/canvas/aws-icon";
import { CanvasLabel } from "@/components/canvas/canvas-label";
import { CodeIcon } from "@/components/canvas/code-icon";
import { BoundaryResizeContext } from "@/lib/canvas-boundary-context";
import { getBoundaryMinimumSize } from "@/lib/canvas-interaction";
import type { CanvasNode } from "@/types/canvas";

const HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;

/**
 * Dashed AWS boundary (cloud, VPC, subnet, ...). The interior is transparent and
 * the node sits below its descendants through React Flow's parent-depth z-order.
 */
export function CanvasBoundaryRenderer({ id, data, selected }: NodeProps<CanvasNode>) {
  const actions = useContext(BoundaryResizeContext);
  // Selected from the store so a child resize re-measures the minimum size
  // without every boundary subscribing to every node change.
  const minimumOf = (axis: "width" | "height") => (state: ReactFlowState) =>
    getBoundaryMinimumSize(
      id,
      [...state.nodeLookup.values()].map((node) => node.internals.userNode as CanvasNode),
    )[axis];
  const minWidth = useStore(minimumOf("width"));
  const minHeight = useStore(minimumOf("height"));

  const isCode = data.catalogId?.startsWith("code-") === true;

  return (
    <>
      {isCode ? (
        <div data-code-boundary="" className="flex h-full w-full flex-col rounded-md border border-surface-border bg-transparent">
          <div className="flex h-8 items-center gap-2 border-b border-surface-border bg-elevated px-3 font-mono text-sm">
            <CodeIcon catalogId={data.catalogId!} className="text-copy-muted" />
            <CanvasLabel id={id} label={data.label} ariaLabel="Boundary title" className="min-w-0" />
          </div>
        </div>
      ) : (
        <>
          <div className="h-full w-full border border-dashed border-copy-muted bg-transparent" />
          <div className="absolute left-4 top-0 flex max-w-[calc(100%-2rem)] -translate-y-1/2 items-center gap-2 bg-page px-2 text-sm">
            {data.catalogId ? <AwsIcon catalogId={data.catalogId} className="h-5 w-5" /> : null}
            <CanvasLabel id={id} label={data.label} ariaLabel="Boundary title" className="min-w-0" />
          </div>
        </>
      )}
      {HANDLE_POSITIONS.map((position) => (
        <Handle key={position} id={position} type="source" position={position} />
      ))}
      {selected && actions ? (
        <NodeResizer
          minWidth={minWidth}
          minHeight={minHeight}
          handleClassName="nokey"
          lineClassName="nokey"
          onResizeStart={actions.start}
          // The transaction replaces React Flow's own change for this resize.
          shouldResize={(_event, { x, y, width, height }) => {
            actions.resize(id, { x, y, width, height });
            return false;
          }}
        />
      ) : null}
    </>
  );
}
