"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type IsValidConnection,
  type NodeChange,
  type NodeTypes,
  type XYPosition,
} from "@xyflow/react";

import { CanvasControls } from "@/components/canvas/canvas-controls";
import { CanvasEdgeRenderer } from "@/components/canvas/canvas-edge";
import { CanvasEdgeRouteProvider } from "@/components/canvas/canvas-edge-routes";
import { CanvasNodeRenderer } from "@/components/canvas/canvas-node";
import { CanvasBoundaryRenderer } from "@/components/canvas/canvas-boundary";
import { BoundaryResizeContext, type BoundaryResizeActions } from "@/lib/canvas-boundary-context";
import { CanvasMotionProvider } from "@/components/canvas/canvas-motion-context";
import { LiveCursors } from "@/components/canvas/live-cursors";
import { useSetAgentPresence } from "@/components/canvas/agent-presence";
import { SectionDock } from "@/components/canvas/section-dock";
import { CanvasNoteRenderer } from "@/components/canvas/canvas-note";
import { markNoteForEditing } from "@/lib/canvas-note-edit";
import { NoteButton } from "@/components/canvas/note-button";
import { NoteContextMenu } from "@/components/canvas/note-context-menu";
import { useAddNoteShortcut } from "@/hooks/use-keyboard-shortcuts";
import { createNoteNode } from "@/lib/canvas-note";
import { useCanvasSave } from "@/components/canvas/canvas-save-context";
import { useCanvasAutosave } from "@/hooks/use-canvas-autosave";
import { useCanvasHistory } from "@/hooks/use-canvas-history";
import { useSmoothScrollPan } from "@/hooks/use-smooth-scroll-pan";
import { useCanvasRemoteSync } from "@/hooks/use-canvas-remote-sync";
import { isCanvasHistoryCommit } from "@/lib/canvas-history";
import { canonicalCanvasPayload, type CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { RemoteCanvas } from "@/lib/canvas-client";
import { planCanvasEdits, playCanvasEdits } from "@/lib/canvas-replay";
import {
  AWS_DRAG_MIME,
  CODE_DRAG_MIME,
  NOTE_DRAG_MIME,
  SHAPE_DRAG_MIME,
  buildCatalogNode,
  parseAwsDragPayload,
  parseCodeDragPayload,
  createNodeId,
  parseShapeDragPayload,
  type ShapeDragPayload,
} from "@/lib/canvas-drag";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  CANVAS_BOUNDARY_TYPE,
  CANVAS_NOTE_TYPE,
  CONNECTION_SNAP_RADIUS,
  DEFAULT_NODE_COLOR,
  MIN_ZOOM,
  NODE_DEFAULT_SIZES,
  type CanvasEdge,
  type CanvasNode,
  type NodeShape,
} from "@/types/canvas";
import {
  finishCanvasDrop,
  deleteCanvasSubtrees,
  insertCanvasItem,
  resizeCanvasBoundary,
} from "@/lib/canvas-interaction";

import "@xyflow/react/dist/style.css";

// Module scope, not inline: React Flow re-registers every node type when this
// object's identity changes, which on an inline literal is every render.
const NODE_TYPES: NodeTypes = {
  [CANVAS_NODE_TYPE]: CanvasNodeRenderer,
  [CANVAS_BOUNDARY_TYPE]: CanvasBoundaryRenderer,
  [CANVAS_NOTE_TYPE]: CanvasNoteRenderer,
};

const EDGE_TYPES: EdgeTypes = {
  [CANVAS_EDGE_TYPE]: CanvasEdgeRenderer,
};

/**
 * A new edge with every canvas default written onto it, so the stored edge and
 * the rendered one are the same object with no post-processing step
 * (16-edge-behavior). `data.label` starts empty so the key always exists.
 */
function createCanvasEdge(connection: Connection): CanvasEdge {
  return {
    ...connection,
    id: `edge-${crypto.randomUUID()}`,
    type: CANVAS_EDGE_TYPE,
    data: { label: "" },
    style: CANVAS_EDGE_STYLE,
    markerEnd: CANVAS_EDGE_MARKER,
  } as CanvasEdge;
}

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
 * The canvas surface.
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
  /** The diagram the canvas is persisted under. */
  diagramId: string;
  /** The stored canvas this editor opened on, loaded by `CanvasSurface`. */
  initial: RemoteCanvas;
}

