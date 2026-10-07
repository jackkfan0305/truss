/**
 * Affected-content layout for nested diagrams.
 *
 * ELK has no routing-only mode: bundled elkjs moves fixed nodes (see
 * `scripts/verify-elk-compound-capability.ts`). So an edit re-lays out only the
 * innermost boundary containing changed content, treating that boundary's
 * subtree as the layout root. Everything outside it keeps exact positions;
 * ancestors grow to fit and fail with `DiagramLayoutError` if growth would
 * collide with a sibling. Connections inside the re-laid boundary are routed by
 * ELK; connections that leave it get a simple route against the final geometry
 * and may overlap fixed blocks (the accepted relaxation).
 */

import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { diagramGeometryKey, parseDiagramEdgeLayout, type DiagramEdgeLayout, type DiagramLabel, type DiagramPoint } from "@/lib/diagram-route";
import { layoutDiagram } from "@/lib/diagram-layout";
import { edgeLabels, BOUNDARY_PADDING_BOX } from "@/lib/diagram-elk-graph";
import {
  DiagramLayoutError, deriveDiagramGeometry, validateDiagramGeometry,
  type DiagramBounds, type DiagramGeometryIssue,
} from "@/lib/diagram-geometry";
import { BOUNDARY_PADDING, CANVAS_EDGE_MARKER, type CanvasEdge, type CanvasNode } from "@/types/canvas";

export interface DiagramContentsLayoutOptions {
  previous: CanvasSnapshot;
  changedNodeIds: ReadonlySet<string>;
  changedEdgeIds: ReadonlySet<string>;
  opaqueNodeIds: ReadonlySet<string>;
  /** Nodes whose coordinates the caller chose; they are validated, never moved. */
  pinnedNodeIds?: ReadonlySet<string>;
}

const NODE_GAP = 64;
const ADDITION_GAP = 240;
const ARROW_CLEARANCE = (CANVAS_EDGE_MARKER.width ?? 16) / 2;
const ROUTE_CODES = new Set<DiagramGeometryIssue["code"]>(["routeCollision", "titleCollision", "labelCollision"]);

interface Route { points: DiagramPoint[]; label: DiagramLabel | null }

const sameBounds = (a: DiagramBounds | undefined, b: DiagramBounds | undefined): boolean =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function simplifyPoints(points: DiagramPoint[]): DiagramPoint[] {
  const result: DiagramPoint[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = result[result.length - 2];
    if (before && last && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) result.pop();
    result.push(point);
  }
  return result;
}

const crosses = (p: DiagramPoint, q: DiagramPoint, r: DiagramBounds): boolean =>
  Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.width
  && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.height;

/**
 * Three-segment orthogonal route between the facing handles of two blocks. It
 * tries a few corridors and takes the first clear of every block it may not
 * cross; when none is clear it keeps the middle one.
 */
