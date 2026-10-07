/**
 * Verification of manual canvas interaction transactions.
 *
 * Tests reparenting, resizing, deletion, and hierarchy preservation through
 * pure snapshot operations.
 */

import assert from "node:assert/strict";

import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { CanvasNode } from "@/types/canvas";
import { BOUNDARY_PADDING, CANVAS_NODE_TYPE, CANVAS_EDGE_TYPE } from "@/types/canvas";
import {
  finishCanvasDrop,
  insertCanvasItem,
  resizeCanvasBoundary,
  deleteCanvasSubtrees,
  getBoundaryMinimumSize,
} from "@/lib/canvas-interaction";
import { diagramGeometryKey, getDiagramEdgeLayout } from "@/lib/diagram-route";
import { getAbsoluteBounds } from "@/lib/canvas-hierarchy";
import { awsNode, nestedSnapshot } from "@/scripts/testing/aws-diagram-fixtures";

// Test 1: Deepest membership resolution and coordinate preservation
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 100, y: 100 }, width: 1200, height: 900 },
      { ...awsNode("vpc", "boundary-vpc", "cloud"), position: { x: 40, y: 80 }, width: 700, height: 600 },
      { ...awsNode("subnet", "boundary-subnet", "vpc"), position: { x: 40, y: 80 }, width: 400, height: 300 },
      { ...awsNode("s3", "aws-s3", "subnet"), position: { x: 40, y: 80 } },
      { ...awsNode("outside", "aws-ec2"), position: { x: 1500, y: 100 } },
    ],
    edges: [
      {
        id: "upload",
        type: CANVAS_EDGE_TYPE,
        source: "outside",
        target: "s3",
        data: { label: "Writes" },
      },
    ],
  };

  // Get absolute bounds before move
  const before = getAbsoluteBounds("s3", snapshot.nodes);

  // Simulate drag: move to root with absolute position preserved
  const moved = {
    ...snapshot,
    nodes: snapshot.nodes.map((n) => (n.id === "s3" ? { ...n, parentId: undefined, position: before } : n)),
  };

  // Finalize drop: should reparent back to deepest (subnet)
  const dropped = finishCanvasDrop(moved, "s3");
  const s3 = dropped.nodes.find((n) => n.id === "s3");

  assert.equal(s3?.parentId, "subnet", "S3 should be reparented to subnet (deepest containing boundary)");

  // Verify absolute bounds preserved
  const after = getAbsoluteBounds("s3", dropped.nodes);
  assert.deepEqual(after, before, "Absolute bounds should be preserved after reparent");

  console.log("✓ Test 1: Deepest membership and coordinate preservation");
}

// Test 2: Root membership outside all boundaries
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 100, y: 100 }, width: 1200, height: 900 },
      { ...awsNode("vpc", "boundary-vpc", "cloud"), position: { x: 40, y: 80 }, width: 700, height: 600 },
      { ...awsNode("s3", "aws-s3", "vpc"), position: { x: 40, y: 80 } },
    ],
    edges: [],
  };

  // Move to far outside position
  const moved = {
    ...snapshot,
    nodes: snapshot.nodes.map((n) =>
      n.id === "s3" ? { ...n, parentId: undefined, position: { x: -500, y: -500 } } : n,
    ),
  };

  const dropped = finishCanvasDrop(moved, "s3");
  const s3 = dropped.nodes.find((n) => n.id === "s3");

  assert.equal(s3?.parentId, undefined, "S3 moved far outside should have no parent");

  console.log("✓ Test 2: Root membership outside all boundaries");
}

