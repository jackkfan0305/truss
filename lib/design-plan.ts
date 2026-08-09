import type { XYPosition } from "@xyflow/react";
import type { MutableFlow } from "@liveblocks/react-flow/node";

import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  DEFAULT_NODE_COLOR,
  DEFAULT_NODE_SHAPE,
  NODE_COLORS,
  NODE_DEFAULT_SIZES,
  NODE_MIN_SIZE,
  NODE_SHAPES,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type NodeColor,
  type NodeShape,
  type NodeSize,
} from "@/types/canvas";

/**
 * The design agent's trust boundary (23-design-agent-logic).
 *
 * Everything a model returns is untrusted input: it can name a shape that does
 * not exist, a colour outside the palette, a node ID that was never created, or
 * stack every node on the same coordinate. This module turns that into canvas
 * objects that are already valid — so `applyDesignPlan` is a plain switch and
 * nothing downstream has to re-check the palette or the schema.
 *
 * Pure and DOM-free, so `scripts/verify-design-agent.ts` can exercise it
 * without a room, a model or a browser.
 */

export const DESIGN_ACTION_TYPES = [
  "addNode",
  "moveNode",
  "resizeNode",
  "updateNodeData",
  "deleteNode",
  "addEdge",
  "deleteEdge",
] as const;

export type DesignActionType = (typeof DESIGN_ACTION_TYPES)[number];

/** The palette keys, as an array — the schema and the validator both need one. */
export const NODE_COLOR_NAMES = Object.keys(NODE_COLORS) as NodeColor[];

/**
 * One generation is one paid run and one Storage write. A model asked for "a
 * microservices diagram" returns a dozen or so actions; this is the ceiling
 * that keeps a runaway response from rewriting the whole canvas.
 */
export const MAX_DESIGN_ACTIONS = 60;

/** Positions snap to this, matching the canvas `Background` dot grid. */
export const LAYOUT_GRID = 20;

/** The clear space every generated node keeps from its neighbours, in flow units. */
export const MIN_NODE_GAP = 40;

/** How far right of the existing diagram a generated one starts. */
const NEW_CONTENT_OFFSET = 80;

/**
 * Auto-placed nodes lay out in rows of this many before wrapping. The steps
 * clear the widest and tallest default node plus `EDGE_LABEL_CLEARANCE`, so a
 * labelled edge between two auto-placed nodes has somewhere to draw itself
 * instead of landing on one of them.
 */
const AUTO_COLUMNS = 4;
const AUTO_COLUMN_STEP = 380;
const AUTO_ROW_STEP = 240;

/** A node big enough to matter, small enough to stay on a readable canvas. */
const MAX_NODE_SIZE: NodeSize = { width: 800, height: 600 };

/** Generated IDs are prefixed so they never collide with `createNodeId`'s. */
const AI_NODE_ID_PREFIX = "ai";
const MAX_ID_LENGTH = 48;
const MAX_LABEL_LENGTH = 80;

/** A push-down loop has to terminate even against a pathological canvas. */
const MAX_PLACEMENT_ATTEMPTS = 50;

export type DesignAction =
  | { type: "addNode"; node: CanvasNode }
  | { type: "moveNode"; id: string; position: XYPosition }
  | { type: "resizeNode"; id: string; width: number; height: number }
  | { type: "updateNodeData"; id: string; data: Partial<CanvasNodeData> }
  | { type: "deleteNode"; id: string }
  | { type: "addEdge"; edge: CanvasEdge }
  | { type: "deleteEdge"; id: string };

export interface DesignPlan {
  summary: string;
  actions: DesignAction[];
}

/** The canvas as it was when the run started — what IDs and space are taken. */
export interface DesignContext {
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
}

export interface Box extends NodeSize, XYPosition {}

/**
 * Validates and normalizes a raw model response into a plan the canvas can
 * apply. Never throws and never returns a partially-valid action: an action it
 * cannot make sense of is dropped, because half of an instruction ("move this
 * node" with no destination) is worse on a shared canvas than none of it.
 */
export function parseDesignPlan(
  raw: unknown,
  context: DesignContext
): DesignPlan {
  const summary = readSummary(raw);
  const rawActions = readActionList(raw);
  const resolver = createIdResolver(context);
  const layout = createLayout(context);
  const actions: DesignAction[] = [];

  for (const rawAction of rawActions.slice(0, MAX_DESIGN_ACTIONS)) {
    const type = readString(rawAction, "type");

    if (!isActionType(type)) {
      continue;
    }

    actions.push(...buildActions(type, rawAction, resolver, layout));
  }

  return { summary, actions };
}