function simpleRoute(edge: CanvasEdge, nodes: ReadonlyMap<string, CanvasNode>, bounds: ReadonlyMap<string, DiagramBounds>): Route | null {
  const a = bounds.get(edge.source);
  const b = bounds.get(edge.target);
  if (!a || !b) return null;

  const allowed = new Set([edge.source, edge.target]);
  for (const end of [edge.source, edge.target]) {
    for (let parent = nodes.get(end)?.parentId; parent && !allowed.has(parent); parent = nodes.get(parent)?.parentId) allowed.add(parent);
  }
  const blocked = [...nodes.values()].filter((node) => {
    if (allowed.has(node.id)) return false;
    for (let parent = node.parentId; parent; parent = nodes.get(parent)?.parentId) {
      if (parent === edge.source || parent === edge.target) return false;
    }
    return true;
  }).map((node) => bounds.get(node.id)!);

  const horizontal = a.x + a.width <= b.x || b.x + b.width <= a.x || !(a.y + a.height <= b.y || b.y + b.height <= a.y);
  const candidates: DiagramPoint[][] = [];
  const clear = (end: DiagramPoint, start: DiagramPoint): DiagramPoint => {
    const run = Math.hypot(end.x - start.x, end.y - start.y);
    return run <= ARROW_CLEARANCE ? end : {
      x: Math.round(end.x + (start.x - end.x) * ARROW_CLEARANCE / run), y: Math.round(end.y + (start.y - end.y) * ARROW_CLEARANCE / run),
    };
  };

  if (horizontal) {
    const forward = b.x >= a.x;
    const sx = forward ? a.x + a.width : a.x;
    const tx = forward ? b.x : b.x + b.width;
    const sy = Math.round(a.y + a.height / 2);
    const ty = Math.round(b.y + b.height / 2);
    const mid = Math.round((sx + tx) / 2);
    for (const shift of [0, 40, -40, 80, -80, 160, -160]) {
      const mx = mid + shift;
      candidates.push(simplifyPoints([{ x: sx, y: sy }, { x: mx, y: sy }, { x: mx, y: ty }, { x: tx, y: ty }]));
    }
  } else {
    const down = b.y >= a.y;
    const sy = down ? a.y + a.height : a.y;
    const ty = down ? b.y : b.y + b.height;
    const sx = Math.round(a.x + a.width / 2);
    const tx = Math.round(b.x + b.width / 2);
    const mid = Math.round((sy + ty) / 2);
    for (const shift of [0, 40, -40, 80, -80, 160, -160]) {
      const my = mid + shift;
      candidates.push(simplifyPoints([{ x: sx, y: sy }, { x: sx, y: my }, { x: tx, y: my }, { x: tx, y: ty }]));
    }
  }

  const clearOf = (points: DiagramPoint[]) => !blocked.some((rect) => points.some((p, i) => i > 0 && crosses(points[i - 1], p, rect)));
  const chosen = candidates.find(clearOf) ?? candidates[0];
  const points = chosen.length < 2 ? chosen : [...chosen.slice(0, -1), clear(chosen[chosen.length - 1], chosen[chosen.length - 2])];

  const text = edge.data?.label ?? "";
  const spec = text ? edgeLabels(edge)[0] : undefined;
  let label: DiagramLabel | null = null;
  if (spec?.width !== undefined && spec.height !== undefined) {
    let best = 0;
    let at = 0;
    for (let i = 1; i < points.length; i++) {
      const length = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
      if (length >= best) { best = length; at = i; }
    }
    label = {
      x: (points[at - 1].x + points[at].x) / 2, y: (points[at - 1].y + points[at].y) / 2,
      width: spec.width, height: spec.height,
    };
  }
  return { points, label };
}

/**
 * Lay out a desired snapshot while preserving everything outside the boundary
 * that holds the change. See the module comment for the contract.
 */
