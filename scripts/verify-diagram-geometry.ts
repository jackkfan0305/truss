/**
 * Verification for diagram geometry derivation and validation.
 *
 * Tests absolute bounds computation from nested positions, boundary metadata,
 * and geometry validation including containment and collision checks.
 */

import assert from "node:assert/strict";
import { awsNode, nestedSnapshot } from "@/scripts/testing/aws-diagram-fixtures";
import {
  deriveDiagramGeometry,
  validateDiagramGeometry,
} from "@/lib/diagram-geometry";
import { layoutDiagram } from "@/lib/diagram-layout";
import { getDiagramEdgeLayout, type DiagramEdgeLayout } from "@/lib/diagram-route";
import { BOUNDARY_PADDING, BOUNDARY_TITLE_HEIGHT, CANVAS_EDGE_TYPE, type CanvasEdge } from "@/types/canvas";

const edge = (id: string, source: string, target: string, label = ""): CanvasEdge =>
  ({ id, type: CANVAS_EDGE_TYPE, source, target, data: { label } }) as CanvasEdge;

console.log("Testing diagram geometry derivation and validation...");

// Test 1: Basic absolute position computation
console.log("\n1. Testing absolute bounds computation");
const fixture = nestedSnapshot();
const geometry = deriveDiagramGeometry(fixture.nodes);

// Cloud is at (100, 80)
const cloudGeom = geometry.get("cloud")!;
assert.equal(cloudGeom.bounds.x, 100, "Cloud x");
assert.equal(cloudGeom.bounds.y, 80, "Cloud y");

// VPC is parent-relative (32, 64) inside cloud at (100, 80)
// So absolute = (100 + 32, 80 + 64) = (132, 144)
const vpcGeom = geometry.get("vpc")!;
assert.equal(vpcGeom.bounds.x, 132, "VPC absolute x");
assert.equal(vpcGeom.bounds.y, 144, "VPC absolute y");

// Public subnet is (24, 64) relative to vpc, which is at (132, 144)
// So absolute = (132 + 24, 144 + 64) = (156, 208)
const publicGeom = geometry.get("public")!;
assert.equal(publicGeom.bounds.x, 156, "Public subnet absolute x");
assert.equal(publicGeom.bounds.y, 208, "Public subnet absolute y");

// Service 'web' is (24, 64) relative to public, which is at (156, 208)
// So absolute = (156 + 24, 208 + 64) = (180, 272)
const webGeom = geometry.get("web")!;
assert.equal(webGeom.bounds.x, 180, "Web service absolute x");
assert.equal(webGeom.bounds.y, 272, "Web service absolute y");

console.log("✓ Absolute position computation correct");

// Test 2: Boundary metadata
console.log("\n2. Testing boundary interior and title bounds");
const vpcBoundary = vpcGeom;
assert.ok(vpcBoundary.interior, "VPC should have interior bounds");
assert.ok(vpcBoundary.title, "VPC should have title bounds");

// Interior should be offset by padding and title height
const expectedInterior = {
  x: 132 + BOUNDARY_PADDING,
  y: 144 + BOUNDARY_TITLE_HEIGHT,
  width: 900 - 2 * BOUNDARY_PADDING,
  height: 650 - BOUNDARY_PADDING - BOUNDARY_TITLE_HEIGHT,
};
assert.deepEqual(vpcBoundary.interior, expectedInterior, "VPC interior bounds");

// Title should be at the top of the boundary
const expectedTitle = {
  x: 132,
  y: 144,
  width: 900,
  height: BOUNDARY_TITLE_HEIGHT,
};
assert.deepEqual(vpcBoundary.title, expectedTitle, "VPC title bounds");

console.log("✓ Boundary metadata correct");

// Test 3: Service nodes should not have interior/title
console.log("\n3. Testing service node geometry");
assert.equal(webGeom.interior, null, "Service should have no interior");
assert.equal(webGeom.title, null, "Service should have no title");
assert.equal(webGeom.padding, null, "Service should have no padding");

