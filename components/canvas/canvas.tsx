"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent,
  type MouseEvent,
} from "react";
import { useUpdateMyPresence } from "@liveblocks/react";
import { useLiveblocksFlow } from "@liveblocks/react-flow";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type DefaultEdgeOptions,
  type EdgeTypes,
  type IsValidConnection,
  type NodeTypes,
  type XYPosition,
} from "@xyflow/react";

import { CanvasControls } from "@/components/canvas/canvas-controls";
import { CanvasEdgeRenderer } from "@/components/canvas/canvas-edge";
import { CanvasNodeRenderer } from "@/components/canvas/canvas-node";
import { CanvasMotionProvider } from "@/components/canvas/canvas-motion-context";
import { LiveCursors } from "@/components/canvas/live-cursors";
import { ShapePanel } from "@/components/canvas/shape-panel";
import { StarterTemplatesModal } from "@/components/editor/starter-templates-modal";
import type { CanvasTemplate } from "@/components/editor/starter-templates";
import { useCanvasSave } from "@/components/canvas/canvas-save-context";
import { useCanvasAutosave } from "@/hooks/use-canvas-autosave";
import { useCanvasRestore } from "@/hooks/use-canvas-restore";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import {
  SHAPE_DRAG_MIME,
  createNodeId,
  parseShapeDragPayload,
  type ShapeDragPayload,
} from "@/lib/canvas-drag";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  CONNECTION_SNAP_RADIUS,
  DEFAULT_NODE_COLOR,
  NODE_DEFAULT_SIZES,
  VIEWPORT_TRANSITION_MS,
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

const EDGE_TYPES: EdgeTypes = {
  [CANVAS_EDGE_TYPE]: CanvasEdgeRenderer,
};

/**
 * React Flow merges these into the connection *before* handing it to
 * `onConnect`, so `useLiveblocksFlow` writes the type, arrowhead and stroke
 * straight into Storage — every client renders a new edge the same way with no
 * post-processing step (16-edge-behavior).
 *
 * `data.label` is seeded empty rather than left absent so the key exists on the
 * edge's `LiveObject` from creation, the same as a node's `data`.
 */
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: CANVAS_EDGE_TYPE,
  data: { label: "" },
  style: CANVAS_EDGE_STYLE,
  markerEnd: CANVAS_EDGE_MARKER,
};

/**
 * `ConnectionMode.Loose` treats any two distinct handles as connectable, and
 * two handles on the *same* node qualify — so the generous snap radius would
 * otherwise turn a mis-drop near the node you just dragged out of into a
 * self-loop. `getSmoothStepPath` has no loop routing, so one renders as a
 * degenerate line hidden under its own node.
 *
 * Module scope so the identity is stable: React Flow stores this and a fresh
 * closure per render would rewrite the store on every render.
 */
const isConnectionBetweenNodes: IsValidConnection<CanvasEdge> = ({
  source,
  target,
}) => source !== target;

/**
 * The collaborative canvas surface (11-base-canvas, 12-shape-panel).
 *
 * `ReactFlowProvider` is what lets `CanvasFlow` call `useReactFlow` in the same
 * component that renders the drop target — the wrapper sits outside `ReactFlow`,
 * so it is not covered by the context `ReactFlow` provides to its children.
 */
export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasMotionProvider>
        <CanvasFlow {...props} />
      </CanvasMotionProvider>
    </ReactFlowProvider>
  );
}

interface CanvasProps {
  /** Doubles as the room ID and the project the canvas is persisted under. */
  projectId: string;
  /**
   * The starter template picker is opened from the editor navbar, which sits
   * outside the room — but importing one is a Storage write, so the dialog is
   * rendered here where the flow state is (18-starter-templates).
   */
  isTemplatesOpen: boolean;
  onTemplatesOpenChange: (open: boolean) => void;
}

