import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  NODE_DEFAULT_SIZES,
  type CanvasEdge,
  type CanvasNode,
  type NodeColor,
  type NodeShape,
  type NodeSize,
} from "@/types/canvas";

/**
 * The starter template library (18-starter-templates).
 *
 * Templates are plain `CanvasNode`/`CanvasEdge` data — the same shape the shape
 * panel writes and the AI will write later — so importing one is an ordinary
 * Storage write with no template-specific rendering path.
 *
 * Node IDs are namespaced by template (`microservices-gateway`) rather than
 * generated: an import *replaces* the canvas, so two templates can never be on
 * it at once, and a stable ID keeps the preview keys deterministic. They cannot
 * collide with a user-created node either — `createNodeId` appends a UUID.
 */

export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Positions are the node's top-left corner in flow units, matching React Flow's
 * own `position`. Sizes come from `NODE_DEFAULT_SIZES` so a template node is
 * indistinguishable from a dropped one.
 */
function node(
  id: string,
  label: string,
  shape: NodeShape,
  color: NodeColor,
  x: number,
  y: number
): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y },
    ...NODE_DEFAULT_SIZES[shape],
    data: { label, color, shape },
  };
}

/** Carries the same type, stroke and arrowhead a hand-drawn connection gets. */
function edge(source: string, target: string, label = ""): CanvasEdge {
  return {
    id: `${source}--${target}`,
    source,
    target,
    type: CANVAS_EDGE_TYPE,
    data: { label },
    style: CANVAS_EDGE_STYLE,
    markerEnd: CANVAS_EDGE_MARKER,
  };
}

const microservices: CanvasTemplate = {
  id: "microservices",
  name: "Microservices",
  description:
    "An API gateway fronting three services, each owning its own datastore.",
  nodes: [
    node("microservices-client", "Web client", "circle", "blue", 0, 40),
    node("microservices-gateway", "API gateway", "hexagon", "teal", 240, 57),
    node("microservices-auth", "Auth service", "pill", "purple", 520, -60),
    node("microservices-orders", "Order service", "pill", "orange", 520, 80),
    node("microservices-catalog", "Catalog service", "pill", "green", 520, 220),
    node("microservices-orders-db", "Orders DB", "cylinder", "neutral", 800, 58),
    node(
      "microservices-catalog-db",
      "Catalog DB",
      "cylinder",
      "neutral",
      800,
      198
    ),
  ],
  edges: [
    edge("microservices-client", "microservices-gateway", "HTTPS"),
    edge("microservices-gateway", "microservices-auth", "verify"),
    edge("microservices-gateway", "microservices-orders"),
    edge("microservices-gateway", "microservices-catalog"),
    edge("microservices-orders", "microservices-orders-db"),
    edge("microservices-catalog", "microservices-catalog-db"),
  ],
};

const cicdPipeline: CanvasTemplate = {
  id: "cicd-pipeline",
  name: "CI/CD pipeline",
  description:
    "Commit to production, with a test gate that branches to rollback on failure.",
  nodes: [
    node("cicd-commit", "Commit", "circle", "blue", 0, 30),
    node("cicd-build", "Build", "pill", "teal", 220, 67),
    node("cicd-artifacts", "Artifact store", "cylinder", "neutral", 210, 230),
    node("cicd-test", "Test suite", "rectangle", "green", 470, 55),
    node("cicd-gate", "Tests pass?", "diamond", "orange", 720, 30),
    node("cicd-staging", "Staging", "rectangle", "purple", 990, -50),
    node("cicd-rollback", "Rollback", "rectangle", "red", 990, 160),
    node("cicd-production", "Production", "rectangle", "teal", 1250, -50),
  ],
  edges: [
    edge("cicd-commit", "cicd-build"),
    edge("cicd-build", "cicd-artifacts", "store"),
    edge("cicd-build", "cicd-test"),
    edge("cicd-test", "cicd-gate"),
    edge("cicd-gate", "cicd-staging", "pass"),
    edge("cicd-gate", "cicd-rollback", "fail"),
    edge("cicd-staging", "cicd-production", "promote"),
  ],
};

const eventDriven: CanvasTemplate = {
  id: "event-driven",
  name: "Event-driven system",
  description:
    "A publisher fanning out through an event bus to independent consumers.",
  nodes: [
    node("events-orders", "Order service", "pill", "blue", 0, 100),
    node("events-bus", "Event bus", "hexagon", "purple", 260, 90),
    node("events-log", "Event log", "cylinder", "teal", 270, 260),
    node("events-notifications", "Notifications", "pill", "orange", 540, -40),
    node("events-analytics", "Analytics", "pill", "green", 540, 100),
    node("events-audit", "Audit trail", "pill", "pink", 540, 240),
    node("events-dlq", "Dead letters", "cylinder", "red", 530, 370),
    node("events-warehouse", "Warehouse", "cylinder", "neutral", 810, 78),
  ],
  edges: [
    edge("events-orders", "events-bus", "publish"),
    edge("events-bus", "events-log", "persist"),
    edge("events-bus", "events-notifications", "subscribe"),
    edge("events-bus", "events-analytics", "subscribe"),
    edge("events-bus", "events-audit", "subscribe"),
    edge("events-bus", "events-dlq", "failed"),
    edge("events-analytics", "events-warehouse"),
  ],
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  microservices,
  cicdPipeline,
  eventDriven,
];

export interface NodeBox extends NodeSize {
  x: number;
  y: number;
}

/**
 * A node's box in flow units. React Flow leaves `width`/`height` optional — it
 * fills them in once it has measured the node — so the default size for the
 * shape is the fallback, the same one the node renderer uses on first paint.
 */
export function getNodeBox(target: CanvasNode): NodeBox {
  const fallback = NODE_DEFAULT_SIZES[target.data.shape];

  return {
    x: target.position.x,
    y: target.position.y,
    width: target.width ?? fallback.width,
    height: target.height ?? fallback.height,
  };
}

/**
 * The bounding box of a whole template, used to fit a preview into a fixed
 * viewport. An empty template collapses to a zero box rather than the
 * `Infinity` a bare `Math.min` over nothing would produce — a `NaN` viewBox
 * renders as an empty preview with no error.
 */
export function getTemplateBounds(nodes: CanvasNode[]): NodeBox {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const boxes = nodes.map(getNodeBox);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}