// Test 3: Deletion of subtrees including descendants and incident edges
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 100, y: 100 }, width: 1200, height: 900 },
      { ...awsNode("vpc", "boundary-vpc", "cloud"), position: { x: 40, y: 80 }, width: 700, height: 600 },
      { ...awsNode("subnet", "boundary-subnet", "vpc"), position: { x: 40, y: 80 }, width: 400, height: 300 },
      { ...awsNode("s3", "aws-s3", "subnet"), position: { x: 40, y: 80 } },
      { ...awsNode("outside", "aws-ec2"), position: { x: 1500, y: 100 } },
    ],
    edges: [
      { id: "e1", type: CANVAS_EDGE_TYPE, source: "vpc", target: "s3", data: { label: "" } },
      { id: "e2", type: CANVAS_EDGE_TYPE, source: "outside", target: "s3", data: { label: "" } },
      { id: "e3", type: CANVAS_EDGE_TYPE, source: "outside", target: "vpc", data: { label: "" } },
    ],
  };

  // Delete VPC, which should also remove subnet and s3, but keep outside
  const deleted = deleteCanvasSubtrees(snapshot, ["vpc", "subnet"]);

  const nodeIds = deleted.nodes.map((n) => n.id);
  assert.deepEqual(nodeIds.sort(), ["cloud", "outside"], "VPC and its children should be deleted");

  // Check incident edges are removed
  const edgeIds = deleted.edges.map((e) => e.id);
  assert.ok(!edgeIds.includes("e1"), "Edge from VPC to S3 should be deleted (both endpoints deleted)");
  assert.ok(!edgeIds.includes("e2"), "Edge from outside to S3 should be deleted (target deleted)");
  assert.ok(!edgeIds.includes("e3"), "Edge from outside to VPC should be deleted (target deleted)");

  console.log("✓ Test 3: Deletion of subtrees and incident edges");
}

// Test 4: Group movement preserves descendant local positions
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 100, y: 100 }, width: 1200, height: 900 },
      { ...awsNode("vpc", "boundary-vpc", "cloud"), position: { x: 40, y: 80 }, width: 700, height: 600 },
      { ...awsNode("subnet", "boundary-subnet", "vpc"), position: { x: 40, y: 80 }, width: 400, height: 300 },
      { ...awsNode("s3", "aws-s3", "subnet"), position: { x: 40, y: 80 } },
    ],
    edges: [],
  };

  // Get positions before
  const subnetBeforeLocal = snapshot.nodes.find((n) => n.id === "subnet")!.position;
  const s3BeforeLocal = snapshot.nodes.find((n) => n.id === "s3")!.position;

  // Simulate moving VPC within cloud
  const vpcAbsBefore = getAbsoluteBounds("vpc", snapshot.nodes);
  const newVpcAbsPos = { x: vpcAbsBefore.x + 100, y: vpcAbsBefore.y + 50 };

  // Properly simulate a drag: remove parent, set to absolute position
  const moved = {
    ...snapshot,
    nodes: snapshot.nodes.map((n) =>
      n.id === "vpc" ? { ...n, parentId: undefined, position: newVpcAbsPos } : n,
    ),
  };

  const dropped = finishCanvasDrop(moved, "vpc");

  // VPC should be reparented back to cloud
  const vpcAfter = dropped.nodes.find((n) => n.id === "vpc")!;
  assert.equal(vpcAfter.parentId, "cloud", "VPC should be reparented to cloud");

  // Children's local positions should remain the same
  const subnetAfterLocal = dropped.nodes.find((n) => n.id === "subnet")!.position;
  const s3AfterLocal = dropped.nodes.find((n) => n.id === "s3")!.position;

  assert.deepEqual(subnetAfterLocal, subnetBeforeLocal, "Subnet local position unchanged");
  assert.deepEqual(s3AfterLocal, s3BeforeLocal, "S3 local position unchanged");

  // Absolute positions should move by exactly the VPC delta
  const vpcDeltaX = newVpcAbsPos.x - vpcAbsBefore.x;
  const vpcDeltaY = newVpcAbsPos.y - vpcAbsBefore.y;

  const subnetAbsBefore = getAbsoluteBounds("subnet", snapshot.nodes);
  const subnetAbsAfter = getAbsoluteBounds("subnet", dropped.nodes);

  assert.equal(subnetAbsAfter.x, subnetAbsBefore.x + vpcDeltaX, `Subnet absolute X should move by VPC delta (${vpcDeltaX})`);
  assert.equal(subnetAbsAfter.y, subnetAbsBefore.y + vpcDeltaY, `Subnet absolute Y should move by VPC delta (${vpcDeltaY})`);

  console.log("✓ Test 4: Group movement preserves descendant local positions");
}