console.log("✓ Service geometry correct");

// Test 4: Valid containment
console.log("\n4. Testing valid nested containment");
const issues = validateDiagramGeometry(fixture);
assert.equal(issues.length, 0, `Expected no issues, got: ${issues.map((i) => i.message).join("; ")}`);

console.log("✓ Valid containment passes validation");

// Test 5: Containment violation
console.log("\n5. Testing containment violation detection");
const titleOverlap = {
  nodes: fixture.nodes.map((n) =>
    n.id === "web" ? { ...n, position: { x: 24, y: 0 } } : n
  ),
};
const titleIssues = validateDiagramGeometry(titleOverlap);
assert.ok(
  titleIssues.some((i) => i.code === "containment" && i.itemIds.includes("web")),
  "Should detect web exceeding interior bounds due to title overlap"
);

console.log("✓ Containment violation detected");

// Test 6: Sibling collision
console.log("\n6. Testing sibling collision detection");
const collided = {
  nodes: fixture.nodes.map((n) => {
    if (n.id === "public") {
      return { ...n, position: { x: 300, y: 64 } }; // Move public to collide with private
    }
    return n;
  }),
};
const collisionIssues = validateDiagramGeometry(collided);
assert.ok(
  collisionIssues.some((i) => i.code === "siblingCollision"),
  "Should detect collision between public and private subnets"
);

console.log("✓ Sibling collision detected");

// Test 7: Non-finite bounds
const broken = { nodes: fixture.nodes.map((n) => (n.id === "web" ? { ...n, width: Number.NaN } : n)) };
assert.ok(validateDiagramGeometry(broken).some((i) => i.code === "invalidBounds" && i.itemIds.includes("web")), "NaN width is invalid");

(async () => {
// Test 8: Routes and labels against final geometry
console.log("\n8. Testing route and label validation");
const routed = await layoutDiagram({
  nodes: [awsNode("l", "aws-s3"), awsNode("m", "aws-s3"), awsNode("r", "aws-s3")],
  edges: [edge("direct", "l", "r", "label"), edge("a", "l", "m"), edge("b", "m", "r")],
});
assert.deepEqual(validateDiagramGeometry(routed), [], "ELK output is valid");

const withLayout = (id: string, change: (layout: DiagramEdgeLayout) => DiagramEdgeLayout) => ({
  nodes: routed.nodes,
  edges: routed.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data!, layout: change(getDiagramEdgeLayout(e, routed.nodes)!) } } : e)),
});
const middle = routed.nodes.find((n) => n.id === "m")!;
const through = withLayout("direct", (layout) => ({ ...layout, points: [
  layout.points[0],
  { x: layout.points[0].x, y: middle.position.y + 50 },
  { x: layout.points[layout.points.length - 1].x, y: middle.position.y + 50 },
  layout.points[layout.points.length - 1],
] }));
assert.ok(validateDiagramGeometry(through).some((i) => i.code === "routeCollision" && i.itemIds.includes("m")), "route through an unrelated block is rejected");
const diagonal = withLayout("a", (layout) => ({ ...layout, points: [layout.points[0], { x: layout.points[0].x + 7, y: layout.points[0].y + 9 }] }));
assert.ok(validateDiagramGeometry(diagonal).some((i) => i.code === "invalidRoute" && i.itemIds.includes("a")), "diagonal route is rejected");
const labelled = withLayout("direct", (layout) => ({ ...layout, label: { x: middle.position.x + 90, y: middle.position.y + 50, width: 160, height: 28 } }));
assert.ok(validateDiagramGeometry(labelled).some((i) => i.code === "labelCollision" && i.itemIds.includes("m")), "label over a block is rejected");
const moved = { nodes: routed.nodes.map((n) => (n.id === "r" ? { ...n, position: { x: n.position.x + 5, y: n.position.y } } : n)), edges: routed.edges };
assert.ok(validateDiagramGeometry(moved).some((i) => i.code === "invalidRoute"), "route stale against moved geometry is rejected");



console.log("\n✅ All diagram geometry tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
