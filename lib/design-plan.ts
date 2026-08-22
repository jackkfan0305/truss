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
import { applyLayout } from "@/lib/graph-layout";

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

/**
 * The action types a model is allowed to request. `moveNode` and `updateEdge`
 * are deliberately absent: the app lays out the whole graph on every
 * generation now (`layoutPlan` below), so a model-requested position is never
 * honoured and a model has no coordinate to update a handle from either.
 * Both still exist as `DesignAction` variants — `layoutPlan` emits them
 * itself — just never as something raw model output can produce.
 */
export const DESIGN_ACTION_TYPES = [
  "addNode",
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

/** A node big enough to matter, small enough to stay on a readable canvas. */
const MAX_NODE_SIZE: NodeSize = { width: 800, height: 600 };

/** Generated IDs are prefixed so they never collide with `createNodeId`'s. */
const AI_NODE_ID_PREFIX = "ai";
const MAX_ID_LENGTH = 48;
const MAX_LABEL_LENGTH = 80;

export type DesignAction =
  | { type: "addNode"; node: CanvasNode }
  // `label` rides along so the sidebar activity list can name the node a
  // relayout moved without `describeDesignAction` needing a lookup table —
  // every `moveNode` is `layoutPlan`'s own output now, and it already has
  // the node's current label in hand when it builds one.
  | { type: "moveNode"; id: string; position: XYPosition; label: string }
  | { type: "resizeNode"; id: string; width: number; height: number }
  | { type: "updateNodeData"; id: string; data: Partial<CanvasNodeData> }
  | { type: "deleteNode"; id: string }
  | { type: "addEdge"; edge: CanvasEdge }
  | { type: "deleteEdge"; id: string }
  // Never built from raw model output (see `DESIGN_ACTION_TYPES`) — only
  // `layoutPlan` emits this, to refresh a pre-existing edge's handles after
  // a relayout moved one of its endpoints.
  | { type: "updateEdge"; id: string; sourceHandle: string; targetHandle: string };

export interface DesignPlan {
  summary: string;
  actions: DesignAction[];
}

/** The canvas as it was when the run started — what IDs and space are taken. */
export interface DesignContext {
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
}

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
  const actions: DesignAction[] = [];

  // The cap applies to what the model asked for, not to what `layoutPlan`
  // adds on top — a relayout's own moves and handle refreshes are never
  // truncated by it.
  for (const rawAction of rawActions.slice(0, MAX_DESIGN_ACTIONS)) {
    const type = readString(rawAction, "type");

    if (!isActionType(type)) {
      continue;
    }

    actions.push(...buildActions(type, rawAction, resolver));
  }

  return { summary, actions: layoutPlan(actions, context) };
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
    case "updateEdge":
      flow.updateEdge(action.id, {
        sourceHandle: action.sourceHandle,
        targetHandle: action.targetHandle,
      });
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

        case "deleteEdge":
        case "updateEdge": {
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
    case "moveNode":
      // Falls back to the id in the rare case the moved node has no label —
      // an empty row would be worse than a raw id, same as `deleteNode`.
      return action.label || action.id;
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
  resolver: IdResolver
): DesignAction[] {
  switch (type) {
    case "addNode":
      return buildAddNode(raw, resolver);
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

function buildAddNode(raw: unknown, resolver: IdResolver): DesignAction[] {
  const shape = readShape(raw) ?? DEFAULT_NODE_SHAPE;
  const size = readSize(raw) ?? NODE_DEFAULT_SIZES[shape];
  const id = resolver.claimNodeId(readString(raw, "id"));

  return [
    {
      type: "addNode",
      node: {
        id,
        type: CANVAS_NODE_TYPE,
        // Overwritten by `layoutPlan` before this plan ever reaches the
        // canvas — the app places every node now, never the model, so there
        // is nothing to read a proposed position for.
        position: { x: 0, y: 0 },
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

// --- layout ------------------------------------------------------------

/**
 * Re-lays out the whole resulting graph after every generation, create and
 * edit alike. This replaces the old `createLayout`/`pushClear` (grid-snap,
 * then shove overlaps straight down) — that knew nothing about edges, so
 * crossings and long back-edges went unmanaged. `applyLayout`
 * (`lib/graph-layout.ts`) is the dagre-based upgrade the old `pushClear`
 * comment named as the intended next step.
 *
 * Folds the layout result back into the actions the model actually asked
 * for: an added node is born at its final position (never an add-then-move
 * pair), an existing node only gets a `moveNode` when its position actually
 * changed, and every edge — generated or pre-existing — ends up with the
 * handle pair its final geometry calls for.
 */
function layoutPlan(
  actions: readonly DesignAction[],
  context: DesignContext
): DesignAction[] {
  const resulting = applyActionsInMemory(context, actions);
  const laidOut = applyLayout(resulting.nodes, resulting.edges);
  const laidOutNodesById = new Map(laidOut.nodes.map((node) => [node.id, node]));
  const laidOutEdgesById = new Map(laidOut.edges.map((edge) => [edge.id, edge]));

  // Adds and edges the plan already asked for, with the layout folded
  // directly into them — never a separate move for something not yet on
  // the canvas.
  const folded = actions.map((action): DesignAction => {
    if (action.type === "addNode") {
      const placed = laidOutNodesById.get(action.node.id);

      return placed
        ? { ...action, node: { ...action.node, position: placed.position } }
        : action;
    }

    if (action.type === "addEdge") {
      const wired = laidOutEdgesById.get(action.edge.id);

      return wired?.sourceHandle && wired.targetHandle
        ? {
            ...action,
            edge: {
              ...action.edge,
              sourceHandle: wired.sourceHandle,
              targetHandle: wired.targetHandle,
            },
          }
        : action;
    }

    return action;
  });

  // A pre-existing node whose layout position did not move needs nothing —
  // a no-op move is a pointless AI-cursor trip and a junk activity row. One
  // that did move gets exactly one `moveNode`, in reading order (left to
  // right, top to bottom) so the relaid-out canvas draws itself sensibly.
  const moves = context.nodes
    .flatMap((node): MoveNodeAction[] => {
      const placed = laidOutNodesById.get(node.id);

      if (!placed || samePosition(placed.position, node.position)) {
        return [];
      }

      return [
        { type: "moveNode", id: node.id, position: placed.position, label: placed.data.label },
      ];
    })
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);

  // A pre-existing edge whose endpoint moved is the exact bug this whole
  // layout pass exists to fix: without a refresh it keeps whatever stale
  // handles it had, which is the top-to-top spaghetti described up top.
  const handleRefreshes = context.edges.flatMap((edge): DesignAction[] => {
    const wired = laidOutEdgesById.get(edge.id);

    if (
      !wired?.sourceHandle ||
      !wired.targetHandle ||
      (wired.sourceHandle === edge.sourceHandle && wired.targetHandle === edge.targetHandle)
    ) {
      return [];
    }

    return [
      { type: "updateEdge", id: edge.id, sourceHandle: wired.sourceHandle, targetHandle: wired.targetHandle },
    ];
  });

  return [...folded, ...moves, ...handleRefreshes];
}

type MoveNodeAction = Extract<DesignAction, { type: "moveNode" }>;

function samePosition(a: XYPosition, b: XYPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * The context nodes/edges with the plan's adds, deletes and data updates
 * applied in memory — what `layoutPlan` actually lays out. Positions are
 * never applied here: `applyLayout` computes every position from graph
 * structure alone, never from a node's current position, so comparing a
 * pre-existing node's *original* context position against the layout result
 * is `layoutPlan`'s job, not this function's.
 */
function applyActionsInMemory(
  context: DesignContext,
  actions: readonly DesignAction[]
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes = new Map(context.nodes.map((node) => [node.id, node]));
  const edges = new Map(context.edges.map((edge) => [edge.id, edge]));
  const nodeOrder = context.nodes.map((node) => node.id);
  const edgeOrder = context.edges.map((edge) => edge.id);

  for (const action of actions) {
    switch (action.type) {
      case "addNode":
        nodes.set(action.node.id, action.node);
        nodeOrder.push(action.node.id);
        break;
      case "deleteNode":
        nodes.delete(action.id);
        break;
      case "resizeNode": {
        const existing = nodes.get(action.id);

        if (existing) {
          nodes.set(action.id, { ...existing, width: action.width, height: action.height });
        }
        break;
      }
      case "updateNodeData": {
        const existing = nodes.get(action.id);

        if (existing) {
          nodes.set(action.id, { ...existing, data: { ...existing.data, ...action.data } });
        }
        break;
      }
      case "addEdge":
        edges.set(action.edge.id, action.edge);
        edgeOrder.push(action.edge.id);
        break;
      case "deleteEdge":
        edges.delete(action.id);
        break;
      default:
        // `moveNode`/`updateEdge` never appear in the raw actions this
        // function is fed — they are `layoutPlan`'s own output, derived
        // from this function's result, not an input to it.
        break;
    }
  }

  return {
    nodes: nodeOrder.filter((id) => nodes.has(id)).map((id) => nodes.get(id)!),
    edges: edgeOrder.filter((id) => edges.has(id)).map((id) => edges.get(id)!),
  };
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