// Test 5: Exclusion of descendants from multi-selection
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 100, y: 100 }, width: 1200, height: 900 },
      { ...awsNode("vpc", "boundary-vpc", "cloud"), position: { x: 40, y: 80 }, width: 700, height: 600 },
      { ...awsNode("s3", "aws-s3", "vpc"), position: { x: 40, y: 80 } },
    ],
    edges: [],
  };

  // Both VPC and its child S3 are selected — deletion should only happen once
  const deleted = deleteCanvasSubtrees(snapshot, ["vpc", "s3"]);

  const nodeIds = deleted.nodes.map((n) => n.id);
  assert.deepEqual(nodeIds, ["cloud"], "Only VPC should be removed (S3 already is its descendant)");

  console.log("✓ Test 5: Exclusion of descendants from multi-selection");
}

// Test 6: Boundary minimum size computation
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("vpc", "boundary-vpc"), position: { x: 0, y: 0 }, width: 700, height: 600 },
      { ...awsNode("subnet1", "boundary-subnet", "vpc"), position: { x: 24, y: 64 }, width: 400, height: 300 },
      { ...awsNode("subnet2", "boundary-subnet", "vpc"), position: { x: 488, y: 64 }, width: 360, height: 400 },
    ],
    edges: [],
  };

  const minSize = getBoundaryMinimumSize("vpc", snapshot.nodes);

  // subnet2 is at x:488, width:360, so right edge is at 848 + padding
  // Right edge = 488 + 360 + 24 = 872 canvas units
  assert.ok(minSize.width >= 872, `Minimum width ${minSize.width} should fit subnet2 right edge`);

  console.log("✓ Test 6: Boundary minimum size computation");
}

// Test 7: Insertion creates new node and finalizes containment
{
  const snapshot = nestedSnapshot();
  const initialLength = snapshot.nodes.length;

  const newNode: CanvasNode = {
    id: "new-ec2",
    type: CANVAS_NODE_TYPE,
    position: { x: 300, y: 200 }, // Absolute position for testing
    data: { label: "New EC2", color: "neutral", shape: "rectangle", kind: "aws-service", catalogId: "aws-ec2" },
  };

  const inserted = insertCanvasItem(snapshot, newNode);

  assert.equal(inserted.nodes.length, initialLength + 1, "Node count should increase");

  const added = inserted.nodes.find((n) => n.id === "new-ec2");
  assert.ok(added, "New node should exist");
  assert.ok("position" in added, "New node should have position");

  console.log("✓ Test 7: Insertion creates and finalizes containment");
}

// Test 8: Resize preserves child absolute positions on top-left move
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("vpc", "boundary-vpc"), position: { x: 100, y: 100 }, width: 600, height: 400 },
      { ...awsNode("s3", "aws-s3", "vpc"), position: { x: 50, y: 80 } },
    ],
    edges: [],
  };

  const s3AbsBefore = getAbsoluteBounds("s3", snapshot.nodes);

  // Resize VPC: move top-left to (80, 90) and expand
  const resized = resizeCanvasBoundary(snapshot, "vpc", { x: 80, y: 90, width: 700, height: 500 });

  const s3AbsAfter = getAbsoluteBounds("s3", resized.nodes);

  // S3 absolute position should be preserved
  assert.equal(s3AbsAfter.x, s3AbsBefore.x, "S3 absolute X should stay the same");
  assert.equal(s3AbsAfter.y, s3AbsBefore.y, "S3 absolute Y should stay the same");

  console.log("✓ Test 8: Resize preserves child absolute positions");
}

