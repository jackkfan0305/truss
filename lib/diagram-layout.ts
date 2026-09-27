import ELK, { type ElkNode, type ElkExtendedEdge, type ElkLabel } from "elkjs/lib/elk.bundled.js";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { nearestNodeSide, type EdgeSide } from "@/lib/canvas-edge-route";
import {
  DIAGRAM_LABEL_WIDTH, DIAGRAM_LABEL_LINE_HEIGHT, DIAGRAM_LABEL_PADDING,
  diagramGeometryKey, type DiagramEdgeLayout, type DiagramPoint,
} from "@/lib/diagram-route";
import { CANVAS_EDGE_MARKER, NODE_DEFAULT_SIZES, type CanvasNode, type CanvasEdge } from "@/types/canvas";

const NODE_TEXT_CHARACTER_WIDTH = 8;
const NODE_HORIZONTAL_PADDING = 48;
const NODE_LINE_HEIGHT = 20;
const EDGE_TEXT_CHARACTER_WIDTH = 8;
const MAX_NODE_WIDTH = 320;

/**
 * Conservative text bounds keep labels readable without browser measurement.
 *
 * The shape's default size is a floor, not a fallback: a generated node carries
 * whatever size the model emitted, and the prompt now asks for zeroes, which
 * `parseDesignPlan` clamps up to the tiny resize minimum. Only nodes being laid
 * out reach here, so an existing block a person deliberately shrank is never
 * grown by this.
 */
function nodeSize(node: CanvasNode): { width: number; height: number } {
  const fallback = NODE_DEFAULT_SIZES[node.data.shape];
  const textWidth = Math.max(...node.data.label.split("\n").map((line) => line.length * NODE_TEXT_CHARACTER_WIDTH), 0);
  const shapePadding = node.data.shape === "diamond" || node.data.shape === "circle" ? 2 : 1;
  const width = Math.ceil(Math.max(fallback.width, node.width ?? 0,
    Math.min(MAX_NODE_WIDTH, textWidth * shapePadding + NODE_HORIZONTAL_PADDING)));
  const usableWidth = (width - NODE_HORIZONTAL_PADDING) / shapePadding;
  const lines = node.data.label.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length * NODE_TEXT_CHARACTER_WIDTH / usableWidth)), 0);
  const height = Math.ceil(Math.max(fallback.height, node.height ?? 0, lines * NODE_LINE_HEIGHT * shapePadding + 32));
  return node.data.shape === "circle" ? { width: Math.max(width, height), height: Math.max(width, height) } : { width, height };
}

function edgeLabels(edge: CanvasEdge): ElkLabel[] {
  const text = edge.data?.label ?? "";
  if (!text) return [];
  const capacity = Math.floor((DIAGRAM_LABEL_WIDTH - DIAGRAM_LABEL_PADDING * 2) / EDGE_TEXT_CHARACTER_WIDTH);
  // A word can wrap before filling a line. Count whole words using the same width bound.
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    if (used && used + word.length + 1 > capacity) { lines++; used = 0; }
    const length = word.length + (used ? 1 : 0);
    lines += Math.max(0, Math.ceil((used + length) / capacity) - 1);
    used = ((used + length - 1) % capacity) + 1;
  }
  return [{ id: `label:${edge.id}`, text, width: DIAGRAM_LABEL_WIDTH,
    height: lines * DIAGRAM_LABEL_LINE_HEIGHT + DIAGRAM_LABEL_PADDING,
    layoutOptions: { "elk.edgeLabels.placement": "CENTER" } }];
}

/**
 * The arrowhead is centred on the path's last point, so half of it lands under
 * the block. Stopping short by its half-width draws the whole head in the open.
 */
const ARROW_CLEARANCE = (CANVAS_EDGE_MARKER.width ?? 16) / 2;