export async function layoutDiagramContents(
  desired: CanvasSnapshot,
  options: DiagramContentsLayoutOptions,
): Promise<CanvasSnapshot> {
  const { previous, opaqueNodeIds: opaque } = options;
  const pinned = options.pinnedNodeIds ?? new Set<string>();
  const prevById = new Map(previous.nodes.map((node) => [node.id, node]));
  const nodes = new Map<string, CanvasNode>(desired.nodes.map((node) => [node.id, node]));

  // Opaque items are preserved byte for byte, whatever the candidate says.
  for (const id of opaque) {
    const original = prevById.get(id);
    if (original) nodes.set(id, original);
  }

  const childrenOf = (id: string | null): CanvasNode[] =>
    [...nodes.values()].filter((node) => (node.parentId ?? null) === id);
  const descendantsOf = (id: string): Set<string> => {
    const found = new Set<string>();
    const visit = (parent: string): void => {
      for (const child of childrenOf(parent)) { if (!found.has(child.id)) { found.add(child.id); visit(child.id); } }
    };
    visit(id);
    return found;
  };
  const ancestorsOf = (id: string): string[] => {
    const chain: string[] = [];
    for (let p = nodes.get(id)?.parentId; p && !chain.includes(p); p = nodes.get(p)?.parentId) chain.push(p);
    return chain;
  };

  // Which boundaries hold changed content, and which new roots need a place.
  const scopes = new Set<string>();
  const additionRoots = new Set<string>();
  for (const node of nodes.values()) {
    if (opaque.has(node.id) || pinned.has(node.id)) continue;
    const before = prevById.get(node.id);
    if (before && (before.parentId ?? null) === (node.parentId ?? null)) continue;
    if (node.parentId) scopes.add(node.parentId); else additionRoots.add(node.id);
    if (before?.parentId && nodes.has(before.parentId)) scopes.add(before.parentId);
  }
  for (const before of previous.nodes) {
    if (!nodes.has(before.id) && before.parentId && nodes.has(before.parentId)) scopes.add(before.parentId);
  }

  const additionIds = new Set<string>(additionRoots);
  for (const id of additionRoots) for (const inner of descendantsOf(id)) additionIds.add(inner);
  for (const id of [...scopes]) {
    if (additionIds.has(id) || ancestorsOf(id).some((ancestor) => scopes.has(ancestor))) scopes.delete(id);
  }
  for (const id of scopes) {
    if (opaque.has(id)) {
      throw new DiagramLayoutError(`Boundary ${id} is opaque and cannot hold new content`, [{
        code: "containment", itemIds: [id], message: `Boundary ${id} is not editable, so content cannot be added to it`,
      }]);
    }
  }

  const routed = new Map<string, Route>();
  const laidEdgeIds = new Set<string>();
  const collectRoutes = (out: CanvasSnapshot, origin: DiagramPoint): void => {
    for (const edge of out.edges) {
      const layout: DiagramEdgeLayout | null = parseDiagramEdgeLayout(edge.data?.layout);
      if (!layout) continue;
      routed.set(edge.id, {
        points: layout.points.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })),
        label: layout.label ? { ...layout.label, x: layout.label.x + origin.x, y: layout.label.y + origin.y } : null,
      });
      laidEdgeIds.add(edge.id);
    }
  };
  const subsetOf = (ids: ReadonlySet<string>, roots: ReadonlySet<string>): CanvasSnapshot => ({
    nodes: [...nodes.values()].filter((node) => ids.has(node.id)).map((node) => {
      if (!roots.has(node.id)) return node;
      const root: CanvasNode = { ...node };
      delete root.parentId;
      return root;
    }),
    edges: desired.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  });

  // Re-lay each affected boundary; its subtree is the layout root.
  for (const scopeId of [...scopes].sort()) {
    const direct = childrenOf(scopeId);
    const fixed = direct.filter((child) => opaque.has(child.id) || pinned.has(child.id));
    const fixedIds = new Set<string>();
    for (const child of fixed) { fixedIds.add(child.id); for (const inner of descendantsOf(child.id)) fixedIds.add(inner); }
    const laidIds = new Set([...descendantsOf(scopeId)].filter((id) => !fixedIds.has(id)));
    if (!laidIds.size) continue;
    const directIds = new Set(direct.filter((child) => laidIds.has(child.id)).map((child) => child.id));

    const out = await layoutDiagram(subsetOf(laidIds, directIds), { padding: BOUNDARY_PADDING_BOX });
    const shift = fixed.length
      ? Math.max(...fixed.map((child) => child.position.x + (child.width ?? 0))) + NODE_GAP - BOUNDARY_PADDING : 0;
    const scopeOrigin = deriveDiagramGeometry([...nodes.values()]).get(scopeId)!.bounds;
    for (const placed of out.nodes) {
      const original = nodes.get(placed.id)!;
      nodes.set(placed.id, {
        ...original, width: placed.width, height: placed.height,
        position: directIds.has(placed.id) ? { x: placed.position.x + shift, y: placed.position.y } : placed.position,
      });
    }
    collectRoutes(out, { x: scopeOrigin.x + shift, y: scopeOrigin.y });

    // Grow the boundary, then each ancestor, just enough to hold its children.
    for (const id of [scopeId, ...ancestorsOf(scopeId)]) {
      const holder = nodes.get(id)!;
      const kids = childrenOf(id);
      if (!kids.length) continue;
      const width = Math.max(holder.width ?? 0, ...kids.map((kid) => kid.position.x + (kid.width ?? 0)).map((right) => right + BOUNDARY_PADDING));
      const height = Math.max(holder.height ?? 0, ...kids.map((kid) => kid.position.y + (kid.height ?? 0)).map((bottom) => bottom + BOUNDARY_PADDING));
      if (width !== holder.width || height !== holder.height) nodes.set(id, { ...holder, width, height });
    }
  }

  // New roots (and reparented ones) go right of everything already placed.
  if (additionIds.size) {
    const others = [...nodes.values()].filter((node) => !node.parentId && !additionIds.has(node.id));
    const geometry = deriveDiagramGeometry([...nodes.values()]);
    const offset = others.length ? {
      x: Math.ceil(Math.max(...others.map((node) => geometry.get(node.id)!.bounds.x + geometry.get(node.id)!.bounds.width)) + ADDITION_GAP),
      y: Math.floor(Math.min(...others.map((node) => geometry.get(node.id)!.bounds.y))),
    } : { x: 0, y: 0 };
    const zero = { top: 0, left: 0, bottom: 0, right: 0 };
    const out = await layoutDiagram(subsetOf(additionIds, additionRoots), others.length ? { padding: zero } : {});
    for (const placed of out.nodes) {
      const original = nodes.get(placed.id)!;
      nodes.set(placed.id, {
        ...original, width: placed.width, height: placed.height,
        position: additionRoots.has(placed.id)
          ? { x: placed.position.x + offset.x, y: placed.position.y + offset.y } : placed.position,
      });
    }
    collectRoutes(out, offset);
  }

  // Everything else keeps its saved route when it is still valid, else gets a simple one.
  const finalNodes = desired.nodes.map((node) => nodes.get(node.id)!);
  for (const id of opaque) if (!desired.nodes.some((node) => node.id === id) && nodes.has(id)) finalNodes.push(nodes.get(id)!);
  const geometry = deriveDiagramGeometry(finalNodes);
  const bounds = new Map([...geometry].map(([id, g]) => [id, g.bounds]));
  const previousGeometry = deriveDiagramGeometry(previous.nodes);
  const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
  const key = diagramGeometryKey(finalNodes);

  const stamp = (edge: CanvasEdge, route: Route): CanvasEdge => ({
    ...edge,
    data: {
      ...edge.data,
      label: edge.data?.label ?? "",
      layout: {
        version: 1, points: route.points, label: route.label, geometryKey: key,
        source: edge.source, target: edge.target, text: edge.data?.label ?? "",
      },
    },
  });
  const routeIssues = (edge: CanvasEdge): DiagramGeometryIssue[] =>
    validateDiagramGeometry({ nodes: finalNodes, edges: [edge] }).filter((issue) => issue.itemIds.includes(edge.id));

  const edges = desired.edges.map((edge): CanvasEdge => {
    if (edge.sourceHandle || edge.targetHandle) return edge;
    const fresh = routed.get(edge.id);
    if (fresh) return stamp(edge, fresh);

    const before = previousEdges.get(edge.id);
    const saved: DiagramEdgeLayout | null = parseDiagramEdgeLayout(edge.data?.layout);
    if (before && saved && saved.source === edge.source && saved.target === edge.target
      && saved.text === (edge.data?.label ?? "")
      && sameBounds(previousGeometry.get(edge.source)?.bounds, bounds.get(edge.source))
      && sameBounds(previousGeometry.get(edge.target)?.bounds, bounds.get(edge.target))) {
      const kept = stamp(edge, { points: saved.points, label: saved.label });
      if (!routeIssues(kept).length) return kept;
    }
    const route = simpleRoute(edge, nodes, bounds);
    return route ? stamp(edge, route) : edge;
  });

  // Only connections ELK laid out are held to the route rules; a simple route may overlap.
  const issues = validateDiagramGeometry({ nodes: finalNodes, edges }).filter((issue) =>
    !(ROUTE_CODES.has(issue.code) && !laidEdgeIds.has(issue.itemIds[0])));
  if (issues.length) {
    throw new DiagramLayoutError("Diagram layout cannot fit this change without colliding with existing content", issues);
  }
  return { nodes: finalNodes, edges };
}