function CanvasFlow({ diagramId, initial }: CanvasProps) {
  /*
   * Autosave state reaches the navbar through context rather than a callback
   * prop: the indicator lives outside `ReactFlowProvider` and cannot read the
   * flow state that drives it (21-canvas-autosave).
   */
  const { setStatus: setSaveStatus, registerSaveNow, registerSyncNow } = useCanvasSave();
  const [nodes, setNodes, applyNodeChanges] = useNodesState<CanvasNode>(initial.snapshot.nodes);
  const [edges, setEdges, applyEdgeChanges] = useEdgesState<CanvasEdge>(initial.snapshot.edges);
  const { screenToFlowPosition } = useReactFlow<CanvasNode, CanvasEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  useSmoothScrollPan(wrapperRef);
  const replaying = useRef(false);
  const [isReplaying, setIsReplaying] = useState(false);

  const current = useMemo(() => ({ nodes, edges }), [nodes, edges]);
  const payload = useMemo(() => canonicalCanvasPayload(current), [current]);

  const restore = useCallback(
    (snapshot: CanvasSnapshot) => {
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
    },
    [setEdges, setNodes],
  );
  const restoreLocal = useCallback((snapshot: CanvasSnapshot) => {
    if (!replaying.current) restore(snapshot);
  }, [restore]);
  const history = useCanvasHistory(current, restoreLocal);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      if (replaying.current) {
        applyNodeChanges(changes.filter((change) => change.type === "dimensions"));
        return;
      }
      if (changes.some((change) => isCanvasHistoryCommit(change, nodes))) {
        history.checkpoint();
      }

      applyNodeChanges(changes);
    },
    [applyNodeChanges, history, nodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      if (replaying.current) {
        return;
      }
      if (changes.some((change) => isCanvasHistoryCommit(change, nodes))) {
        history.checkpoint();
      }

      applyEdgeChanges(changes);
    },
    [applyEdgeChanges, history, nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (replaying.current) return;
      history.checkpoint();
      setEdges((existing) => addEdge(createCanvasEdge(connection), existing));
    },
    [history, setEdges],
  );

  // Read from an async callback that outlives the render that created it.
  const latest = useRef<CanvasSnapshot>(current);

  useEffect(() => {
    latest.current = current;
  }, [current]);

  // Commit snapshot for transactions: update synchronously so drag-stop
  // callbacks use the current geometry, not a stale render's state.
  const commitSnapshot = useCallback((next: CanvasSnapshot) => {
    latest.current = next;
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [setNodes, setEdges]);

  const addNode = useCallback(
    ({ shape, width, height }: ShapeDragPayload, center: XYPosition) => {
      if (replaying.current) return;
      history.checkpoint({ force: true });
      const node: CanvasNode = {
        id: createNodeId(shape),
        type: CANVAS_NODE_TYPE,
        // Centred on the drop point rather than hanging off its corner.
        position: { x: center.x - width / 2, y: center.y - height / 2 },
        width,
        height,
        data: { label: "", color: DEFAULT_NODE_COLOR, shape },
      };
      commitSnapshot(insertCanvasItem(latest.current, node));
    },
    [history, commitSnapshot],
  );

  const addCatalogEntry = useCallback(
    (catalogId: string, center: XYPosition) => {
      // Size, kind and label come from the catalog, never from a drag payload.
      const node = buildCatalogNode(catalogId, center);
      if (!node || replaying.current) return;
      history.checkpoint({ force: true });
      commitSnapshot(insertCanvasItem(latest.current, node));
    },
    [history, commitSnapshot],
  );

  const boundaryResize = useMemo<BoundaryResizeActions>(
    () => ({
      start: () => {
        if (!replaying.current) history.checkpoint({ force: true });
      },
      resize: (id, bounds) => {
        if (!replaying.current) commitSnapshot(resizeCanvasBoundary(latest.current, id, bounds));
      },
    }),
    [history, commitSnapshot],
  );

  const autosave = useCanvasAutosave(diagramId, payload, initial.version, setSaveStatus);

  useEffect(() => {
    registerSaveNow(autosave.saveNow);

    // The handle must not outlive the canvas, or a Save click on the editor
    // home would call into an unmounted canvas.
    return () => registerSaveNow(null);
  }, [autosave.saveNow, registerSaveNow]);

  const setAgentPresence = useSetAgentPresence();

  const onNodeDragStart = useCallback(
    () => {
      if (replaying.current) return;
      history.checkpoint({ force: true });
    },
    [history, replaying],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: CanvasNode) => {
      if (replaying.current) return;
      commitSnapshot(finishCanvasDrop(latest.current, node.id));
    },
    [commitSnapshot],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (replaying.current) return;

      // Check if focus is on an input/textarea/editable element
      const target = event.target as HTMLElement;
      const isEditableElement =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true" ||
        target.classList.contains("nokey");

      if (isEditableElement) {
        return;
      }

      // Handle Delete/Backspace for selected nodes
      if ((event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();

        // Get selected node IDs
        const selectedIds = nodes
          .filter((node) => node.selected)
          .map((node) => node.id);

        const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));

        if (selectedIds.length > 0 || selectedEdgeIds.size > 0) {
          history.checkpoint({ force: true });
          const next = deleteCanvasSubtrees(latest.current, selectedIds);
          commitSnapshot({ ...next, edges: next.edges.filter((edge) => !selectedEdgeIds.has(edge.id)) });
        }
      }
    },
    [nodes, edges, history, commitSnapshot, replaying],
  );

  const applyRemoteCanvas = useCallback(
    async (remote: RemoteCanvas) => {
      autosave.adopt(canonicalCanvasPayload(remote.snapshot), remote.version);
      // Undo must never reach back across a change this tab did not make.
      history.reset();

      if (!remote.isAgentWrite) {
        restore(remote.snapshot);
        return;
      }

      const edits = planCanvasEdits(latest.current, remote.snapshot);

      replaying.current = true;
      setIsReplaying(true);
      try {
        await autosave.whilePaused(async () => {
          await playCanvasEdits(edits, { setNodes, setEdges }, {
            showAgent: (cursor, editing) => setAgentPresence({ cursor, editing }),
            clearAgent: () => setAgentPresence(null),
            sleep: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
          });
          // Edits append and replace in place, so order can differ from the
          // stored snapshot; landing on it exactly keeps autosave clean.
          restore(remote.snapshot);
        });
      } finally {
        replaying.current = false;
        setIsReplaying(false);
      }
    },
    [autosave, history, restore, setAgentPresence, setEdges, setNodes],
  );

  const { syncNow } = useCanvasRemoteSync(diagramId, autosave, applyRemoteCanvas);

  useEffect(() => {
    registerSyncNow(syncNow);

    return () => registerSyncNow(null);
  }, [registerSyncNow, syncNow]);

  /** Every way of adding a note lands here: a yellow 200×200 note, selected and in its editor. */
  const addNote = useCallback(
    (center: XYPosition) => {
      if (replaying.current) return;
      history.checkpoint({ force: true });
      const note: CanvasNode = { ...createNoteNode(center), selected: true };
      markNoteForEditing(note.id);
      commitSnapshot({
        ...latest.current,
        nodes: [...latest.current.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)), note],
      });
    },
    [history, commitSnapshot],
  );

  const addNoteAtCenter = useCallback(() => {
    const bounds = wrapperRef.current?.getBoundingClientRect();
    if (!bounds) return;
    addNote(screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }));
  }, [addNote, screenToFlowPosition]);

  useAddNoteShortcut(addNoteAtCenter);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const { types } = event.dataTransfer;
    if (!types.includes(SHAPE_DRAG_MIME) && !types.includes(AWS_DRAG_MIME) && !types.includes(CODE_DRAG_MIME) && !types.includes(NOTE_DRAG_MIME)) {
      return;
    }

    // Without preventDefault the browser refuses the drop entirely.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (event.dataTransfer.types.includes(NOTE_DRAG_MIME)) {
        event.preventDefault();
        addNote(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        return;
      }

      const aws = parseAwsDragPayload(event.dataTransfer.getData(AWS_DRAG_MIME));

      if (aws) {
        event.preventDefault();
        addCatalogEntry(aws.catalogId, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        return;
      }

      const code = parseCodeDragPayload(event.dataTransfer.getData(CODE_DRAG_MIME));

      if (code) {
        event.preventDefault();
        addCatalogEntry(code.catalogId, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        return;
      }

      const payload = parseShapeDragPayload(
        event.dataTransfer.getData(SHAPE_DRAG_MIME),
      );

      if (!payload) {
        return;
      }

      event.preventDefault();
      addNode(
        payload,
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [addCatalogEntry, addNode, addNote, screenToFlowPosition],
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
        }),
      );
    },
    [addNode, screenToFlowPosition],
  );

  const handleAddCatalogEntry = useCallback(
    (catalogId: string) => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      addCatalogEntry(
        catalogId,
        screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }),
      );
    },
    [addCatalogEntry, screenToFlowPosition],
  );

  return (
    <div
      ref={wrapperRef}
      inert={isReplaying}
      aria-busy={isReplaying}
      // `relative` anchors the agent cursor overlay to the canvas.
      className="relative h-full w-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={handleKeyDown}
    >
      <BoundaryResizeContext.Provider value={boundaryResize}>
      <CanvasEdgeRouteProvider nodes={nodes} edges={edges}>
        <NoteContextMenu onAdd={(point) => addNote(screenToFlowPosition(point))}>
        <ReactFlow<CanvasNode, CanvasEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          deleteKeyCode={null}
          // Selecting a boundary must not raise it above its descendants.
          elevateNodesOnSelect={false}
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
          // Figma-style trackpad: two-finger scroll pans (useSmoothScrollPan),
          // pinch zooms (zoomOnPinch, on by default).
          zoomOnScroll={false}
          fitView
          minZoom={MIN_ZOOM}
          proOptions={{ hideAttribution: true }}
          // Themes React Flow's remaining chrome (the minimap) to match the dark
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
            <div className="flex items-end gap-2">
              <SectionDock onAddShape={handleAddShape} onAddAws={handleAddCatalogEntry} onAddCode={handleAddCatalogEntry} />
              <NoteButton onAdd={addNoteAtCenter} />
            </div>
          </Panel>
          <Panel position="bottom-left">
            <CanvasControls history={history} />
          </Panel>
        </ReactFlow>
        </NoteContextMenu>
      </CanvasEdgeRouteProvider>
      </BoundaryResizeContext.Provider>

      <LiveCursors />
    </div>
  );
}
