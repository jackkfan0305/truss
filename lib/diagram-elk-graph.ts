/**
 * Compound ELK graph construction for the shared diagram layout.
 *
 * Boundaries become ELK compound nodes (children nested by `parentId`), edges
 * are declared at the root and assigned to their lowest common ancestor by ELK
 * (`INCLUDE_CHILDREN`). Flat diagrams produce exactly the graph the layout used
 * before nesting existed.
 */

import type { ElkNode, ElkExtendedEdge, ElkLabel } from "elkjs/lib/elk.bundled.js";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { EdgeSide } from "@/lib/canvas-edge-route";
import {
  DIAGRAM_LABEL_WIDTH, DIAGRAM_LABEL_LINE_HEIGHT, DIAGRAM_LABEL_PADDING, type DiagramPoint,
} from "@/lib/diagram-route";
import {
  BOUNDARY_PADDING, BOUNDARY_TITLE_HEIGHT, NODE_DEFAULT_SIZES,
  type CanvasEdge, type CanvasNode,
} from "@/types/canvas";

export interface DiagramLayoutSize { width: number; height: number }
export interface DiagramEdgeSides { source: EdgeSide; target: EdgeSide }
export interface DiagramRootPadding { top: number; left: number; bottom: number; right: number }

const NODE_TEXT_CHARACTER_WIDTH = 8;
const NODE_HORIZONTAL_PADDING = 48;
const NODE_LINE_HEIGHT = 20;
const EDGE_TEXT_CHARACTER_WIDTH = 8;
const MAX_NODE_WIDTH = 320;
const EMPTY_BOUNDARY_SIZE = { width: 400, height: 240 };

export const DEFAULT_ROOT_PADDING: DiagramRootPadding = { top: 40, left: 40, bottom: 40, right: 40 };

export const BOUNDARY_PADDING_BOX: DiagramRootPadding = {
  top: BOUNDARY_TITLE_HEIGHT, left: BOUNDARY_PADDING, bottom: BOUNDARY_PADDING, right: BOUNDARY_PADDING,
};

const isBoundary = (node: CanvasNode): boolean => node.type === "canvasBoundary";

/**
 * Conservative text bounds keep labels readable without browser measurement.
 *
 * The shape's default size is a floor, not a fallback: a generated node carries
 * whatever size the model emitted, and the prompt now asks for zeroes, which
 * `parseDesignPlan` clamps up to the tiny resize minimum. Only nodes being laid
 * out reach here, so an existing block a person deliberately shrank is never
 * grown by this.
 */
export function nodeSize(node: CanvasNode): DiagramLayoutSize {
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

/**
 * A boundary's size is a floor ELK grows from its children. The title never
 * wraps, so its width is part of the floor; an empty boundary keeps its own size.
 */
export function boundaryMinimumSize(node: CanvasNode, hasChildren: boolean): DiagramLayoutSize {
  const title = Math.ceil(node.data.label.length * NODE_TEXT_CHARACTER_WIDTH + NODE_HORIZONTAL_PADDING);
  if (!hasChildren) {
    return { width: Math.max(node.width ?? EMPTY_BOUNDARY_SIZE.width, title), height: node.height ?? EMPTY_BOUNDARY_SIZE.height };
  }
  return { width: title, height: BOUNDARY_TITLE_HEIGHT + BOUNDARY_PADDING + 40 };
}

export function diagramLayoutSizes(snapshot: CanvasSnapshot): Map<string, DiagramLayoutSize> {
  const parents = new Set(snapshot.nodes.map((node) => node.parentId).filter((id): id is string => !!id));
  return new Map(snapshot.nodes.map((node) => [node.id,
    isBoundary(node) ? boundaryMinimumSize(node, parents.has(node.id)) : nodeSize(node)]));
}

export function edgeLabels(edge: CanvasEdge): ElkLabel[] {
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
  // Short text gets a pill that fits it; render reads this same width.
  const width = Math.min(DIAGRAM_LABEL_WIDTH, text.length * EDGE_TEXT_CHARACTER_WIDTH + DIAGRAM_LABEL_PADDING * 2);
  return [{ id: `label:${edge.id}`, text, width,
    height: lines * DIAGRAM_LABEL_LINE_HEIGHT + DIAGRAM_LABEL_PADDING,
    layoutOptions: { "elk.edgeLabels.placement": "CENTER" } }];
}

const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.randomSeed": "1",
  "elk.spacing.nodeNode": "64",
  "elk.spacing.edgeNode": "28",
  "elk.spacing.edgeEdge": "24",
  "elk.spacing.labelNode": "24",
  "elk.layered.spacing.nodeNodeBetweenLayers": "100",
  "elk.layered.spacing.edgeNodeBetweenLayers": "32",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "24",
  "elk.layered.edgeLabels.inline": "true",
  "elk.spacing.componentComponent": "80",
};