/**
 * Writes a plan into the shared room through `@liveblocks/react-flow`'s own
 * server-side flow helpers, which is what keeps an AI edit indistinguishable
 * from a human one — same Storage shape, same conflict resolution, no parallel
 * write path.
 */
export function applyDesignPlan(
  flow: MutableFlow<CanvasNode, CanvasEdge>,
  plan: DesignPlan
): void {
  for (const action of plan.actions) {
    applyDesignAction(flow, action);
  }
}

/**
 * One action, so the agent can pace the plan out over time and let the AI
 * cursor arrive somewhere before the thing it is placing appears there.
 *
 * The unit of a *write*, not of a transaction: the caller decides whether these
 * land inside one `mutateFlow` or many. Both are correct; the agent uses one,
 * because Liveblocks flushes buffered ops on a debounce while the callback runs.
 */
export function applyDesignAction(
  flow: MutableFlow<CanvasNode, CanvasEdge>,
  action: DesignAction
): void {
  switch (action.type) {
    case "addNode":
      flow.addNode(action.node);
      break;
    case "moveNode":
      flow.updateNode(action.id, { position: action.position });
      break;
    case "resizeNode":
      flow.updateNode(action.id, {
        width: action.width,
        height: action.height,
      });
      break;
    case "updateNodeData":
      flow.updateNodeData(action.id, action.data);
      break;
    case "deleteNode":
      flow.removeNode(action.id);
      break;
    case "addEdge":
      flow.addEdge(action.edge);
      break;
    case "deleteEdge":
      flow.removeEdge(action.id);
      break;
  }
}

/**
 * Where the AI cursor should be standing when an action lands.
 *
 * Resolved against the canvas the run started from *plus* the nodes this plan
 * has already placed, because most actions in a generated plan refer to nodes
 * that did not exist when the run began.
 *
 * `null` means "no move": the cursor stays where it was. That is the honest
 * answer for an action whose subject cannot be located, and it beats the
 * alternative of sending the cursor to the origin, which reads as the AI
 * wandering off to a corner of the canvas for no reason.
 */
export function createCursorTargets(context: DesignContext) {
  const positions = new Map<string, XYPosition>(
    context.nodes.map((node) => [node.id, node.position])
  );
  const edgeTargets = new Map<string, string>(
    context.edges.map((edge) => [edge.id, edge.target])
  );

  return {
    /** Call in plan order — later actions resolve against earlier placements. */
    next(action: DesignAction): XYPosition | null {
      switch (action.type) {
        case "addNode":
          positions.set(action.node.id, action.node.position);

          return action.node.position;

        case "moveNode":
          positions.set(action.id, action.position);

          return action.position;

        case "addEdge":
          edgeTargets.set(action.edge.id, action.edge.target);

          // The target, not the source: the cursor travelling toward where the
          // connection lands is what makes an edge read as being drawn.
          return positions.get(action.edge.target) ?? null;

        case "deleteEdge": {
          const target = edgeTargets.get(action.id);

          return target === undefined ? null : positions.get(target) ?? null;
        }

        default:
          return positions.get(action.id) ?? null;
      }
    },
  };
}

/** The first position of the first node the plan adds, for the AI cursor. */
export function getPlanFocus(plan: DesignPlan): XYPosition | null {
  for (const action of plan.actions) {
    if (action.type === "addNode") {
      return action.node.position;
    }

    if (action.type === "moveNode") {
      return action.position;
    }
  }

  return null;
}

/**
 * What an action operated on, for the sidebar's activity list
 * (26-ai-chat-functional). The label where there is one, since that is what the
 * user can see on the canvas; the ID otherwise, which is all a delete has.
 */
export function describeDesignAction(action: DesignAction): string {
  switch (action.type) {
    case "addNode":
      return action.node.data.label;
    case "addEdge":
      return `${action.edge.source} → ${action.edge.target}`;
    case "updateNodeData":
      return action.data.label ?? action.id;
    default:
      return action.id;
  }
}

// --- actions ---------------------------------------------------------------

function buildActions(
  type: DesignActionType,
  raw: unknown,
  resolver: IdResolver,
  layout: Layout
): DesignAction[] {
  switch (type) {
    case "addNode":
      return buildAddNode(raw, resolver, layout);
    case "moveNode":
      return buildMoveNode(raw, resolver);
    case "resizeNode":
      return buildResizeNode(raw, resolver);
    case "updateNodeData":
      return buildUpdateNodeData(raw, resolver);
    case "deleteNode":
      return buildDeleteNode(raw, resolver);
    case "addEdge":
      return buildAddEdge(raw, resolver);
    case "deleteEdge":
      return buildDeleteEdge(raw, resolver);
  }
}

