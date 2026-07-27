"use client";

import { useCallback, useRef, type DragEvent } from "react";
import { useLiveblocksFlow } from "@liveblocks/react-flow";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
  type XYPosition,
} from "@xyflow/react";

import { CanvasNodeRenderer } from "@/components/canvas/canvas-node";
import { ShapePanel } from "@/components/canvas/shape-panel";
import {
  SHAPE_DRAG_MIME,
  createNodeId,
  parseShapeDragPayload,
  type ShapeDragPayload,
} from "@/lib/canvas-drag";
import {
  CANVAS_NODE_TYPE,
  DEFAULT_NODE_COLOR,
  NODE_DEFAULT_SIZES,
  type CanvasEdge,
  type CanvasNode,
  type NodeShape,
} from "@/types/canvas";

import "@xyflow/react/dist/style.css";

// Module scope, not inline: React Flow re-registers every node type when this
// object's identity changes, which on an inline literal is every render.
const NODE_TYPES: NodeTypes = {
  [CANVAS_NODE_TYPE]: CanvasNodeRenderer,
};

/**
 * The collaborative canvas surface (11-base-canvas, 12-shape-panel).
 *
 * `ReactFlowProvider` is what lets `CanvasFlow` call `useReactFlow` in the same
 * component that renders the drop target — the wrapper sits outside `ReactFlow`,
 * so it is not covered by the context `ReactFlow` provides to its children.
 */
export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasFlow />
    </ReactFlowProvider>
  );
}

function CanvasFlow() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, onDelete } =
    useLiveblocksFlow<CanvasNode, CanvasEdge>({
      suspense: true,
      nodes: { initial: [] },
      edges: { initial: [] },
    });
  const { screenToFlowPosition } = useReactFlow<CanvasNode, CanvasEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);

  /**
   * `add` changes go through `onNodesChange` rather than a local `setNodes`, so
   * the new node is written straight into Liveblocks Storage and reaches every
   * other client in the room.
   */
  const addNode = useCallback(
    ({ shape, width, height }: ShapeDragPayload, center: XYPosition) => {
      onNodesChange([
        {
          type: "add",
          item: {
            id: createNodeId(shape),
            type: CANVAS_NODE_TYPE,
            // The drop point is where the cursor was, so the node is centred on
            // it rather than hanging off its bottom-right corner.
            position: { x: center.x - width / 2, y: center.y - height / 2 },
            width,
            height,
            data: { label: "", color: DEFAULT_NODE_COLOR, shape },
          },
        },
      ]);
    },
    [onNodesChange]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(SHAPE_DRAG_MIME)) {
      return;
    }

    // Without preventDefault the browser refuses the drop entirely.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const payload = parseShapeDragPayload(
        event.dataTransfer.getData(SHAPE_DRAG_MIME)
      );

      if (!payload) {
        return;
      }

      event.preventDefault();
      addNode(
        payload,
        screenToFlowPosition({ x: event.clientX, y: event.clientY })
      );
    },
    [addNode, screenToFlowPosition]
  );

  /** Keyboard/click path: drop the shape into the middle of what is on screen. */
  const handleAddShape = useCallback(
    (shape: NodeShape) => {
      const bounds = wrapperRef.current?.getBoundingClientRect();

      if (!bounds) {
        return;
      }

      // Measured off the wrapper, not the window: the canvas sits below the
      // navbar and beside the AI panel, so a window-centred node would land
      // off-centre — or off-screen entirely on a short viewport.
      addNode(
        { shape, ...NODE_DEFAULT_SIZES[shape] },
        screenToFlowPosition({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        })
      );
    },
    [addNode, screenToFlowPosition]
  );

  return (
    <div
      ref={wrapperRef}
      className="h-full w-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDelete={onDelete}
        // Handles are drawn on all four sides, so a connection must be allowed to
        // land on any of them rather than only on a declared target handle.
        connectionMode={ConnectionMode.Loose}
        fitView
        // Themes React Flow's own chrome (minimap, attribution) to match the dark
        // workspace without restyling its internals.
        colorMode="dark"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--border-subtle)"
        />
        <MiniMap pannable zoomable />
        <Panel position="bottom-center">
          <ShapePanel onAddShape={handleAddShape} />
        </Panel>
      </ReactFlow>
    </div>
  );
}