/** Drops repeated points and the middle of any three that run in one line. */
function simplify(points: DiagramPoint[]): DiagramPoint[] {
  const result: DiagramPoint[] = [];

  for (const point of points) {
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const previous = result[result.length - 2];
    if (previous && last
      && ((previous.x === last.x && last.x === point.x) || (previous.y === last.y && last.y === point.y))) {
      result.pop();
    }
    result.push(point);
  }

  return result;
}

/** Backs the arriving end off its block so the whole arrowhead is visible. */
function clearArrowhead(points: DiagramPoint[]): DiagramPoint[] {
  const end = points[points.length - 1];
  const previous = points[points.length - 2];
  const run = Math.hypot(end.x - previous.x, end.y - previous.y);
  if (run <= ARROW_CLEARANCE) return points;
  const scale = (run - ARROW_CLEARANCE) / run;

  return [...points.slice(0, -1), {
    x: Math.round(previous.x + (end.x - previous.x) * scale),
    y: Math.round(previous.y + (end.y - previous.y) * scale),
  }];
}

function compareIds(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.randomSeed": "1",
  "elk.padding": "[top=40,left=40,bottom=40,right=40]",
  "elk.spacing.nodeNode": "64",
  "elk.spacing.edgeNode": "28",
  "elk.spacing.edgeEdge": "24",
  "elk.spacing.labelNode": "24",
  "elk.layered.spacing.nodeNodeBetweenLayers": "100",
  "elk.layered.spacing.edgeNodeBetweenLayers": "32",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "24",
  "elk.layered.edgeLabels.inline": "true",
  "elk.separateConnectedComponents": "true",
  "elk.spacing.componentComponent": "80",
};

const PORT_SIDES: Record<EdgeSide, string> = {
  top: "NORTH",
  right: "EAST",
  bottom: "SOUTH",
  left: "WEST",
};

function portId(nodeId: string, side: EdgeSide): string {
  return `${nodeId}\u0000${side}`;
}

/** Where a block's handle sits relative to its own top-left corner. */
function portOffset(size: { width: number; height: number }, side: EdgeSide): { x: number; y: number } {
  switch (side) {
    case "left": return { x: 0, y: size.height / 2 };
    case "right": return { x: size.width, y: size.height / 2 };
    case "top": return { x: size.width / 2, y: 0 };
    case "bottom": return { x: size.width / 2, y: size.height };
  }
}

function elkSection(edge: { sections?: { startPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[]; endPoint: { x: number; y: number } }[] }) {
  const section = edge.sections?.[0];
  if (!section) throw new Error("Diagram layout did not route every connection");
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
}

/** Which block side each end of each edge came out of, from a routed graph. */
function chooseSides(
  laidOut: ElkNode,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
): Map<string, { source: EdgeSide; target: EdgeSide }> {
  const boxes = new Map((laidOut.children ?? []).map((child) => [child.id, {
    position: { x: child.x ?? 0, y: child.y ?? 0 },
    ...(sizes.get(child.id) ?? { width: 0, height: 0 }),
  }]));
  const sideAt = (nodeId: string, point: { x: number; y: number }): EdgeSide => {
    const box = boxes.get(nodeId)!;
    return nearestNodeSide(
      { position: box.position, width: box.width, height: box.height, data: { shape: "rectangle" } } as CanvasNode,
      point,
    );
  };

  return new Map((laidOut.edges ?? []).map((edge) => {
    const points = elkSection(edge);
    return [edge.id, {
      source: sideAt(edge.sources[0], points[0]),
      target: sideAt(edge.targets[0], points[points.length - 1]),
    }];
  }));
}