function buildAddNode(
  raw: unknown,
  resolver: IdResolver,
  layout: Layout
): DesignAction[] {
  const shape = readShape(raw) ?? DEFAULT_NODE_SHAPE;
  const size = readSize(raw) ?? NODE_DEFAULT_SIZES[shape];
  const id = resolver.claimNodeId(readString(raw, "id"));
  const position = layout.place(readPosition(raw), size);

  return [
    {
      type: "addNode",
      node: {
        id,
        type: CANVAS_NODE_TYPE,
        position,
        width: size.width,
        height: size.height,
        data: {
          label: readLabel(raw) ?? "",
          color: readColor(raw) ?? DEFAULT_NODE_COLOR,
          shape,
        },
      },
    },
  ];
}

function buildMoveNode(raw: unknown, resolver: IdResolver): DesignAction[] {
  const id = resolver.resolveNodeId(readString(raw, "id"));
  const position = readPosition(raw);

  if (!id || !position) {
    return [];
  }

  return [{ type: "moveNode", id, position: snapPosition(position) }];
}

function buildResizeNode(raw: unknown, resolver: IdResolver): DesignAction[] {
  const id = resolver.resolveNodeId(readString(raw, "id"));
  const size = readSize(raw);

  if (!id || !size) {
    return [];
  }

  return [{ type: "resizeNode", id, width: size.width, height: size.height }];
}

function buildUpdateNodeData(
  raw: unknown,
  resolver: IdResolver
): DesignAction[] {
  const id = resolver.resolveNodeId(readString(raw, "id"));

  if (!id) {
    return [];
  }

  const label = readLabel(raw);
  const color = readColor(raw);
  const shape = readShape(raw);
  const data: Partial<CanvasNodeData> = {
    ...(label === null ? {} : { label }),
    ...(color === null ? {} : { color }),
    ...(shape === null ? {} : { shape }),
  };

  // An update naming no valid field is not an update.
  return Object.keys(data).length === 0 ? [] : [{ type: "updateNodeData", id, data }];
}

/**
 * Deleting a node also deletes the edges attached to it. React Flow's own
 * `onDelete` does this for a human deletion; skipping it here would leave edges
 * pointing at a node that no longer exists, which render as nothing and are
 * unreachable from the canvas.
 */
function buildDeleteNode(raw: unknown, resolver: IdResolver): DesignAction[] {
  const id = resolver.resolveNodeId(readString(raw, "id"));

  if (!id) {
    return [];
  }

  resolver.releaseNodeId(id);

  return [
    { type: "deleteNode", id },
    ...resolver
      .takeEdgesAttachedTo(id)
      .map((edgeId): DesignAction => ({ type: "deleteEdge", id: edgeId })),
  ];
}

function buildAddEdge(raw: unknown, resolver: IdResolver): DesignAction[] {
  const source = resolver.resolveNodeId(readString(raw, "source"));
  const target = resolver.resolveNodeId(readString(raw, "target"));

  // A self-loop has no route in `getSmoothStepPath` and draws as a degenerate
  // line under its own node, the same reason `isValidConnection` rejects one.
  if (!source || !target || source === target) {
    return [];
  }

  return [
    {
      type: "addEdge",
      edge: {
        id: resolver.claimEdgeId(source, target),
        type: CANVAS_EDGE_TYPE,
        source,
        target,
        data: { label: readLabel(raw) ?? "" },
        style: CANVAS_EDGE_STYLE,
        markerEnd: CANVAS_EDGE_MARKER,
      },
    },
  ];
}

function buildDeleteEdge(raw: unknown, resolver: IdResolver): DesignAction[] {
  const id =
    resolver.resolveEdgeId(readString(raw, "id")) ??
    resolver.findEdgeBetween(
      resolver.resolveNodeId(readString(raw, "source")),
      resolver.resolveNodeId(readString(raw, "target"))
    );

  if (!id) {
    return [];
  }

  resolver.releaseEdgeId(id);

  return [{ type: "deleteEdge", id }];
}

// --- identity --------------------------------------------------------------

interface IdResolver {
  /** A fresh, unique node ID, derived from the model's name when it gave one. */
  claimNodeId: (proposed: string | null) => string;
  claimEdgeId: (source: string, target: string) => string;
  /** The real ID behind a name the model used, or `null` if there is none. */
  resolveNodeId: (proposed: string | null) => string | null;
  resolveEdgeId: (proposed: string | null) => string | null;
  findEdgeBetween: (source: string | null, target: string | null) => string | null;
  takeEdgesAttachedTo: (nodeId: string) => string[];
  releaseNodeId: (id: string) => void;
  releaseEdgeId: (id: string) => void;
}

