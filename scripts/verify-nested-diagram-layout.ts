/**
 * Real-layout verification for nested diagrams: compound ELK generation, section
 * assembly, and affected-boundary edits (re-lay the changed boundary only).
 */

import assert from "node:assert/strict";
import { awsNode, nestedSnapshot } from "@/scripts/testing/aws-diagram-fixtures";
import { assembleDiagramElkRoute } from "@/lib/diagram-elk-graph";
import { layoutDiagram } from "@/lib/diagram-layout";
import { layoutDiagramContents } from "@/lib/layout-diagram-contents";
import { DiagramLayoutError, deriveDiagramGeometry, validateDiagramGeometry, type DiagramBounds } from "@/lib/diagram-geometry";
import { buildDiagramSpatialContext, invalidGeometryResponse } from "@/lib/diagram-spatial-context";
import { getDiagramEdgeLayout } from "@/lib/diagram-route";
import { resolveAgentGraphLayout } from "@/lib/agent-graph-layout";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { CANVAS_EDGE_TYPE, type CanvasEdge, type CanvasNode } from "@/types/canvas";

const edge = (id: string, source: string, target: string, label = ""): CanvasEdge =>
  ({ id, type: CANVAS_EDGE_TYPE, source, target, data: { label } }) as CanvasEdge;

const sorted = (s: CanvasSnapshot) => ({
  nodes: [...s.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)),
  edges: [...s.edges].sort((a, b) => (a.id < b.id ? -1 : 1)),
});
const boundsOf = (s: CanvasSnapshot, id: string): DiagramBounds => deriveDiagramGeometry(s.nodes).get(id)!.bounds;
const SOFT = new Set(["routeCollision", "titleCollision", "labelCollision"]);
/** Issues a generated result may never have; cross-boundary routes may overlap blocks. */
const hardIssues = (s: CanvasSnapshot) => validateDiagramGeometry(s).filter((issue) => !SOFT.has(issue.code));
const segmentsHit = (points: { x: number; y: number }[], r: DiagramBounds) => points.slice(1).some((p, i) => {
  const q = points[i];
  return Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.width && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.height;
});