const PORT_SIDES: Record<EdgeSide, string> = { top: "NORTH", right: "EAST", bottom: "SOUTH", left: "WEST" };

export function diagramPortId(nodeId: string, side: EdgeSide): string {
  return `${nodeId}\u0000${side}`;
}

/** Where a block's handle sits relative to its own top-left corner. */
function portOffset(size: DiagramLayoutSize, side: EdgeSide): DiagramPoint {
  switch (side) {
    case "left": return { x: 0, y: size.height / 2 };
    case "right": return { x: size.width, y: size.height / 2 };
    case "top": return { x: size.width / 2, y: 0 };
    case "bottom": return { x: size.width / 2, y: size.height };
  }
}

const compareIds = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const pad = (p: DiagramRootPadding): string => `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`;

/**
 * Build the ELK graph for a snapshot. Boundaries are compound nodes with room
 * for their title; ports pin edges to the four handles of non-compound blocks.
 */
export function buildDiagramElkGraph(
  rootId: string,
  snapshot: CanvasSnapshot,
  sizes: ReadonlyMap<string, DiagramLayoutSize>,
  sides: ReadonlyMap<string, DiagramEdgeSides> | null,
  rootPadding: DiagramRootPadding = DEFAULT_ROOT_PADDING,
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

  const ids = new Set(snapshot.nodes.map((node) => node.id));
  const childrenOf = new Map<string | null, CanvasNode[]>();
  for (const node of snapshot.nodes) {
    // A parent outside the snapshot (a partial subtree) makes the node a root here.
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    (childrenOf.get(key) ?? childrenOf.set(key, []).get(key)!).push(node);
  }
  const compound = new Set(snapshot.nodes.filter((node) => childrenOf.has(node.id)).map((node) => node.id));
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));

  const build = (node: CanvasNode, depth: number): ElkNode => {
    const size = sizes.get(node.id)!;
    if (compound.has(node.id) || isBoundary(node)) {
      return {
        id: node.id, ...size,
        layoutOptions: {
          "elk.padding": pad(BOUNDARY_PADDING_BOX),
          "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
          "elk.nodeSize.minimum": `(${size.width},${size.height})`,
        },
        children: [...(childrenOf.get(node.id) ?? [])].sort(compareIds).map((child) => build(child, depth + 1)),
      };
    }
    const ports = [...(used.get(node.id) ?? [])].sort();
    if (!ports.length) return { id: node.id, ...size };
    return {
      id: node.id, ...size,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: ports.map((side) => ({
        id: diagramPortId(node.id, side), width: 0, height: 0,
        layoutOptions: { "elk.port.side": PORT_SIDES[side] },
        ...portOffset(size, side),
      })),
    };
  };

  const nested = snapshot.nodes.some((node) => node.parentId);
  return {
    id: rootId,
    layoutOptions: {
      ...LAYOUT_OPTIONS,
      "elk.padding": pad(rootPadding),
      "elk.separateConnectedComponents": nested ? "false" : "true",
      ...(nested ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : {}),
    },
    children: [...(childrenOf.get(null) ?? [])].sort(compareIds).map((node) => build(node, 0)),
    edges: [...snapshot.edges].sort(compareIds).map((edge): ElkExtendedEdge => {
      const chosen = sides?.get(edge.id);
      const portable = (id: string) => !compound.has(id) && !(byId.get(id) && isBoundary(byId.get(id)!));
      return {
        id: edge.id,
        sources: [chosen && portable(edge.source) ? diagramPortId(edge.source, chosen.source) : edge.source],
        targets: [chosen && portable(edge.target) ? diagramPortId(edge.target, chosen.target) : edge.target],
        labels: edgeLabels(edge),
      };
    }),
  };
}