/**
 * A model refers to nodes by the names it invented in the same response
 * (`"gateway"`, `"orders-db"`), so an edge can only be wired up if those names
 * survive as a lookup. Names are mapped to real IDs once, at creation, and every
 * later reference — including a reference to a node that already existed on the
 * canvas — goes through the same map.
 */
function createIdResolver(context: DesignContext): IdResolver {
  const nodeIds = new Set(context.nodes.map((node) => node.id));
  const edgeIds = new Set(context.edges.map((edge) => edge.id));
  const aliases = new Map<string, string>();
  const edgeEndpoints = new Map<string, { source: string; target: string }>(
    context.edges.map((edge) => [
      edge.id,
      { source: edge.source, target: edge.target },
    ])
  );
  let counter = 0;

  const uniqueId = (base: string, taken: Set<string>): string => {
    let candidate = base;

    while (taken.has(candidate)) {
      counter += 1;
      candidate = `${base}-${counter}`;
    }

    taken.add(candidate);

    return candidate;
  };

  return {
    claimNodeId(proposed) {
      const name = sanitizeId(proposed);
      const base = name
        ? `${AI_NODE_ID_PREFIX}-${name}`
        : `${AI_NODE_ID_PREFIX}-node-${(counter += 1)}`;
      const id = uniqueId(base, nodeIds);

      if (name) {
        aliases.set(name, id);
      }

      return id;
    },

    claimEdgeId(source, target) {
      return uniqueId(`${AI_NODE_ID_PREFIX}-edge-${source}-${target}`, edgeIds);
    },

    resolveNodeId(proposed) {
      if (proposed === null) {
        return null;
      }

      // Checked before the alias map: a raw ID that is already on the canvas is
      // what the model was shown, so it wins over a name it coined this turn.
      if (nodeIds.has(proposed)) {
        return proposed;
      }

      const name = sanitizeId(proposed);

      return (name && aliases.get(name)) ?? null;
    },

    resolveEdgeId(proposed) {
      return proposed !== null && edgeIds.has(proposed) ? proposed : null;
    },

    findEdgeBetween(source, target) {
      if (!source || !target) {
        return null;
      }

      for (const [id, endpoints] of edgeEndpoints) {
        if (endpoints.source === source && endpoints.target === target) {
          return id;
        }
      }

      return null;
    },

    takeEdgesAttachedTo(nodeId) {
      const attached: string[] = [];

      for (const [id, endpoints] of edgeEndpoints) {
        if (endpoints.source === nodeId || endpoints.target === nodeId) {
          attached.push(id);
          edgeEndpoints.delete(id);
          edgeIds.delete(id);
        }
      }

      return attached;
    },

    releaseNodeId(id) {
      nodeIds.delete(id);
    },

    releaseEdgeId(id) {
      edgeIds.delete(id);
      edgeEndpoints.delete(id);
    },
  };
}

function sanitizeId(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH);

  return cleaned.length > 0 ? cleaned : null;
}

// --- layout ----------------------------------------------------------------

interface Layout {
  /** Snaps a position to the grid and pushes it clear of everything placed. */
  place: (proposed: XYPosition | null, size: NodeSize) => XYPosition;
}

/**
 * The layout and spacing rules from the spec, in one place: every generated
 * node lands on the canvas grid and keeps `MIN_NODE_GAP` clear of every node
 * already on the canvas and of every node this plan places.
 *
 * A model that omits positions entirely — or returns the same one for every
 * node — is the common failure, and it produces a single unreadable pile. The
 * fallback lays those out in rows just clear of the existing diagram, so a
 * generated design never lands on top of the user's work.
 */
function createLayout(context: DesignContext): Layout {
  const boxes = context.nodes.map(toBox);
  const origin = {
    x: boxes.length === 0 ? 0 : maxOf(boxes, (box) => box.x + box.width) + NEW_CONTENT_OFFSET,
    y: boxes.length === 0 ? 0 : minOf(boxes, (box) => box.y),
  };
  let autoIndex = 0;

  return {
    place(proposed, size) {
      const start = proposed ?? nextAutoPosition(origin, autoIndex);

      if (!proposed) {
        autoIndex += 1;
      }

      const placed = pushClear(snapPosition(start), size, boxes);

      boxes.push({ ...placed, ...size });

      return placed;
    },
  };
}