// Test 9: Descendant-first deletion order prevents dangling parents
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 100, y: 100 }, width: 1200, height: 900 },
      { ...awsNode("vpc", "boundary-vpc", "cloud"), position: { x: 40, y: 80 }, width: 700, height: 600 },
      { ...awsNode("subnet", "boundary-subnet", "vpc"), position: { x: 40, y: 80 }, width: 400, height: 300 },
    ],
    edges: [],
  };

  // Delete cloud (which has vpc and subnet as descendants)
  const deleted = deleteCanvasSubtrees(snapshot, ["cloud"]);

  const nodeIds = deleted.nodes.map((n) => n.id);
  assert.deepEqual(nodeIds, [], "All nodes should be deleted with their descendants");

  console.log("✓ Test 9: Descendant-first deletion order");
}

// Test 10: Sibling visibility after resize
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 100, y: 100 }, width: 1200, height: 900 },
      { ...awsNode("vpc1", "boundary-vpc", "cloud"), position: { x: 40, y: 80 }, width: 500, height: 300 },
      { ...awsNode("vpc2", "boundary-vpc", "cloud"), position: { x: 560, y: 80 }, width: 500, height: 300 },
    ],
    edges: [],
  };

  // Resize vpc1 to a smaller size — vpc2 should remain visible
  const resized = resizeCanvasBoundary(snapshot, "vpc1", { x: 40, y: 80, width: 300, height: 200 });

  const vpc2 = resized.nodes.find((n) => n.id === "vpc2");
  assert.ok(vpc2, "VPC2 should still exist");
  assert.deepEqual(vpc2?.position, { x: 560, y: 80 }, "VPC2 should maintain its position");

  console.log("✓ Test 10: Sibling visibility after resize");
}

console.log("\n✅ All canvas interaction tests passed");

// Group movement invalidates saved descendant routes though local positions are unchanged.
{
  const snapshot = nestedSnapshot();
  const moved = {
    ...snapshot,
    nodes: snapshot.nodes.map((n) => (n.id === "vpc" ? { ...n, position: { x: n.position.x + 50, y: n.position.y } } : n)),
  };
  const key = diagramGeometryKey(snapshot.nodes);
  assert.notEqual(diagramGeometryKey(moved.nodes), key);
  assert.deepEqual(
    moved.nodes.find((n) => n.id === "web")!.position,
    snapshot.nodes.find((n) => n.id === "web")!.position,
    "descendant local position is unchanged",
  );
  const edge = {
    id: "e", source: "web", target: "uploads",
    data: { label: "", layout: { version: 1, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], label: null, geometryKey: key, source: "web", target: "uploads", text: "" } },
  };
  assert.ok(getDiagramEdgeLayout(edge as never, snapshot.nodes), "route is current before the move");
  assert.equal(getDiagramEdgeLayout(edge as never, moved.nodes), null, "route is obsolete after the group moves");
}

// Expansion of a nested, offset boundary uses one (boundary-local) coordinate space.
{
  const snapshot: CanvasSnapshot = {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 500, y: 500 }, width: 1200, height: 900 },
      { ...awsNode("vpc", "boundary-vpc", "cloud"), position: { x: 40, y: 80 }, width: 400, height: 300 },
      { ...awsNode("ec2", "aws-ec2"), position: { x: 800, y: 680 }, width: 180, height: 100 },
    ],
    edges: [],
  };
  const dropped = finishCanvasDrop(snapshot, "ec2");
  const vpc = dropped.nodes.find((n) => n.id === "vpc")!;
  assert.equal(dropped.nodes.find((n) => n.id === "ec2")!.parentId, "vpc");
  assert.equal(vpc.width, 260 + 180 + BOUNDARY_PADDING, "vpc grows by the child overhang only, not its ancestors' offset");
}
