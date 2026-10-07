/**
 * Task 0 gate for plan 02, and the contract it settled.
 *
 * 1. Bundled elkjs cannot route a cross-compound edge around an obstacle while
 *    every node keeps its fixed input position. Each supported option set fails
 *    that fixture; this script pins the failures so an elkjs upgrade that fixes
 *    them is noticed and the "re-lay the changed boundary" design revisited.
 * 2. The settled contract: a boundary's subtree laid out as its own ELK root has
 *    valid orthogonal routes that avoid every block that is not an endpoint.
 */
import assert from "node:assert/strict";
import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import { layoutDiagram } from "@/lib/diagram-layout";
import { validateDiagramGeometry } from "@/lib/diagram-geometry";
import { getDiagramEdgeLayout } from "@/lib/diagram-route";
import { awsNode } from "@/scripts/testing/aws-diagram-fixtures";
import { CANVAS_EDGE_TYPE, type CanvasEdge } from "@/types/canvas";

const FIXED_ROUTING_OPTIONS: Record<string, Record<string, string>> = {
  interactiveLayered: {
    "elk.algorithm": "layered",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.direction": "RIGHT",
    "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
    "elk.layered.layering.strategy": "INTERACTIVE",
    "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
    "elk.layered.nodePlacement.strategy": "SIMPLE",
  },
  noLayoutLayered: {
    "elk.algorithm": "layered",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.noLayout": "true",
  },
  fixedAlgorithm: {
    "elk.algorithm": "fixed",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.edgeRouting": "ORTHOGONAL",
  },
};

interface Rect { x: number; y: number; width: number; height: number }
const OBSTACLE: Rect = { x: 450, y: 40, width: 100, height: 160 };

function fixture(): ElkNode {
  return {
    id: "root",
    children: [
      { id: "left", x: 0, y: 0, width: 400, height: 240,
        children: [{ id: "a", x: 24, y: 64, width: 180, height: 100 }] },
      { id: "obstacle", ...OBSTACLE },
      { id: "right", x: 700, y: 0, width: 400, height: 240,
        children: [{ id: "b", x: 24, y: 64, width: 180, height: 100 }] },
    ],
    edges: [{ id: "cross", sources: ["a"], targets: ["b"] }],
  };
}

function positions(root: ElkNode): Map<string, [number, number]> {
  const found = new Map<string, [number, number]>();
  const visit = (node: ElkNode): void => {
    if (node.id !== "root") found.set(node.id, [node.x ?? 0, node.y ?? 0]);
    node.children?.forEach(visit);
  };
  visit(root);
  return found;
}

function segmentHitsRect(p: { x: number; y: number }, q: { x: number; y: number }, r: Rect): boolean {
  const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
  return maxX > r.x && minX < r.x + r.width && maxY > r.y && minY < r.y + r.height;
}

/** Returns a failure message, or null when the option set passes the gate. */
async function tryOptions(options: Record<string, string>): Promise<string | null> {
  const input = fixture();
  const before = structuredClone(positions(input));
  // ELK does not inherit the algorithm choice, so every compound carries the options.
  const apply = (node: ElkNode): void => {
    if (node.children) { node.layoutOptions = options; node.children.forEach(apply); }
  };
  apply(input);
  const graph = input;
  let output: ElkNode;
  try { output = await new ELK().layout(graph); }
  catch (error) { return `ELK threw: ${String((error as Error)?.message ?? error).slice(0, 200)}`; }
  const after = positions(output);
  for (const [id, pos] of before) {
    if (after.get(id)?.join() !== pos.join()) return `node ${id} moved from ${pos} to ${after.get(id)}`;
  }
  const edge = (output.edges as ElkExtendedEdge[] | undefined)?.find((e) => e.id === "cross");
  const sections = edge?.sections;
  if (!sections?.length) return "edge has no sections";
  // The edge belongs to the root (lowest common ancestor), so points are canvas-absolute.
  for (const s of sections) {
    const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
    for (let i = 1; i < pts.length; i++) {
      if (segmentHitsRect(pts[i - 1], pts[i], OBSTACLE)) {
        return `segment (${pts[i - 1].x},${pts[i - 1].y})->(${pts[i].x},${pts[i].y}) crosses obstacle`;
      }
    }
  }
  return null;
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, type: CANVAS_EDGE_TYPE, source, target, data: { label: "" } } as CanvasEdge;
}

(async () => {
  const known = await new ELK().knownLayoutAlgorithms();
  assert.ok(known.some((a) => a.id === "org.eclipse.elk.layered"));
  assert.ok(!known.some((a) => /route|routing/i.test(a.id ?? "")), "A routing-only ELK algorithm now exists; revisit the design");

  // 1. Fixed-geometry routing is unsupported.
  for (const [name, options] of Object.entries(FIXED_ROUTING_OPTIONS)) {
    const failure = await tryOptions(options);
    console.log(`fixed routing, ${name}: ${failure ?? "PASSED"}`);
    assert.ok(failure, `${name} now routes fixed compound geometry; the re-layout design can be relaxed`);
  }

  // 2. A boundary subtree laid out as its own root routes around its blocks.
  const child = (id: string) => awsNode(id, "aws-ec2");
  const subtree = {
    nodes: [child("a"), child("mid"), child("b"), child("c")],
    edges: [edge("direct", "a", "b"), edge("via1", "a", "mid"), edge("via2", "mid", "b"), edge("fan", "a", "c")],
  };
  const out = await layoutDiagram(subtree);
  assert.deepEqual(validateDiagramGeometry(out), [], "subtree layout must be valid");
  const bounds = new Map(out.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y, width: n.width!, height: n.height! }]));
  for (const e of out.edges) {
    const layout = getDiagramEdgeLayout(e, out.nodes);
    assert.ok(layout, `${e.id} must carry a current route`);
    for (const other of out.nodes) {
      if (other.id === e.source || other.id === e.target) continue;
      const rect = bounds.get(other.id)!;
      layout.points.slice(1).forEach((point, i) => {
        assert.ok(!segmentHitsRect(layout.points[i], point, rect), `${e.id} segment ${i} crosses ${other.id}`);
      });
    }
  }
  console.log("boundary-subtree layout: routes avoid every non-endpoint block");
  console.log("ELK compound capability gate: fixed routing unsupported as recorded; subtree contract holds");
})();