function nextAutoPosition(origin: XYPosition, index: number): XYPosition {
  return {
    x: origin.x + (index % AUTO_COLUMNS) * AUTO_COLUMN_STEP,
    y: origin.y + Math.floor(index / AUTO_COLUMNS) * AUTO_ROW_STEP,
  };
}

/**
 * Downwards rather than in the nearest free direction: it is one axis, it is
 * stable (the same plan lays out the same way twice), and a diagram that grows
 * down stays inside the viewport React Flow fits to.
 *
 * ponytail: no force-directed relaxation and no edge-aware routing. If diagrams
 * start reading as columns rather than as flows, that is when a real layout
 * pass (dagre/elk) earns its dependency.
 */
function pushClear(
  start: XYPosition,
  size: NodeSize,
  boxes: readonly Box[]
): XYPosition {
  let candidate = { ...start };

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) {
    const blocker = boxes.find((box) => overlaps({ ...candidate, ...size }, box));

    if (!blocker) {
      return candidate;
    }

    candidate = {
      x: candidate.x,
      y: snapUp(blocker.y + blocker.height + MIN_NODE_GAP),
    };
  }

  return candidate;
}

/** Boxes inflated by the gap, so touching counts as too close. */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width + MIN_NODE_GAP &&
    a.x + a.width + MIN_NODE_GAP > b.x &&
    a.y < b.y + b.height + MIN_NODE_GAP &&
    a.y + a.height + MIN_NODE_GAP > b.y
  );
}

/**
 * A node's occupied rectangle. Exported because the prompt builder describes the
 * same rectangles to the model that the layout uses to avoid overlaps — if the
 * two disagreed, the model would be reasoning about sizes the canvas does not have.
 */
export function toBox(node: CanvasNode): Box {
  const fallback = NODE_DEFAULT_SIZES[node.data.shape] ?? NODE_DEFAULT_SIZES.rectangle;

  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? fallback.width,
    height: node.height ?? fallback.height,
  };
}

function snapPosition(position: XYPosition): XYPosition {
  return { x: snap(position.x), y: snap(position.y) };
}

function snap(value: number): number {
  return Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
}

/** Rounds away from the blocker, so a push never lands back inside it. */
function snapUp(value: number): number {
  return Math.ceil(value / LAYOUT_GRID) * LAYOUT_GRID;
}

function maxOf<T>(items: readonly T[], read: (item: T) => number): number {
  return items.reduce((best, item) => Math.max(best, read(item)), -Infinity);
}

function minOf<T>(items: readonly T[], read: (item: T) => number): number {
  return items.reduce((best, item) => Math.min(best, read(item)), Infinity);
}

// --- field readers ---------------------------------------------------------

function readSummary(raw: unknown): string {
  const summary = readString(raw, "summary");

  return summary === null ? "" : summary.slice(0, MAX_LABEL_LENGTH * 4);
}

function readActionList(raw: unknown): unknown[] {
  if (typeof raw !== "object" || raw === null) {
    return [];
  }

  const actions = (raw as Record<string, unknown>).actions;

  return Array.isArray(actions) ? actions : [];
}

function readString(raw: unknown, key: string): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const value = (raw as Record<string, unknown>)[key];

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function readLabel(raw: unknown): string | null {
  const label = readString(raw, "label");

  return label === null ? null : label.slice(0, MAX_LABEL_LENGTH);
}

function readNumber(raw: unknown, key: string): number | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const value = (raw as Record<string, unknown>)[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPosition(raw: unknown): XYPosition | null {
  const x = readNumber(raw, "x");
  const y = readNumber(raw, "y");

  // Both or neither: half a coordinate is not a position, and defaulting the
  // missing axis to 0 drags the node to the origin.
  return x === null || y === null ? null : { x, y };
}

function readSize(raw: unknown): NodeSize | null {
  const width = readNumber(raw, "width");
  const height = readNumber(raw, "height");

  if (width === null || height === null) {
    return null;
  }

  return {
    width: clamp(width, NODE_MIN_SIZE.width, MAX_NODE_SIZE.width),
    height: clamp(height, NODE_MIN_SIZE.height, MAX_NODE_SIZE.height),
  };
}

function readShape(raw: unknown): NodeShape | null {
  const shape = readString(raw, "shape");

  return NODE_SHAPES.includes(shape as NodeShape) ? (shape as NodeShape) : null;
}

function readColor(raw: unknown): NodeColor | null {
  const color = readString(raw, "color");

  return color !== null && color in NODE_COLORS ? (color as NodeColor) : null;
}

function isActionType(value: string | null): value is DesignActionType {
  return DESIGN_ACTION_TYPES.includes(value as DesignActionType);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