/**
 * Index a laid-out graph. Node origins are canvas-absolute top-left corners
 * (the root's is 0,0). ELK reports an edge relative to the lowest common
 * ancestor of its ends, wherever the edge sits in the JSON, so each edge's
 * origin is that ancestor's.
 */
export function flattenDiagramElkGraph(root: ElkNode): {
  nodes: Map<string, { node: ElkNode; origin: DiagramPoint }>;
  edges: Map<string, { edge: ElkExtendedEdge; origin: DiagramPoint }>;
} {
  const nodes = new Map<string, { node: ElkNode; origin: DiagramPoint }>();
  const parents = new Map<string, string>();
  const owners = new Map<string, string>();
  const found: ElkExtendedEdge[] = [];
  const visit = (node: ElkNode, origin: DiagramPoint): void => {
    nodes.set(node.id, { node, origin });
    for (const port of node.ports ?? []) owners.set(port.id, node.id);
    found.push(...(node.edges ?? []));
    for (const child of node.children ?? []) {
      parents.set(child.id, node.id);
      visit(child, { x: origin.x + (child.x ?? 0), y: origin.y + (child.y ?? 0) });
    }
  };
  visit(root, { x: 0, y: 0 });

  const ancestors = (id: string): string[] => {
    const chain: string[] = [];
    for (let parent = parents.get(id); parent !== undefined; parent = parents.get(parent)) chain.push(parent);
    return chain;
  };
  const edges = new Map<string, { edge: ElkExtendedEdge; origin: DiagramPoint }>();
  for (const edge of found) {
    const source = owners.get(edge.sources[0]) ?? edge.sources[0];
    const target = owners.get(edge.targets[0]) ?? edge.targets[0];
    const targetChain = new Set(ancestors(target));
    const container = ancestors(source).find((id) => targetChain.has(id)) ?? root.id;
    edges.set(edge.id, { edge, origin: nodes.get(container)!.origin });
  }
  return { nodes, edges };
}

/**
 * Join every section of an edge, source to target, into one canvas-absolute
 * polyline. Sections chain by ELK's incoming/outgoing ids, falling back to
 * point continuity; a disconnected or branching set is an error rather than a
 * silently truncated route.
 */
export function assembleDiagramElkRoute(edge: ElkExtendedEdge, origin: DiagramPoint): DiagramPoint[] {
  const sections = edge.sections ?? [];
  if (!sections.length) throw new Error(`Diagram layout did not route connection ${edge.id}`);

  const same = (a: DiagramPoint, b: DiagramPoint) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  const next = (current: (typeof sections)[number], remaining: typeof sections) => {
    const byId = remaining.filter((candidate) => current.outgoingSections?.includes(candidate.id));
    const found = byId.length ? byId : remaining.filter((candidate) => same(candidate.startPoint, current.endPoint));
    if (found.length > 1) throw new Error(`Connection ${edge.id} has branching sections`);
    return found[0];
  };

  const heads = sections.filter((section) => !section.incomingSections?.length
    && !sections.some((other) => other !== section && same(other.endPoint, section.startPoint)));
  if (heads.length !== 1) throw new Error(`Connection ${edge.id} has ambiguous sections`);

  const ordered = [heads[0]];
  let remaining = sections.filter((section) => section !== heads[0]);
  while (remaining.length) {
    const following = next(ordered[ordered.length - 1], remaining);
    if (!following) throw new Error(`Connection ${edge.id} has disconnected sections`);
    ordered.push(following);
    remaining = remaining.filter((section) => section !== following);
  }

  const moved = (point: DiagramPoint): DiagramPoint => ({ x: origin.x + point.x, y: origin.y + point.y });
  return ordered.flatMap((section) => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(moved));
}