function CanvasFlow({
  projectId,
  isTemplatesOpen,
  onTemplatesOpenChange,
}: CanvasProps) {
  /*
   * Autosave state reaches the navbar through context rather than a callback
   * prop: the indicator lives outside `ReactFlowProvider` and cannot read the
   * flow state that drives it, and pushing it up through an effect would
   * re-render the whole workspace an extra time per save (21-canvas-autosave).
   */
  const { setStatus: setSaveStatus, registerSaveNow } = useCanvasSave();
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, onDelete } =
    useLiveblocksFlow<CanvasNode, CanvasEdge>({
      suspense: true,
      nodes: { initial: [] },
      edges: { initial: [] },
    });
  const { fitView, screenToFlowPosition } = useReactFlow<
    CanvasNode,
    CanvasEdge
  >();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isAwaitingImportedNodes = useRef(false);
  const updateMyPresence = useUpdateMyPresence();

  /**
   * Broadcast the pointer in *canvas* coordinates, not screen coordinates: the
   * other clients are panned and zoomed differently, so a screen position would
   * land somewhere else on their diagram (19-presence-avatars-cursors).
   *
   * Liveblocks throttles presence updates itself (100ms by default), so the
   * raw mousemove firing rate does not become the network rate.
   */
  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      updateMyPresence({
        cursor: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition, updateMyPresence]
  );

  /** Off the canvas, there is no position to show — the cursor is hidden. */
  const handleMouseLeave = useCallback(() => {
    updateMyPresence({ cursor: null });
  }, [updateMyPresence]);

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

  /**
   * A template *replaces* the canvas, so everything on it is deleted before the
   * template is added.
   *
   * The clear goes through `onDelete` rather than `remove` changes on purpose:
   * `@liveblocks/react-flow`'s change appliers no-op on `"remove"` — deletion is
   * `onDelete`'s job — so removal changes would leave the old diagram in place
   * and the template would land on top of it.
   *
   * Nodes and edges are copied on the way in so the template constants are never
   * aliased into Storage and cannot be edited by reference on the canvas.
   */
  const handleImportTemplate = useCallback(
    (template: CanvasTemplate) => {
      onDelete({ nodes, edges });
      onNodesChange(
        template.nodes.map((node) => ({
          type: "add",
          item: { ...node, data: { ...node.data } },
        }))
      );
      onEdgesChange(
        template.edges.map((edge) => ({
          type: "add",
          item: { ...edge, data: { ...edge.data, label: edge.data?.label ?? "" } },
        }))
      );

      isAwaitingImportedNodes.current = true;
    },
    [edges, nodes, onDelete, onEdgesChange, onNodesChange]
  );

  /**
   * Fitting the view has to wait for the imported nodes to come back *through*
   * Storage — `fitView` called straight after the write measures the canvas as
   * it was, which on a previously empty one is a no-op.
   */
  useEffect(() => {
    if (!isAwaitingImportedNodes.current || nodes.length === 0) {
      return;
    }

    isAwaitingImportedNodes.current = false;
    void fitView({ duration: VIEWPORT_TRANSITION_MS });
  }, [fitView, nodes]);

  /**
   * A restored snapshot is written through the same `add` changes a drop uses,
   * so it lands in Liveblocks Storage and reaches everyone else in the room
   * rather than existing only in this client's local flow state.
   */
  const handleRestore = useCallback(
    (snapshot: CanvasSnapshot) => {
      onNodesChange(snapshot.nodes.map((node) => ({ type: "add", item: node })));
      onEdgesChange(snapshot.edges.map((edge) => ({ type: "add", item: edge })));

      isAwaitingImportedNodes.current = true;
    },
    [onEdgesChange, onNodesChange]
  );

  /*
   * ponytail: two clients opening the *same* cold room within one round trip
   * can both restore, which duplicates every node. Narrow enough to accept for
   * now — it needs an empty room, which means nobody has edited it since the
   * last save. A Storage-held "restored" flag is the fix if it ever shows up.
   */
  useCanvasRestore(
    projectId,
    nodes.length === 0 && edges.length === 0,
    handleRestore
  );

  // Status is set straight from the save lifecycle, so the navbar indicator
  // updates without this component re-rendering to report it.
  const { saveNow } = useCanvasAutosave(projectId, nodes, edges, setSaveStatus);

  useEffect(() => {
    registerSaveNow(saveNow);

    // The handle must not outlive the canvas, or a Save click on the editor
    // home would call into an unmounted room.
    return () => registerSaveNow(null);
  }, [registerSaveNow, saveNow]);

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
      // `relative` anchors the live-cursor overlay to the canvas.
      className="relative h-full w-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDelete={onDelete}
        // On the wrapper rather than `onPaneMouseMove`, so the cursor keeps
        // broadcasting while the pointer is over a node instead of freezing.
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        // Handles are drawn on all four sides, so a connection must be allowed to
        // land on any of them rather than only on a declared target handle.
        connectionMode={ConnectionMode.Loose}
        // Release anywhere on a target node and the connection lands on that
        // node's nearest handle. The default (20) is "release on the dot", which
        // silently discarded any connection dropped on a node's body.
        connectionRadius={CONNECTION_SNAP_RADIUS}
        isValidConnection={isConnectionBetweenNodes}
        // The line dragged out of a handle defaults to a bezier, which would not
        // resemble the right-angle edge it is about to become.
        connectionLineType={ConnectionLineType.SmoothStep}
        // Programmatically focusable, but kept out of the tab order: closing the
        // label editor hands focus back here (14-node-editing), and without a
        // tabIndex the wrapper cannot take it and the browser drops focus on
        // <body> instead. Nodes are still individually tab-reachable.
        tabIndex={-1}
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
        <Panel position="bottom-left">
          <CanvasControls />
        </Panel>
      </ReactFlow>

      <LiveCursors />

      <StarterTemplatesModal
        open={isTemplatesOpen}
        onOpenChange={onTemplatesOpenChange}
        onImport={handleImportTemplate}
      />
    </div>
  );
}