function buildGraph(
  rootId: string,
  snapshot: CanvasSnapshot,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  sides: ReadonlyMap<string, { source: EdgeSide; target: EdgeSide }> | null,
): ElkNode {
  const used = new Map<string, Set<EdgeSide>>();
  if (sides) {
    for (const edge of snapshot.edges) {
      const chosen = sides.get(edge.id);
      if (!chosen) continue;
      (used.get(edge.source) ?? used.set(edge.source, new Set()).get(edge.source)!).add(chosen.source);
      (used.get(edge.target) ?? used.set(edge.target, new Set()).get(edge.target)!).add(chosen.target);
    }
  }

  return {
    id: rootId,
    layoutOptions: LAYOUT_OPTIONS,
    children: [...snapshot.nodes].sort(compareIds).map((node) => {
      const size = sizes.get(node.id)!;
      const ports = [...(used.get(node.id) ?? [])].sort();
      if (!ports.length) return { id: node.id, ...size };
      return {
        id: node.id,
        ...size,
        layoutOptions: { "elk.portConstraints": "FIXED_POS" },
        ports: ports.map((side) => ({
          id: portId(node.id, side),
          width: 0,
          height: 0,
          layoutOptions: { "elk.port.side": PORT_SIDES[side] },
          ...portOffset(size, side),
        })),
      };
    }),
    edges: [...snapshot.edges].sort(compareIds).map((edge): ElkExtendedEdge => {
      const chosen = sides?.get(edge.id);
      return {
        id: edge.id,
        sources: [chosen ? portId(edge.source, chosen.source) : edge.source],
        targets: [chosen ? portId(edge.target, chosen.target) : edge.target],
        labels: edgeLabels(edge),
      };
    }),
  };
}

/**
 * Only server-side generation imports ELK. The canvas reads the saved geometry.
 *
 * Laid out twice on purpose. ELK left to itself meets a block wherever the
 * routing found room, which is never one of the four points the block offers on
 * hover. The first pass decides which side each end belongs on; the second
 * pins those sides to the handles themselves as fixed ports, so ELK routes
 * around its obstacles knowing where every line has to land.
 */
export async function layoutDiagram(snapshot: CanvasSnapshot): Promise<CanvasSnapshot> {
  if (!snapshot.nodes.length) return { nodes: [], edges: [] };
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  let rootId = "diagram-root";
  while (ids.has(rootId)) rootId += "-root";
  const sizes = new Map(snapshot.nodes.map((node) => [node.id, nodeSize(node)]));
  const elk = new ELK();
  const firstPass = await elk.layout(buildGraph(rootId, snapshot, sizes, null));
  const laidOut = await elk.layout(
    buildGraph(rootId, snapshot, sizes, chooseSides(firstPass, sizes)),
  );

  const byNodeId = new Map(laidOut.children?.map((node) => [node.id, node]));
  const nodes = snapshot.nodes.map((node): CanvasNode => {
    const positioned = byNodeId.get(node.id);
    if (!positioned || positioned.x === undefined || positioned.y === undefined) throw new Error("Diagram layout did not position every block");
    return { ...node, position: { x: Math.round(positioned.x), y: Math.round(positioned.y) }, width: positioned.width, height: positioned.height };
  });
  const geometryKey = diagramGeometryKey(nodes);
  const byEdgeId = new Map(laidOut.edges?.map((edge) => [edge.id, edge]));
  const edges = snapshot.edges.map((edge): CanvasEdge => {
    const routed = byEdgeId.get(edge.id);
    if (!routed) throw new Error("Diagram layout did not route every connection");
    const label = routed.labels?.[0];
    const points = clearArrowhead(simplify(
      elkSection(routed).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })),
    ));
    const layout: DiagramEdgeLayout = {
      version: 1,
      points,
      label: label && label.x !== undefined && label.y !== undefined && label.width !== undefined && label.height !== undefined
        ? { x: label.x + label.width / 2, y: label.y + label.height / 2, width: label.width, height: label.height } : null,
      geometryKey, source: edge.source, target: edge.target, text: edge.data?.label ?? "",
    };
    return { ...edge, data: { ...edge.data, label: edge.data?.label ?? "", layout } };
  });
  return { nodes, edges };
}