async function main(): Promise<void> {
  // Generation: nested snapshot with cross-boundary edges.
  const seed = nestedSnapshot();
  seed.nodes.push(awsNode("ext", "aws-ec2"));
  seed.edges = [edge("e1", "web", "uploads", "reads"), edge("e2", "ext", "web")];
  const base = await layoutDiagram(seed);
  assert.deepEqual(validateDiagramGeometry(base), [], "generated nested layout must be valid");
  assert.equal(base.nodes.find((n) => n.id === "web")!.parentId, "public");
  assert.ok(base.edges.every((e) => getDiagramEdgeLayout(e, base.nodes)), "every route is current");
  assert.deepEqual(sorted(base), sorted(await layoutDiagram({ nodes: [...seed.nodes].reverse(), edges: [...seed.edges].reverse() })), "input order must not matter");

  // VPC + 7 services: no label pill may touch another edge's route or any block.
  const vpcServices: CanvasSnapshot = {
    nodes: [awsNode("vpc", "boundary-vpc"), ...["gw", "catalog", "orders", "queue", "images", "db", "topic"].map((id) => awsNode(id, "aws-lambda", "vpc"))],
    edges: [edge("a", "gw", "catalog", "Invoke"), edge("b", "catalog", "db", "Read/Write"), edge("c", "catalog", "queue", "Enqueue Order"),
      edge("d", "catalog", "images", "Store Image"), edge("e", "queue", "orders", "Trigger"), edge("f", "orders", "db", "Update Order"), edge("g", "orders", "topic", "Notify")],
  };
  const vpcOut = await layoutDiagram(vpcServices);
  const nodeBoxes = vpcOut.nodes.filter((n) => n.id !== "vpc").map((n) => boundsOf(vpcOut, n.id));
  for (const e of vpcOut.edges) {
    const pill = e.data!.layout!.label!;
    assert.ok(pill.width < 160 || e.data!.label!.length > 17, `${e.id} pill sized to its text`);
    const box = { x: pill.x - pill.width / 2, y: pill.y - pill.height / 2, width: pill.width, height: pill.height };
    for (const other of vpcOut.edges) if (other.id !== e.id) assert.ok(!segmentsHit(other.data!.layout!.points, box), `label of ${e.id} crossed by route ${other.id}`);
    for (const rect of nodeBoxes) assert.ok(!(box.x < rect.x + rect.width && rect.x < box.x + box.width && box.y < rect.y + rect.height && rect.y < box.y + box.height), `label of ${e.id} overlaps a block`);
  }

  // EKS cluster, disconnected root, long title.
  const eks = await layoutDiagram({
    nodes: [awsNode("cluster", "boundary-eks-cluster"), awsNode("pod-a", "aws-eks", "cluster"), awsNode("pod-b", "aws-eks", "cluster"), awsNode("solo", "aws-s3")],
    edges: [edge("p", "pod-a", "pod-b")],
  });
  assert.deepEqual(validateDiagramGeometry(eks), []);
  const longName = "An extremely long boundary title that must stay on one line in the header";
  const long = await layoutDiagram({
    nodes: [{ ...awsNode("big", "boundary-aws-cloud"), data: { ...awsNode("big", "boundary-aws-cloud").data, label: longName } }, awsNode("s", "aws-s3", "big")],
    edges: [],
  });
  assert.ok(long.nodes.find((n) => n.id === "big")!.width! >= longName.length * 8, "title width fits the title");
  assert.deepEqual(validateDiagramGeometry(long), []);

  // 40 nodes: cloud > vpc > 4 subnets x 8 services, edges across subnets.
  const big: CanvasSnapshot = { nodes: [awsNode("c", "boundary-aws-cloud"), awsNode("v", "boundary-vpc", "c")], edges: [] };
  for (let s = 0; s < 4; s++) {
    big.nodes.push(awsNode(`sn${s}`, "boundary-subnet", "v"));
    for (let i = 0; i < 8; i++) big.nodes.push(awsNode(`svc${s}-${i}`, "aws-ec2", `sn${s}`));
  }
  assert.equal(big.nodes.length, 38);
  for (let s = 0; s < 3; s++) big.edges.push(edge(`x${s}`, `svc${s}-0`, `svc${s + 1}-1`));
  const bigOut = await layoutDiagram(big);
  assert.deepEqual(validateDiagramGeometry(bigOut), []);
  assert.deepEqual(sorted(bigOut), sorted(await layoutDiagram({ nodes: [...big.nodes].reverse(), edges: [...big.edges].reverse() })));

  // Section assembly: two joined sections given in reverse order, owning origin applied once.
  const route = assembleDiagramElkRoute({
    id: "multi", sources: ["a"], targets: ["b"],
    sections: [
      { id: "s2", startPoint: { x: 10, y: 0 }, endPoint: { x: 10, y: 20 }, incomingSections: ["s1"] },
      { id: "s1", startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 }, outgoingSections: ["s2"] },
    ],
  }, { x: 100, y: 200 });
  assert.deepEqual(route, [{ x: 100, y: 200 }, { x: 110, y: 200 }, { x: 110, y: 200 }, { x: 110, y: 220 }]);
  assert.throws(() => assembleDiagramElkRoute({
    id: "split", sources: ["a"], targets: ["b"],
    sections: [{ id: "x", startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } }, { id: "y", startPoint: { x: 50, y: 50 }, endPoint: { x: 60, y: 50 } }],
  }, { x: 0, y: 0 }), /ambiguous|disconnected/);

  // Affected-boundary edits against the laid-out base.
  const none = new Set<string>();
  const edit = (desired: CanvasSnapshot, previous: CanvasSnapshot, extra: Partial<Parameters<typeof layoutDiagramContents>[1]> = {}) =>
    layoutDiagramContents(desired, { previous, changedNodeIds: none, changedEdgeIds: none, opaqueNodeIds: none, ...extra });
  const unchanged = ["private", "uploads", "ext", "vpc", "cloud"];

  // Add a stacked child to `public`: it grows and its ancestors grow, nothing else moves.
  const added = await edit({ nodes: [...base.nodes, awsNode("api", "aws-ec2", "public")], edges: base.edges }, base);
  assert.deepEqual(hardIssues(added), [], "adding a node keeps containment and sibling clearance");
  assert.deepEqual(validateDiagramGeometry(added).filter((i) => i.code === "invalidRoute"), []);
  for (const id of ["private", "uploads", "ext"]) assert.deepEqual(boundsOf(added, id), boundsOf(base, id), `${id} keeps absolute bounds`);
  for (const id of ["private", "uploads", "ext"]) assert.deepEqual(added.nodes.find((n) => n.id === id), base.nodes.find((n) => n.id === id), `${id} is untouched`);
  assert.ok(boundsOf(added, "public").height > boundsOf(base, "public").height, "public grew");
  assert.ok(added.edges.every((e) => getDiagramEdgeLayout(e, added.nodes)), "every route is current against final geometry");

  // Interior edge inside the re-laid boundary: ELK routes it and it avoids every block.
  const cache = await edit({ nodes: [...base.nodes, awsNode("cache", "aws-ec2", "private")], edges: [...base.edges, edge("u-c", "uploads", "cache")] }, base);
  assert.deepEqual(validateDiagramGeometry(cache).filter((i) => i.itemIds.includes("u-c")), [], "interior edge passes every route rule");
  const interior = getDiagramEdgeLayout(cache.edges.find((e) => e.id === "u-c")!, cache.nodes)!;
  for (const node of cache.nodes) {
    if (!["uploads", "cache"].includes(node.id)) assert.ok(!segmentsHit(interior.points, boundsOf(cache, node.id)) || ["private", "vpc", "cloud"].includes(node.id), `u-c avoids ${node.id}`);
  }
  for (const id of ["public", "web", "ext"]) assert.deepEqual(boundsOf(cache, id), boundsOf(base, id));
  assert.deepEqual(hardIssues(cache), []);

  // Edge-only addition: nothing moves, the new connection gets a route.
  const edgeOnly = await edit({ nodes: base.nodes, edges: [...base.edges, edge("e3", "uploads", "ext")] }, base);
  assert.deepEqual(edgeOnly.nodes, base.nodes);
  assert.ok(getDiagramEdgeLayout(edgeOnly.edges.find((e) => e.id === "e3")!, edgeOnly.nodes), "new connection is routed");
  assert.deepEqual(validateDiagramGeometry(edgeOnly).filter((i) => i.code === "invalidRoute"), []);

  // Reparent web into private.
  const moved = await edit({ nodes: base.nodes.map((n) => (n.id === "web" ? { ...n, parentId: "private" } : n)), edges: base.edges }, base);
  assert.deepEqual(hardIssues(moved), []);
  assert.equal(moved.nodes.find((n) => n.id === "web")!.parentId, "private");
  assert.deepEqual(boundsOf(moved, "ext"), boundsOf(base, "ext"));

  // Remove a boundary subtree.
  const removed = await edit({
    nodes: base.nodes.filter((n) => !["private", "uploads"].includes(n.id)), edges: base.edges.filter((e) => e.id === "e2"),
  }, base);
  assert.deepEqual(hardIssues(removed), []);
  assert.deepEqual(boundsOf(removed, "ext"), boundsOf(base, "ext"));

  // Opaque items stay exactly as they were and act as obstacles.
  const cloud = boundsOf(base, "cloud");
  const far: CanvasNode = { ...awsNode("legacy", "aws-s3"), position: { x: cloud.x + cloud.width + 600, y: cloud.y } };
  const withFar = { nodes: [...base.nodes, far], edges: base.edges };
  const keptOpaque = await edit({ nodes: [...base.nodes, awsNode("api", "aws-ec2", "public")], edges: base.edges }, withFar, { opaqueNodeIds: new Set(["legacy"]) });
  assert.deepEqual(keptOpaque.nodes.find((n) => n.id === "legacy"), far, "opaque node is preserved byte for byte");
  assert.deepEqual(hardIssues(keptOpaque), []);

  // Growth that would reach a sibling fails with an actionable error.
  const near: CanvasNode = { ...awsNode("legacy", "aws-s3"), position: { x: cloud.x + cloud.width + 20, y: cloud.y } };
  const wide = { nodes: [...base.nodes, awsNode("api", "aws-ec2", "private")], edges: [...base.edges, edge("w", "uploads", "api")] };
  await assert.rejects(() => edit(wide, { nodes: [...base.nodes, near], edges: base.edges }, { opaqueNodeIds: new Set(["legacy"]) }),
    (error: unknown) => error instanceof DiagramLayoutError && error.issues.length > 0);
  const collides = { nodes: [...base.nodes, awsNode("api", "aws-ec2", "public")], edges: [...base.edges, edge("w2", "web", "api")] };
  await assert.rejects(() => edit(collides, base),
    (error: unknown) => error instanceof DiagramLayoutError && error.issues.some((i) => i.itemIds.includes("public") || i.itemIds.includes("private")),
    "widening a boundary into its sibling must fail, not move the sibling");

  // Explicit coordinates are validated, never repaired.
  const overlap = { ...awsNode("pinned", "aws-ec2", "public"), position: { ...base.nodes.find((n) => n.id === "web")!.position } };
  await assert.rejects(() => edit({ nodes: [...base.nodes, overlap], edges: base.edges }, base, { pinnedNodeIds: new Set(["pinned"]) }),
    (error: unknown) => error instanceof DiagramLayoutError && error.issues.some((i) => i.itemIds.includes("pinned")));

  // A new root goes beside existing content without disturbing it.
  const root = await edit({ nodes: [...base.nodes, awsNode("fresh", "aws-s3")], edges: base.edges }, base);
  assert.deepEqual(hardIssues(root), []);
  for (const id of unchanged) assert.deepEqual(boundsOf(root, id), boundsOf(base, id));

  // Spatial projection and the recoverable layout error response.
  const spatial = buildDiagramSpatialContext(base, new Set(["ext"]), new Set(["e2"]));
  assert.equal(spatial.nodePositions, "parent-relative");
  assert.equal(spatial.routePositions, "canvas-absolute");
  assert.equal(spatial.nodes.find((n) => n.id === "ext")!.editable, false);
  assert.equal(spatial.nodes.find((n) => n.id === "web")!.editable, true);
  assert.deepEqual(spatial.nodes.find((n) => n.id === "web")!.bounds, boundsOf(base, "web"));
  assert.equal(spatial.edges.find((e) => e.id === "e2")!.editable, false);
  assert.ok(spatial.edges.every((e) => e.layout), "saved routes are projected");
  const response = invalidGeometryResponse(new DiagramLayoutError("x", [{ code: "siblingCollision", itemIds: ["a", "b"], message: "m" }]));
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.code, "invalidGeometry");
  assert.deepEqual(body.issues[0].itemIds, ["a", "b"]);

  // Detail view: entry → functions → class with methods → types, laid out left to right.
  const detail = await resolveAgentGraphLayout({
    version: 2,
    nodes: [
      { id: "checkout", kind: "code", catalogId: "code-entry", label: "checkout" },
      { id: "validate", kind: "code", catalogId: "code-function", label: "validate" },
      { id: "inventory", kind: "boundary", catalogId: "code-class", label: "Inventory" },
      { id: "ctor", kind: "code", catalogId: "code-method", label: "constructor", parentId: "inventory" },
      { id: "reserve", kind: "code", catalogId: "code-method", label: "reserve", parentId: "inventory" },
      { id: "order", kind: "code", catalogId: "code-type", label: "Order", rows: ["id: string", "items: OrderItem[]"] },
    ],
    edges: [
      { id: "a", source: "checkout", target: "validate", label: "", kind: "calls" },
      { id: "b", source: "validate", target: "reserve", label: "", kind: "calls" },
      { id: "c", source: "reserve", target: "order", label: "", kind: "uses" },
    ],
  } as never);
  assert.deepEqual(hardIssues(detail), [], "code detail layout is valid");
  const codeAbs = (id: string) => boundsOf(detail, id);
  assert.ok(codeAbs("checkout").x < codeAbs("validate").x, "entry point comes first");
  assert.ok(codeAbs("validate").x < codeAbs("inventory").x);
  assert.ok(codeAbs("inventory").x < codeAbs("order").x);
  assert.equal(detail.nodes.find((n) => n.id === "reserve")!.parentId, "inventory");

  // 80 nodes: eight classes of six methods plus 24 free functions, chained.
  const codeBig = { version: 2, nodes: [] as object[], edges: [] as object[] };
  for (let c = 0; c < 8; c += 1) {
    codeBig.nodes.push({ id: `class-${c}`, kind: "boundary", catalogId: "code-class", label: `Class${c}` });
    for (let m = 0; m < 6; m += 1) codeBig.nodes.push({ id: `m-${c}-${m}`, kind: "code", catalogId: "code-method", label: `m${m}`, parentId: `class-${c}` });
  }
  for (let f = 0; f < 24; f += 1) codeBig.nodes.push({ id: `fn-${f}`, kind: "code", catalogId: "code-function", label: `fn${f}` });
  const leaves = codeBig.nodes.filter((n) => (n as { kind: string }).kind === "code").map((n) => (n as { id: string }).id);
  for (let i = 0; i + 1 < leaves.length && codeBig.edges.length < 120; i += 1) {
    codeBig.edges.push({ id: `e-${i}`, source: leaves[i], target: leaves[i + 1], label: "", kind: "calls" });
  }
  assert.equal(codeBig.nodes.length, 80);
  const started = performance.now();
  const bigLaid = await resolveAgentGraphLayout(codeBig as never);
  const elapsed = performance.now() - started;
  assert.deepEqual(hardIssues(bigLaid), [], "80-node layout is valid");
  assert.ok(elapsed < 5000, `80-node layout took ${Math.round(elapsed)}ms`);
  console.log(`80-node code layout: ${Math.round(elapsed)}ms`);

  console.log("nested diagram layout verified");
}

main().catch((error) => { console.error(error); process.exit(1); });
